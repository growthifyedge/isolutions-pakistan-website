import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { csvRows } from "../lib/bulkCatalog";
import {
  assignProduct,
  chooseSourceSet,
  confirmAllReviewSuggestions,
  confirmMatch,
  emptyReview,
  parseShopifyReview,
  readShopifyExport,
  restoreSet,
  reviewSetStates,
  skipSet,
  type BulkImageCatalogProduct,
  type BulkImageReview,
} from "../lib/bulkProductImagesReview";
import { commercialWriteTarget, selectAndroidBatch } from "../lib/commercialDefaults";
import { loadPublishProducts } from "../lib/bulkPublishDb";
import { buildConflictGroups } from "../lib/specificationSourceConflicts";
import { approveSafeReviewSpecs, classifyReviewProposal, sourceTextOf, type ReviewBlockCategory, type ReviewVerdict } from "../lib/specificationReviewSafety";
import { extractSpecifications, parseShopifyDescriptions, type ShopifyDescription } from "../lib/productSpecificationExtraction";
import {
  approveAllHighConfidence,
  approveProposal,
  approvalBlocker,
  approvedSpecificationRows,
  buildSpecReview,
  buildSpecificationsWorkbook,
  editProposalValue,
  mergeSpecReviews,
  rejectProposal,
  resolveConflict,
  restoreProposal,
  reviewSummary,
  type SpecProposal,
  type SpecReview,
} from "../lib/specificationReview";

// LEGACY, ONE-TIME: proposes structured specifications from the Shopify export's descriptions for the imported Android batch.
// Review state only: nothing here writes to the database, media or any workbook. Export produces a NEW file.

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);

type Filter = "all" | "high" | "review" | "conflict" | "approved" | "rejected" | "none";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "High confidence" },
  { key: "review", label: "Needs Review" },
  { key: "conflict", label: "Conflict" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "none", label: "No Specs" },
];

const STATUS_LABEL: Record<SpecProposal["status"], string> = { proposed: "Proposed", approved: "Approved", rejected: "Rejected", conflict: "Conflict" };

export function SpecificationMigration() {
  const [products, setProducts] = useState<BulkImageCatalogProduct[]>([]);
  const [existing, setExisting] = useState<{ rows: number; products: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [matchReview, setMatchReview] = useState<BulkImageReview | null>(null);
  const [descriptions, setDescriptions] = useState<Map<string, ShopifyDescription>>(new Map());
  const [specReview, setSpecReview] = useState<SpecReview | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(80);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [safeResult, setSafeResult] = useState<{ approved: number; remaining: number; conflicts: number; categories: Record<string, number> } | null>(null);

  // Read-only: the 82 batch products and how many specification rows this environment already has for them.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    (async () => {
      try {
        const selection = selectAndroidBatch(await loadPublishProducts(client));
        const catalog = selection.targets.map((product) => ({ id: product.id, title: product.title, slug: product.slug, brand: product.brandName, hasPrimary: true, mediaCount: 1 }));
        let rows = 0;
        const withSpecs = new Set<string>();
        for (let index = 0; index < catalog.length; index += 40) {
          const { data, error } = await client
            .from("product_specifications")
            .select("product_id")
            .in("product_id", catalog.slice(index, index + 40).map((product) => product.id));
          if (error) throw new Error(error.message);
          for (const row of (data ?? []) as { product_id: string }[]) {
            rows += 1;
            withSpecs.add(row.product_id);
          }
        }
        if (active) {
          setProducts(catalog);
          setExisting({ rows, products: withSpecs.size });
        }
      } catch (caught) {
        if (active) setLoadError(caught instanceof Error ? caught.message : "Could not read the catalog.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const states = useMemo(() => (matchReview ? reviewSetStates(matchReview, products) : null), [matchReview, products]);
  const usable = useMemo(() => {
    const map = new Map<string, string>();
    if (!matchReview || !states) return map;
    for (const set of matchReview.sets) {
      const state = states.get(set.setId);
      if (state?.targetId && (state.status === "matched" || state.status === "confirmed") && set.handle) map.set(state.targetId, set.handle);
    }
    return map;
  }, [matchReview, states]);

  function extractAll(nextMatch: BulkImageReview, nextDescriptions: Map<string, ShopifyDescription>, previous: SpecReview | null) {
    const nextStates = reviewSetStates(nextMatch, products);
    const entries = [];
    for (const set of nextMatch.sets) {
      const state = nextStates.get(set.setId);
      const product = state?.targetId ? products.find((candidate) => candidate.id === state.targetId) : undefined;
      if (!state || !product || !set.handle || (state.status !== "matched" && state.status !== "confirmed")) continue;
      const description = nextDescriptions.get(set.handle);
      entries.push({
        productId: product.id,
        productTitle: product.title,
        productKey: product.slug,
        handle: set.handle,
        extraction: extractSpecifications({ productTitle: product.title, shopifyTitle: description?.title, bodyHtml: description?.bodyHtml ?? "", metafields: description?.metafields ?? {} }),
      });
    }
    const fresh = buildSpecReview(entries);
    setSpecReview(previous ? mergeSpecReviews(previous, fresh) : fresh);
  }

  async function loadAndExtract() {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    setNotice("");
    try {
      const exported = await readShopifyExport(file);
      if ("error" in exported) {
        setErrors([exported.error]);
        return;
      }
      const text = exported.text.charCodeAt(0) === 0xfeff ? exported.text.slice(1) : exported.text;
      const parsedDescriptions = parseShopifyDescriptions(csvRows(text));
      const parsed = parseShopifyReview(emptyReview(), exported.text, products);
      if (!parsed.review) {
        setErrors(parsed.errors);
        return;
      }
      setDescriptions(parsedDescriptions);
      setMatchReview(parsed.review);
      extractAll(parsed.review, parsedDescriptions, null);
      setNotice(`Loaded ${parsedDescriptions.size} Shopify products from ${exported.csvName}.`);
    } finally {
      setBusy(false);
    }
  }

  /** Product-level conflict decision: the chosen source is Confirmed and every competing source becomes Not Used (existing logic). */
  function chooseConflictSource(productId: string, setId: string, handle: string) {
    resolveSource((current) => chooseSourceSet(current, setId, products));
    setResolved((current) => ({ ...current, [productId]: handle }));
  }

  function resolveSource(change: (review: BulkImageReview) => BulkImageReview) {
    if (!matchReview) return;
    const next = change(matchReview);
    setMatchReview(next);
    extractAll(next, descriptions, specReview);
  }

  const update = (change: (review: SpecReview) => SpecReview) => setSpecReview((current) => (current ? change(current) : current));

  const unresolved = useMemo(() => {
    if (!matchReview || !states) return [];
    return matchReview.sets
      .filter((set) => {
        const state = states.get(set.setId);
        return state && state.targetId && !["matched", "confirmed", "not_used", "skipped", "invalid", "conflict"].includes(state.status);
      })
      .map((set) => ({ set, state: states.get(set.setId)! }));
  }, [matchReview, states]);
  const conflictGroups = useMemo(() => (matchReview ? buildConflictGroups(matchReview, products, descriptions) : []), [matchReview, products, descriptions]);
  const multiples = useMemo(() => (matchReview && states ? matchReview.sets.filter((set) => states.get(set.setId)?.status === "multiple") : []), [matchReview, states]);

  const skippedSources = useMemo(() => (matchReview && states ? matchReview.sets.filter((set) => states.get(set.setId)?.status === "skipped" && Boolean(set.handle)) : []), [matchReview, states]);
  const summary = specReview ? reviewSummary(specReview, products.length, usable.size, skippedSources.length) : null;
  const unresolvedSources = unresolved.length + multiples.length;
  const sourceTexts = useMemo(() => new Map([...descriptions].map(([handle, description]) => [handle, sourceTextOf(description.bodyHtml)])), [descriptions]);
  const brandOf = useMemo(() => new Map(products.map((product) => [product.id, product.brand])), [products]);
  const verdicts = useMemo(() => {
    const map = new Map<string, ReviewVerdict>();
    if (!specReview) return map;
    for (const proposal of specReview.proposals)
      if (proposal.confidence === "Review" && proposal.status === "proposed" && proposal.alternatives.length === 0)
        map.set(proposal.id, classifyReviewProposal(proposal, { brand: brandOf.get(proposal.productId) ?? null, sourceText: sourceTexts.get(proposal.handle) ?? "" }));
    return map;
  }, [specReview, brandOf, sourceTexts]);
  const safeReviewCount = [...verdicts.values()].filter((verdict) => verdict.safe).length;

  /** Approves only the Review rows whose evidence is a direct, unambiguous statement about this product. */
  function approveSafeReview() {
    if (!specReview) return;
    const result = approveSafeReviewSpecs(specReview, (proposal) => ({ brand: brandOf.get(proposal.productId) ?? null, sourceText: sourceTexts.get(proposal.handle) ?? "" }));
    const categories: Record<string, number> = {};
    for (const entry of result.blocked) categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    const conflicts = specReview.proposals.filter((proposal) => proposal.status === "conflict").length;
    setSpecReview(result.review);
    setSafeResult({ approved: result.approved, remaining: result.blocked.length, conflicts, categories });
    setNotice(`Safe Review specs approved: ${result.approved} · Review specs still unresolved: ${result.blocked.length} · Conflict specs untouched: ${conflicts}.`);
  }

  /** Bulk approval depends only on the proposals themselves — never on whether other sources are still unresolved. */
  function approveHigh() {
    if (!specReview) return;
    const next = approveAllHighConfidence(specReview);
    const gained = next.proposals.filter((proposal) => proposal.status === "approved").length - specReview.proposals.filter((proposal) => proposal.status === "approved").length;
    const after = reviewSummary(next, products.length, usable.size, skippedSources.length);
    setSpecReview(next);
    setNotice(
      gained > 0
        ? `Approved ${gained} high-confidence specification${gained === 1 ? "" : "s"}. ${after.reviewRemaining} Review and ${after.conflictRemaining} Conflict row${after.conflictRemaining === 1 ? "" : "s"} stay manual.${unresolvedSources + skippedSources.length ? ` ${unresolvedSources + skippedSources.length} unresolved/skipped source(s) contribute no rows.` : ""}`
        : "No high-confidence specification was waiting for approval (all eligible rows are already approved, rejected or need a decision).",
    );
  }
  const productTitles = useMemo(() => new Map(products.map((product) => [product.id, product.title])), [products]);

  const rows = useMemo(() => {
    if (!specReview) return [];
    const needle = query.trim().toLowerCase();
    const matches = (proposal: SpecProposal) => {
      switch (filter) {
        case "high": return proposal.confidence === "High" && proposal.status !== "conflict";
        case "review": return proposal.confidence === "Review" && proposal.status !== "conflict";
        case "conflict": return proposal.status === "conflict";
        case "approved": return proposal.status === "approved";
        case "rejected": return proposal.status === "rejected";
        case "none": return false;
        default: return true;
      }
    };
    return specReview.proposals
      .filter((proposal) => matches(proposal) && (!needle || [proposal.productTitle, proposal.section, proposal.name, proposal.value, proposal.handle, proposal.sourceType, proposal.evidence].some((value) => value.toLowerCase().includes(needle))))
      .sort((a, b) => a.productTitle.localeCompare(b.productTitle) || a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  }, [specReview, filter, query]);
  const noSpecProducts = useMemo(() => (specReview ? specReview.productsWithoutSpecs.map((id) => productTitles.get(id) ?? id).sort() : []), [specReview, productTitles]);
  const exported = specReview ? approvedSpecificationRows(specReview) : { rows: [], errors: [] };

  async function exportApproved() {
    if (!specReview || exported.rows.length === 0 || exported.errors.length > 0) return;
    const bytes = await buildSpecificationsWorkbook(exported.rows);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Approved-Specifications-${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${exported.rows.length} approved specification row${exported.rows.length === 1 ? "" : "s"} as a new file (Specifications sheet). Nothing was written to the catalog.`);
  }

  const visible = rows.slice(0, limit);
  const groups = grouped ? [...new Set(visible.map((proposal) => proposal.productId))] : [];

  const renderRow = (proposal: SpecProposal) => {
    const blocker = proposal.status === "conflict" ? null : approvalBlocker(specReview!, proposal);
    return (
      <tr key={proposal.id} className={`spec-row ${proposal.status}`}>
        <td>
          <input type="checkbox" aria-label={`Approve ${proposal.productTitle} ${proposal.name}`} checked={proposal.status === "approved"} disabled={proposal.status === "conflict" || (proposal.status !== "approved" && Boolean(blocker))} onChange={(event) => update((current) => (event.target.checked ? approveProposal(current, proposal.id) : restoreProposal(current, proposal.id)))} />
        </td>
        <td>{proposal.productTitle}</td>
        <td>{proposal.section}</td>
        <td>{proposal.name}</td>
        <td className="spec-value">
          {editing?.id === proposal.id ? (
            <span className="spec-edit">
              <input value={editing.text} onChange={(event) => setEditing({ id: proposal.id, text: event.target.value })} aria-label="Proposed value" />
              <button type="button" onClick={() => { update((current) => editProposalValue(current, proposal.id, editing.text)); setEditing(null); }}>Save</button>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            </span>
          ) : proposal.status === "conflict" ? (
            <span className="spec-conflict">
              {proposal.alternatives.map((alternative, index) => (
                <button key={`${alternative.value}-${index}`} type="button" title={alternative.evidence} onClick={() => update((current) => resolveConflict(current, proposal.id, index))}>
                  Use “{alternative.value}”
                </button>
              ))}
            </span>
          ) : (
            <>
              <strong>{proposal.value}</strong>
              {proposal.ownerEdited && <small className="spec-owner"> Owner Edited (was “{proposal.originalValue}”)</small>}
              {proposal.ownerResolved && <small className="spec-owner"> Owner Resolved</small>}
            </>
          )}
        </td>
        <td>{proposal.status === "conflict" ? "Conflict" : proposal.confidence}</td>
        <td className="spec-evidence">
          <small>
            {proposal.sourceType}: {proposal.evidence}
          </small>
          {verdicts.get(proposal.id) && (
            <small className={`spec-verdict ${verdicts.get(proposal.id)!.safe ? "safe" : "manual"}`} title={verdicts.get(proposal.id)!.safe ? "Direct, unambiguous evidence" : (verdicts.get(proposal.id) as { detail: string }).detail}>
              {verdicts.get(proposal.id)!.safe ? "Safe to approve" : `Manual: ${(verdicts.get(proposal.id) as { category: ReviewBlockCategory }).category}`}
            </small>
          )}
        </td>
        <td><code>{proposal.handle}</code></td>
        <td><span className={`bulk-images-status ${proposal.status === "approved" ? "matched" : proposal.status === "conflict" ? "conflict" : proposal.status === "rejected" ? "invalid" : "review"}`}>{STATUS_LABEL[proposal.status]}</span></td>
        <td className="bulk-images-actions">
          {proposal.status !== "conflict" && (
            <>
              <button type="button" disabled={proposal.status === "approved" || Boolean(blocker)} title={blocker ?? undefined} onClick={() => update((current) => approveProposal(current, proposal.id))}>Approve</button>
              <button type="button" disabled={proposal.status === "rejected"} onClick={() => update((current) => rejectProposal(current, proposal.id))}>Reject</button>
              <button type="button" onClick={() => setEditing({ id: proposal.id, text: proposal.value })}>Edit</button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <section className="admin-panel spec-migration" aria-labelledby="spec-migration-title">
      <span className="admin-kicker">LEGACY · ONE-TIME MIGRATION</span>
      <h2 id="spec-migration-title">Legacy Shopify Specification Migration</h2>
      <p>
        <strong>Legacy Shopify source — one-time migration.</strong> Proposes structured specifications for the imported Android products from the Shopify product descriptions. Only
        values stated in the text are proposed, each with its evidence; nothing is inferred or invented. This is review-only: it does not write to the catalog. Approved rows export as a
        new <em>Specifications</em> sheet in the Android importer format. Shopify is not part of any future routine update.
      </p>
      <div className={`bulk-images-env ${target.environment === "production" ? "production" : "development"}`} role="status">
        <span>Environment (read-only)</span>
        <strong>{target.environment ? target.environment.toUpperCase() : "UNKNOWN"}</strong>
        <small>
          {loadError
            ? "Not loaded"
            : existing
              ? `${products.length} Android products · ${existing.rows} specification rows already stored (${existing.products} products with specs)`
              : "Loading…"}
        </small>
      </div>
      {loadError && <p className="bulk-images-error" role="alert">{loadError}</p>}

      <div className="bulk-images-load">
        <label>
          Shopify Products export (.csv or .zip)
          <input type="file" accept=".csv,.zip,text/csv,application/zip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className="admin-primary" disabled={!file || busy || products.length === 0} onClick={() => void loadAndExtract()}>
          {busy ? "Extracting…" : "Load & Extract Specifications"}
        </button>
      </div>
      {errors.length > 0 && <ul className="bulk-images-error" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      {notice && <p className="bulk-images-note" role="status">{notice}</p>}

      {summary && specReview && (
        <>
          <div className="bulk-images-cards" aria-label="Specification summary">
            {(
              [
                ["Products targeted", summary.targetedProducts],
                ["Safely matched source", summary.safelyMatchedProducts],
                ["Need source review", summary.needingSourceReview],
                ["Skipped / unresolved sources", summary.skippedSources + unresolvedSources],
                ["With proposals", summary.productsWithProposals],
                ["No extractable specs", summary.productsWithNoSpecs],
                ["High confidence", summary.high],
                ["Approved specs", summary.approved],
                ["Review specs remaining", summary.reviewRemaining],
                ["Conflict specs remaining", summary.conflictRemaining],
                ["Rejected", summary.rejected],
                ["Products with no approved specs", summary.productsWithNoApproved],
              ] as const
            ).map(([label, value]) => (
              <article key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>

          {(conflictGroups.length > 0 || Object.keys(resolved).length > 0) && (
            <div className="bulk-images-devreport spec-conflicts" aria-label="Source conflicts">
              <strong>Source conflicts — {conflictGroups.length} product{conflictGroups.length === 1 ? "" : "s"}</strong>
              <p>Several Shopify products match one catalog product. Pick the source to extract from; nothing is chosen for you.</p>
              {conflictGroups.map((group) => (
                <article key={group.productId} className="spec-conflict-card">
                  <h4>
                    {group.productTitle} <small>{group.sources.length} competing sources</small>
                  </h4>
                  <div className="spec-conflict-sources">
                    {group.sources.map((source, index) => (
                      <div key={source.setId} className={`spec-conflict-source${group.recommendation?.setId === source.setId ? " best" : ""}`}>
                        <strong>Source {String.fromCharCode(65 + index)}</strong>
                        <span>{source.shopifyTitle}</span>
                        <code>{source.handle}</code>
                        <small>
                          Specs: {source.high} High / {source.review} Review / {source.conflicts} Conflict · Images: {source.imageCount} · Description: {source.bodyChars} chars
                          {source.shopifyStatus ? ` · ${source.shopifyStatus}` : ""}
                        </small>
                        <small>
                          Chipset {source.key.chipset ?? "—"} · Display {source.key.displaySize ?? "—"} · Battery {source.key.battery ?? "—"} · Charging {source.key.charging ?? "—"} · OS {source.key.os ?? "—"} · Camera {source.key.camera ?? "—"}
                        </small>
                        <small className="spec-preview">{source.preview || "No description text."}</small>
                        <button type="button" onClick={() => chooseConflictSource(group.productId, source.setId, source.handle)}>
                          Use this source
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className={group.safe ? "spec-recommended" : "spec-norec"}>
                    {group.safe && group.recommendation ? (
                      <>
                        <strong>Recommended:</strong> <code>{group.recommendation.handle}</code> — {group.recommendation.reason}
                      </>
                    ) : (
                      <>
                        <strong>No safe recommendation.</strong> {group.recommendation ? `Best-ranked: ${group.recommendation.handle} — ${group.recommendation.reason}` : ""}
                      </>
                    )}{" "}
                    <button type="button" className="admin-secondary" disabled={!group.safe || !group.recommendation} onClick={() => group.recommendation && chooseConflictSource(group.productId, group.recommendation.setId, group.recommendation.handle)}>
                      Use recommended source
                    </button>
                  </p>
                </article>
              ))}
              {Object.entries(resolved).map(([productId, handle]) => (
                <p key={productId} className="spec-resolved">
                  ✓ Resolved: {productTitles.get(productId)} → <code>{handle}</code>
                </p>
              ))}
            </div>
          )}

          {(unresolved.length > 0 || multiples.length > 0) && (
            <div className="bulk-images-devreport" aria-label="Source resolution">
              <strong>Sources needing a decision ({unresolved.length + multiples.length}) — no specs are extracted from them until resolved</strong>
              <div className="bulk-images-bulk">
                <button type="button" className="admin-secondary" disabled={!unresolved.some((entry) => entry.state.status === "review")} onClick={() => resolveSource((current) => confirmAllReviewSuggestions(current, products).review)}>
                  Confirm all review suggestions
                </button>
              </div>
              <p className="spec-skip-note">
                {unresolvedSources} source{unresolvedSources === 1 ? "" : "s"} unresolved — {unresolvedSources === 1 ? "it" : "they"} will be skipped. Safe specifications for resolved products can still be approved.
              </p>
              <ul>
                {unresolved.slice(0, 40).map(({ set, state }) => (
                  <li key={set.setId}>
                    {state.status === "review" ? "Review" : "Conflict"}: <code>{set.handle}</code> → {productTitles.get(state.targetId!)}{" "}
                    <button type="button" onClick={() => resolveSource((current) => (state.status === "review" ? confirmMatch(current, set.setId, products) : chooseSourceSet(current, set.setId, products)))}>
                      {state.status === "review" ? "Confirm match" : "Use this source"}
                    </button>{" "}
                    <button type="button" onClick={() => resolveSource((current) => skipSet(current, set.setId))}>
                      Leave unresolved
                    </button>
                  </li>
                ))}
                {multiples.map((set) => (
                  <li key={set.setId}>
                    Multiple: <code>{set.handle}</code> →{" "}
                    {set.match.candidateProductIds.map((id) => (
                      <button key={id} type="button" onClick={() => resolveSource((current) => assignProduct(current, set.setId, id, products))}>
                        Use {productTitles.get(id) ?? "product"}
                      </button>
                    ))}{" "}
                    <button type="button" onClick={() => resolveSource((current) => skipSet(current, set.setId))}>
                      Leave unresolved (skip source)
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {skippedSources.length > 0 && (
            <div className="bulk-images-devreport" aria-label="Skipped sources">
              <strong>Skipped sources ({skippedSources.length}) — mapped to no product, no specification from them can be approved or exported</strong>
              <ul>
                {skippedSources.map((set) => (
                  <li key={set.setId}>
                    <code>{set.handle}</code> ({set.title}){" "}
                    <button type="button" onClick={() => resolveSource((current) => restoreSet(current, set.setId))}>
                      Restore to the decision list
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bulk-images-bulk" role="group" aria-label="Bulk approval">
            <button type="button" className="admin-secondary" disabled={safeReviewCount === 0} title="Approves only Review rows whose evidence states the value directly, without speculation, alternatives, another product or a 4G/5G version mix-up." onClick={approveSafeReview}>
              Approve safe review specs ({safeReviewCount})
            </button>
            <button type="button" className="admin-secondary" disabled={specReview.proposals.length === 0} onClick={approveHigh}>
              Approve all high-confidence specs ({summary.highAwaitingApproval} waiting)
            </button>
            <button type="button" className="admin-secondary" disabled={exported.rows.length === 0 || exported.errors.length > 0} onClick={() => void exportApproved()}>
              Export approved Specifications workbook ({exported.rows.length} rows)
            </button>
            <button type="button" className="admin-primary" disabled title="Not enabled: the actual specification import needs a separate Owner approval.">
              Apply approved specifications
            </button>
            <small>Review state only. Approving and exporting never writes to the catalog; applying is disabled in this tool.</small>
          </div>
          {exported.errors.length > 0 && <ul className="bulk-images-error">{exported.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}</ul>}
          <p className="bulk-images-note">
            If the approved set were imported now: {summary.productsWithApproved} product(s) would receive {summary.approved} specification row(s); {summary.safelyMatchedProducts - summary.productsWithApproved} matched product(s) would still have none; {summary.conflicts} conflict(s) and {summary.unresolvedReview} Review row(s) unresolved; this environment currently stores {existing?.rows ?? "…"} rows for these products.
          </p>

          {safeResult && (
            <div className="bulk-images-devreport" role="status" aria-label="Safe review result">
              <strong>Safe Review specs approved: {safeResult.approved}</strong>
              <p>
                Review specs still unresolved: {safeResult.remaining} · Conflict specs untouched: {safeResult.conflicts} · Wrong / speculative / ambiguous rows skipped: {safeResult.remaining}
              </p>
              {Object.keys(safeResult.categories).length > 0 && (
                <ul>
                  {Object.entries(safeResult.categories).map(([category, count]) => (
                    <li key={category}>
                      {category}: {count}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="bulk-images-tools">
            <div className="bulk-images-filters" role="group" aria-label="Filter proposals">
              {FILTERS.map((entry) => (
                <button key={entry.key} type="button" className={filter === entry.key ? "active" : ""} aria-pressed={filter === entry.key} onClick={() => { setFilter(entry.key); setLimit(80); }}>
                  {entry.label}
                </button>
              ))}
              <button type="button" className={grouped ? "active" : ""} aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
                Group by product
              </button>
            </div>
            <label className="bulk-images-search">
              <input type="search" placeholder="Search product, spec, value, evidence or source" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(80); }} />
            </label>
          </div>

          {filter === "none" ? (
            <ul className="spec-none" aria-label="Products with no extractable specs">
              {noSpecProducts.length === 0 && <li>Every matched product has at least one proposal.</li>}
              {noSpecProducts.map((title) => (
                <li key={title}>{title} — the Shopify text states no specification.</li>
              ))}
            </ul>
          ) : (
            <div className="bulk-images-table">
              <table>
                <thead>
                  <tr>
                    <th>Approve</th><th>Product</th><th>Section</th><th>Specification</th><th>Proposed value</th><th>Confidence</th><th>Evidence</th><th>Source Handle</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped
                    ? groups.flatMap((productId) => [
                        <tr key={`g-${productId}`} className="spec-group">
                          <td colSpan={10}>
                            <strong>{productTitles.get(productId)}</strong>{" "}
                            <button type="button" onClick={() => update((current) => approveAllHighConfidence(current, productId))}>Approve all High-confidence for this product</button>
                          </td>
                        </tr>,
                        ...visible.filter((proposal) => proposal.productId === productId).map(renderRow),
                      ])
                    : visible.map(renderRow)}
                  {visible.length === 0 && <tr><td colSpan={10} className="bulk-images-empty">No proposals for this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > limit && filter !== "none" && (
            <button type="button" className="admin-secondary bulk-images-more" onClick={() => setLimit((current) => current + 80)}>
              Show 80 more of {rows.length - limit} remaining
            </button>
          )}
        </>
      )}
    </section>
  );
}
