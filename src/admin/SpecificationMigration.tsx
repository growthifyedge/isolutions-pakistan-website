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
  reviewSetStates,
  type BulkImageCatalogProduct,
  type BulkImageReview,
} from "../lib/bulkProductImagesReview";
import { commercialWriteTarget, selectAndroidBatch } from "../lib/commercialDefaults";
import { loadPublishProducts } from "../lib/bulkPublishDb";
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
        return state && state.targetId && !["matched", "confirmed", "not_used", "skipped", "invalid"].includes(state.status);
      })
      .map((set) => ({ set, state: states.get(set.setId)! }));
  }, [matchReview, states]);
  const multiples = useMemo(() => (matchReview && states ? matchReview.sets.filter((set) => states.get(set.setId)?.status === "multiple") : []), [matchReview, states]);

  const summary = specReview ? reviewSummary(specReview, products.length, usable.size) : null;
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
                ["With proposals", summary.productsWithProposals],
                ["No extractable specs", summary.productsWithNoSpecs],
                ["High confidence", summary.high],
                ["Review", summary.review],
                ["Conflicts", summary.conflicts],
                ["Approved", summary.approved],
                ["Rejected", summary.rejected],
              ] as const
            ).map(([label, value]) => (
              <article key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>

          {(unresolved.length > 0 || multiples.length > 0) && (
            <div className="bulk-images-devreport" aria-label="Source resolution">
              <strong>Sources needing a decision ({unresolved.length + multiples.length}) — no specs are extracted from them until resolved</strong>
              <div className="bulk-images-bulk">
                <button type="button" className="admin-secondary" disabled={!unresolved.some((entry) => entry.state.status === "review")} onClick={() => resolveSource((current) => confirmAllReviewSuggestions(current, products).review)}>
                  Confirm all review suggestions
                </button>
              </div>
              <ul>
                {unresolved.slice(0, 40).map(({ set, state }) => (
                  <li key={set.setId}>
                    {state.status === "review" ? "Review" : "Conflict"}: <code>{set.handle}</code> → {productTitles.get(state.targetId!)}{" "}
                    <button type="button" onClick={() => resolveSource((current) => (state.status === "review" ? confirmMatch(current, set.setId, products) : chooseSourceSet(current, set.setId, products)))}>
                      {state.status === "review" ? "Confirm match" : "Use this source"}
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
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bulk-images-bulk" role="group" aria-label="Bulk approval">
            <button type="button" className="admin-secondary" disabled={!specReview.proposals.some((proposal) => proposal.confidence === "High" && proposal.status === "proposed")} onClick={() => update((current) => approveAllHighConfidence(current))}>
              Approve all high-confidence specs
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
