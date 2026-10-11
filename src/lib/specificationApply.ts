/**
 * Safe apply of the Owner-approved Shopify specification rows to `product_specifications` — pure planning, the
 * confirmation rules and the write loop. Database access is injected (see specificationApplyDb.ts), so the whole
 * flow is testable offline.
 *
 * Reuses the repository's existing specification storage and its importer mapping:
 *   Product Key = product slug · Section -> specification_group · Specification Name -> label · value -> value,
 *   unique (product_id, specification_group, label). There is no second specification system.
 *
 * Scope is deliberately narrow:
 *   - ONLY rows whose review status is "approved" (Review / Conflict / Rejected / Proposed and skipped sources never are).
 *   - Writes touch ONLY product_specifications: INSERT new rows, UPDATE the `value` of an existing row. Nothing is deleted;
 *     unrelated specification rows are never read for change, only verified unchanged.
 *   - A row is writable only if it maps to exactly one catalog product (slug), has a valid section/name/value and is not a
 *     duplicate. Anything else is Blocked, and a Blocked row makes the whole apply unavailable.
 *   - Every product is re-read immediately before its write; if it no longer matches the preview it is blocked.
 *   - A product is "verified" only after reading it back: every written row matches, nothing else in specification
 *     storage changed, and the product row, variants, prices, stock and media are identical.
 */
import { commercialWriteTarget, verifyCommercialUpdate, type CommercialCheck, type CommercialSnapshot } from "./commercialDefaults.ts";
import { SPEC_SECTIONS } from "./productSpecificationExtraction.ts";
import type { SpecProposal, SpecReview } from "./specificationReview.ts";

// ---------------- Inputs ----------------

export type ApplyRow = { productId: string; productKey: string; productTitle: string; handle: string; section: string; name: string; value: string };

export type ApprovedRowSelection = {
  rows: ApplyRow[];
  /** Rows deliberately left out, by reason. */
  excluded: { review: number; conflict: number; rejected: number; proposed: number; skippedSource: number };
};

/**
 * The ONLY rows the apply may ever consider: review status "approved". When `sources` (productId -> the Shopify handle
 * currently chosen for it) is given, an approved row whose source is not that handle — e.g. from a skipped or
 * unresolved source — is excluded as well.
 */
export function selectApprovedRows(review: SpecReview, sources?: ReadonlyMap<string, string>): ApprovedRowSelection {
  const excluded = { review: 0, conflict: 0, rejected: 0, proposed: 0, skippedSource: 0 };
  const rows: ApplyRow[] = [];
  for (const proposal of review.proposals as SpecProposal[]) {
    if (proposal.status === "approved") {
      if (sources && sources.get(proposal.productId) !== proposal.handle) excluded.skippedSource += 1;
      else rows.push({ productId: proposal.productId, productKey: proposal.productKey, productTitle: proposal.productTitle, handle: proposal.handle, section: proposal.section, name: proposal.name, value: proposal.value });
    } else if (proposal.status === "conflict") excluded.conflict += 1;
    else if (proposal.status === "rejected") excluded.rejected += 1;
    else if (proposal.confidence === "Review") excluded.review += 1;
    else excluded.proposed += 1;
  }
  return { rows, excluded };
}

/** 64-bit FNV-1a over the sorted approved rows: any change to the approved set changes the fingerprint. */
export function approvedFingerprint(rows: readonly ApplyRow[]): string {
  const text = rows.map((row) => `${row.productId}|${row.productKey}|${row.section}|${row.name}|${row.value}`).sort().join("\n");
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 0x100000001b3n);
  return `${rows.length}:${hash.toString(16).padStart(16, "0")}`;
}

export type CatalogSpecProduct = { id: string; slug: string; title: string };

/** A row of public.product_specifications as read. */
export type ExistingSpec = { id: string; product_id: string; specification_group: string | null; label: string; value: string; sort_order: number };

// ---------------- Plan ----------------

export type PlanKind = "create" | "update" | "unchanged" | "blocked";

export type PlanEntry = {
  productId: string;
  productTitle: string;
  productKey: string;
  section: string;
  name: string;
  value: string;
  kind: PlanKind;
  blockers: string[];
  existingId: string | null;
  existingValue: string | null;
  /** Position for a new row (existing rows keep theirs). */
  sortOrder: number;
};

export type PlanProduct = { productId: string; title: string; slug: string; rows: ApplyRow[]; entries: PlanEntry[]; inBatch: boolean };

export type SpecificationApplyPlan = {
  products: PlanProduct[];
  entries: PlanEntry[];
  fingerprint: string;
  totals: {
    approvedRows: number;
    productsAffected: number;
    create: number;
    update: number;
    unchanged: number;
    blocked: number;
    duplicates: number;
    mappingFailures: number;
    invalidRows: number;
  };
};

const MAX_NAME = 120;
const MAX_VALUE = 600;
const lower = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const sectionIndex = (section: string) => SPEC_SECTIONS.indexOf(section as (typeof SPEC_SECTIONS)[number]);

function rowProblems(row: ApplyRow): string[] {
  const problems: string[] = [];
  if (!row.productKey.trim()) problems.push("Missing product key.");
  if (!SPEC_SECTIONS.includes(row.section as (typeof SPEC_SECTIONS)[number])) problems.push(`Invalid section "${row.section}".`);
  if (!row.name.trim()) problems.push("Empty specification name.");
  else if (row.name.trim().length > MAX_NAME) problems.push(`Specification name is longer than ${MAX_NAME} characters.`);
  if (!row.value.trim()) problems.push("Empty specification value.");
  else if (row.value.trim().length > MAX_VALUE) problems.push(`Specification value is longer than ${MAX_VALUE} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(`${row.name}${row.value}`)) problems.push("Contains control characters.");
  return problems;
}

/** Plans ONE product: exact product match, validity, duplicates, and Create / Update / Unchanged against what is stored. */
export function planProduct(product: CatalogSpecProduct, rows: readonly ApplyRow[], existing: readonly ExistingSpec[], catalogSlugCount: number, inBatch = true): PlanProduct {
  const entries: PlanEntry[] = [];
  const mine = existing.filter((spec) => spec.product_id === product.id);
  const byExact = new Map(mine.map((spec) => [`${spec.specification_group ?? ""}\u0000${spec.label}`, spec]));
  const byLoose = new Map<string, ExistingSpec[]>();
  for (const spec of mine) byLoose.set(`${lower(spec.specification_group ?? "")}|${lower(spec.label)}`, [...(byLoose.get(`${lower(spec.specification_group ?? "")}|${lower(spec.label)}`) ?? []), spec]);
  const seen = new Map<string, ApplyRow>();
  let nextOrder = mine.reduce((max, spec) => Math.max(max, spec.sort_order), -1) + 1;
  const ordered = rows.slice().sort((a, b) => sectionIndex(a.section) - sectionIndex(b.section) || a.name.localeCompare(b.name));
  const slugProblem = catalogSlugCount !== 1 ? `Product key "${product.slug}" matches ${catalogSlugCount} catalog products, not exactly one.` : null;
  for (const row of ordered) {
    const blockers = rowProblems(row);
    if (slugProblem) blockers.push(slugProblem);
    if (!inBatch) blockers.push("Product is not part of the imported Android batch.");
    if (row.productKey !== product.slug) blockers.push(`Product key "${row.productKey}" does not match the catalog product "${product.slug}".`);
    if (row.productId !== product.id) blockers.push("Row product id does not match the catalog product.");
    const looseKey = `${lower(row.section)}|${lower(row.name)}`;
    const earlier = seen.get(looseKey);
    if (earlier) blockers.push(earlier.value.trim() === row.value.trim() ? "Duplicate of another approved row (identical)." : "Duplicate of another approved row with a different value.");
    else seen.set(looseKey, row);
    const exact = byExact.get(`${row.section}\u0000${row.name.trim()}`);
    const loose = byLoose.get(looseKey) ?? [];
    if (!exact && loose.length > 0) blockers.push(`A stored row differs only in letter case/spacing ("${loose[0].label}"); not overwritten.`);
    const base = { productId: row.productId, productTitle: row.productTitle, productKey: row.productKey, section: row.section, name: row.name.trim(), value: row.value.trim() };
    if (blockers.length > 0) entries.push({ ...base, kind: "blocked", blockers, existingId: exact?.id ?? null, existingValue: exact?.value ?? null, sortOrder: -1 });
    else if (exact) entries.push({ ...base, kind: exact.value === base.value ? "unchanged" : "update", blockers: [], existingId: exact.id, existingValue: exact.value, sortOrder: exact.sort_order });
    else entries.push({ ...base, kind: "create", blockers: [], existingId: null, existingValue: null, sortOrder: nextOrder++ });
  }
  return { productId: product.id, title: product.title, slug: product.slug, rows: ordered, entries, inBatch };
}

/** Zero-write plan for the whole approved set against the catalog and the stored specifications. */
export function planSpecificationApply(rows: readonly ApplyRow[], catalog: readonly CatalogSpecProduct[], existing: readonly ExistingSpec[], batchIds?: ReadonlySet<string>): SpecificationApplyPlan {
  const slugCount = new Map<string, number>();
  for (const product of catalog) slugCount.set(product.slug, (slugCount.get(product.slug) ?? 0) + 1);
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const grouped = new Map<string, ApplyRow[]>();
  for (const row of rows) grouped.set(row.productId, [...(grouped.get(row.productId) ?? []), row]);
  const products: PlanProduct[] = [];
  const unmapped: PlanEntry[] = [];
  for (const [productId, productRows] of grouped) {
    const product = byId.get(productId);
    if (!product) {
      for (const row of productRows) unmapped.push({ productId, productTitle: row.productTitle, productKey: row.productKey, section: row.section, name: row.name, value: row.value, kind: "blocked", blockers: ["No catalog product with this id (product mapping failed)."], existingId: null, existingValue: null, sortOrder: -1 });
      continue;
    }
    products.push(planProduct(product, productRows, existing, slugCount.get(product.slug) ?? 0, batchIds ? batchIds.has(product.id) : true));
  }
  products.sort((a, b) => a.title.localeCompare(b.title));
  const entries = [...products.flatMap((product) => product.entries), ...unmapped];
  const count = (kind: PlanKind) => entries.filter((entry) => entry.kind === kind).length;
  const hasBlocker = (entry: PlanEntry, pattern: RegExp) => entry.blockers.some((blocker) => pattern.test(blocker));
  return {
    products,
    entries,
    fingerprint: approvedFingerprint(rows),
    totals: {
      approvedRows: rows.length,
      productsAffected: new Set(entries.filter((entry) => entry.kind === "create" || entry.kind === "update").map((entry) => entry.productId)).size,
      create: count("create"),
      update: count("update"),
      unchanged: count("unchanged"),
      blocked: count("blocked") ,
      duplicates: entries.filter((entry) => hasBlocker(entry, /^Duplicate/)).length,
      mappingFailures: entries.filter((entry) => hasBlocker(entry, /product mapping|Product key|matches \d+ catalog|product id does not match|not part of the imported/)).length,
      invalidRows: entries.filter((entry) => hasBlocker(entry, /Invalid section|Empty specification|longer than|control characters|Missing product key/)).length,
    },
  };
}

// ---------------- Gating / confirmation ----------------

export const specApplyConfirmationPhrase = (writeCount: number) => `APPLY ${writeCount} SPECS`;

export const specApplyWriteCount = (plan: SpecificationApplyPlan) => plan.totals.create + plan.totals.update;

/** PRODUCTION only: the exact phrase "APPLY <creates+updates> SPECS". DEVELOPMENT / unknown never satisfy it. */
export function specApplyConfirmationSatisfied(environment: "development" | "production" | null, typed: string, writeCount: number) {
  return environment === "production" && writeCount > 0 && typed === specApplyConfirmationPhrase(writeCount);
}

/** Why the Apply button is unavailable, or null when it may be enabled. */
export function specApplyBlocker(input: { environment: "development" | "production" | null; allowed: boolean; plan: SpecificationApplyPlan | null; currentFingerprint: string }): string | null {
  if (!input.allowed || input.environment !== "production") return "Apply is available only in the PRODUCTION environment.";
  if (!input.plan) return "Run the preview first.";
  if (input.plan.fingerprint !== input.currentFingerprint) return "The review state changed since the preview — preview again.";
  if (input.plan.totals.blocked > 0) return `${input.plan.totals.blocked} row(s) are Blocked — resolve them first.`;
  if (specApplyWriteCount(input.plan) === 0) return "Nothing to write: every approved row is already stored.";
  return null;
}

// ---------------- Write loop ----------------

export type SpecApplyDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  /** All specification rows of the product (read). */
  readSpecs: (productId: string) => Promise<ExistingSpec[]>;
  /** Full products row (read). */
  readProduct: (productId: string) => Promise<Record<string, unknown>>;
  readSnapshot: (productId: string) => Promise<CommercialSnapshot>;
  /** INSERT only. One statement per product, so a failure creates none of that product's rows. */
  insertSpecs: (productId: string, rows: { specification_group: string; label: string; value: string; sort_order: number }[]) => Promise<void>;
  /** UPDATE of ONE existing row's `value` only. */
  updateSpecValue: (id: string, value: string) => Promise<void>;
  /** The product's slug / catalog row, re-read so mapping is re-checked right before the write. */
  catalog: readonly CatalogSpecProduct[];
  onProgress?: (progress: SpecApplyProgress) => void;
};

export type SpecApplyProgress = { done: number; total: number; current: string | null };

export type SpecRowStatus = "written" | "unchanged" | "failed" | "blocked";

export type SpecRowResult = { section: string; name: string; value: string; status: SpecRowStatus; message: string };

export type SpecProductResult = {
  productId: string;
  title: string;
  status: "verified" | "unchanged" | "blocked" | "failed";
  message: string;
  rows: SpecRowResult[];
  checks: SpecApplyCheck[];
};

export type SpecApplyCheck = CommercialCheck;

export type SpecApplyRunResult = {
  outcome: "verified" | "issues" | "blocked";
  message: string;
  products: SpecProductResult[];
  summary: { products: number; verified: number; unchanged: number; blocked: number; failed: number; rowsWritten: number; rowsFailed: number };
};

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "unknown error");

function summarize(products: SpecProductResult[]): SpecApplyRunResult["summary"] {
  const count = (status: SpecProductResult["status"]) => products.filter((product) => product.status === status).length;
  const rows = products.flatMap((product) => product.rows);
  return { products: products.length, verified: count("verified"), unchanged: count("unchanged"), blocked: count("blocked"), failed: count("failed"), rowsWritten: rows.filter((row) => row.status === "written").length, rowsFailed: rows.filter((row) => row.status === "failed").length };
}

/**
 * Read-back comparison for one product. Pure.
 * `entries` = the planned Create/Update/Unchanged entries; `before`/`after` = ALL stored specification rows of the product.
 */
export function verifySpecificationWrite(
  entries: readonly PlanEntry[],
  before: readonly ExistingSpec[],
  after: readonly ExistingSpec[],
  productBefore: Record<string, unknown>,
  productAfter: Record<string, unknown>,
  snapshotBefore: CommercialSnapshot,
  snapshotAfter: CommercialSnapshot,
): SpecApplyCheck[] {
  const checks: SpecApplyCheck[] = [];
  const afterByKey = new Map(after.map((spec) => [`${spec.specification_group ?? ""}\u0000${spec.label}`, spec]));
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "blocked") continue;
    const stored = afterByKey.get(`${entry.section}\u0000${entry.name}`);
    if (!stored) missing.push(`${entry.section} / ${entry.name}`);
    else if (stored.value !== entry.value) wrong.push(`${entry.section} / ${entry.name}`);
  }
  checks.push({ name: "Every written value read back exactly", ok: missing.length === 0 && wrong.length === 0, detail: missing.length || wrong.length ? `Missing: ${missing.join(", ") || "none"}; wrong value: ${wrong.join(", ") || "none"}` : "All planned rows are stored with the expected value" });
  const created = entries.filter((entry) => entry.kind === "create").length;
  checks.push({ name: "No specification row deleted or added unexpectedly", ok: after.length === before.length + created && before.every((spec) => after.some((other) => other.id === spec.id)), detail: `rows ${before.length} -> ${after.length} (expected +${created})` });
  const touched = new Set(entries.filter((entry) => entry.kind === "update").map((entry) => entry.existingId));
  const disturbed = before.filter((spec) => {
    const now = after.find((other) => other.id === spec.id);
    if (!now) return true;
    if (touched.has(spec.id)) return now.specification_group !== spec.specification_group || now.label !== spec.label || now.sort_order !== spec.sort_order;
    return now.specification_group !== spec.specification_group || now.label !== spec.label || now.value !== spec.value || now.sort_order !== spec.sort_order;
  });
  checks.push({ name: "Unrelated specification rows unchanged", ok: disturbed.length === 0, detail: disturbed.length ? `Changed: ${disturbed.map((spec) => spec.label).join(", ")}` : "All other rows identical" });
  const changed = Object.keys(productBefore).filter((key) => JSON.stringify(productBefore[key]) !== JSON.stringify(productAfter[key]));
  checks.push({ name: "Product row unchanged", ok: changed.length === 0, detail: changed.length ? `Changed: ${changed.join(", ")}` : "Title, slug, brand, category, publication and defaults identical" });
  checks.push(...verifyCommercialUpdate(snapshotBefore, snapshotAfter, { pta: "", condition: "" }, []).filter((check) => check.name !== "PTA and Condition set on targets" && check.name !== "No target left Unknown"));
  return checks;
}

/**
 * Applies the REVIEWED plan product by product. PRODUCTION only. Refuses when anything is Blocked. Each product is re-read and
 * re-planned immediately before its write; a product that no longer matches the preview is blocked, never written. One
 * product failing never stops the others, and success is claimed only after the read-back matches.
 */
export async function runSpecificationApply(plan: SpecificationApplyPlan, deps: SpecApplyDeps): Promise<SpecApplyRunResult> {
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed || target.environment !== "production")
    return { outcome: "blocked", message: `${target.reason ?? "Blocked: specification apply is allowed in PRODUCTION only."} Nothing was written.`, products: [], summary: summarize([]) };
  if (plan.totals.blocked > 0) return { outcome: "blocked", message: `${plan.totals.blocked} row(s) are Blocked. Nothing was written.`, products: [], summary: summarize([]) };
  const slugCount = new Map<string, number>();
  for (const product of deps.catalog) slugCount.set(product.slug, (slugCount.get(product.slug) ?? 0) + 1);
  const results: SpecProductResult[] = [];
  const work = plan.products.filter((product) => product.entries.some((entry) => entry.kind === "create" || entry.kind === "update"));
  for (const [index, planned] of work.entries()) {
    deps.onProgress?.({ done: index, total: work.length, current: planned.title });
    const base = { productId: planned.productId, title: planned.title };
    const rowResults: SpecRowResult[] = planned.entries.map((entry) => ({ section: entry.section, name: entry.name, value: entry.value, status: entry.kind === "unchanged" ? "unchanged" : "blocked", message: entry.kind === "unchanged" ? "Already stored." : "Not written." }));
    const mark = (entry: PlanEntry, status: SpecRowStatus, message: string) => {
      const row = rowResults.find((candidate) => candidate.section === entry.section && candidate.name === entry.name);
      if (row) Object.assign(row, { status, message });
    };
    try {
      const catalogProduct = deps.catalog.find((product) => product.id === planned.productId);
      if (!catalogProduct) {
        results.push({ ...base, status: "blocked", message: "Blocked: the product no longer exists in the catalog.", rows: rowResults, checks: [] });
        continue;
      }
      const before = await deps.readSpecs(planned.productId);
      const replanned = planProduct(catalogProduct, planned.rows, before, slugCount.get(catalogProduct.slug) ?? 0, planned.inBatch);
      const same = replanned.entries.length === planned.entries.length && replanned.entries.every((entry, position) => {
        const reviewed = planned.entries[position];
        return entry.kind === reviewed.kind && entry.value === reviewed.value && entry.existingId === reviewed.existingId && entry.sortOrder === reviewed.sortOrder;
      });
      if (!same) {
        results.push({ ...base, status: "blocked", message: "Blocked: the stored specifications changed since the preview — preview again. Nothing was written for this product.", rows: rowResults, checks: [] });
        continue;
      }
      const productBefore = await deps.readProduct(planned.productId);
      const snapshotBefore = await deps.readSnapshot(planned.productId);
      const creates = planned.entries.filter((entry) => entry.kind === "create");
      const updates = planned.entries.filter((entry) => entry.kind === "update");
      let failed = false;
      if (creates.length > 0) {
        try {
          await deps.insertSpecs(planned.productId, creates.map((entry) => ({ specification_group: entry.section, label: entry.name, value: entry.value, sort_order: entry.sortOrder })));
          for (const entry of creates) mark(entry, "written", "Created.");
        } catch (error) {
          failed = true;
          for (const entry of creates) mark(entry, "failed", `Insert failed: ${messageOf(error)}`);
        }
      }
      for (const entry of updates) {
        try {
          await deps.updateSpecValue(entry.existingId as string, entry.value);
          mark(entry, "written", "Updated.");
        } catch (error) {
          failed = true;
          mark(entry, "failed", `Update failed: ${messageOf(error)}`);
        }
      }
      const afterSpecs = await deps.readSpecs(planned.productId);
      const productAfter = await deps.readProduct(planned.productId);
      const snapshotAfter = await deps.readSnapshot(planned.productId);
      // Rows that failed to write are excluded from the "expected" set so the read-back judges only what was claimed written.
      const expected = planned.entries.filter((entry) => {
        const row = rowResults.find((candidate) => candidate.section === entry.section && candidate.name === entry.name);
        return row?.status === "written" || row?.status === "unchanged";
      });
      const checks = verifySpecificationWrite(expected, before, afterSpecs, productBefore, productAfter, snapshotBefore, snapshotAfter);
      const verified = !failed && checks.every((check) => check.ok);
      results.push({
        ...base,
        status: verified ? "verified" : "failed",
        message: verified ? "Specifications written and verified." : failed ? "Some rows failed to write — see the rows below." : `Written, but read-back verification FAILED: ${checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}.`,
        rows: rowResults,
        checks,
      });
    } catch (error) {
      results.push({ ...base, status: "failed", message: `Apply failed: ${messageOf(error)}. Check the product's specifications before retrying.`, rows: rowResults, checks: [] });
    }
  }
  deps.onProgress?.({ done: work.length, total: work.length, current: null });
  const summary = summarize(results);
  const clean = summary.failed === 0 && summary.blocked === 0;
  return {
    outcome: clean ? "verified" : "issues",
    message: clean
      ? `Wrote and verified ${summary.rowsWritten} specification row(s) on ${summary.verified} product(s).`
      : `Finished with issues: ${summary.verified} product(s) verified, ${summary.failed} failed, ${summary.blocked} blocked; ${summary.rowsWritten} row(s) written, ${summary.rowsFailed} row(s) failed.`,
    products: results,
    summary,
  };
}
