/**
 * Review state for the one-time Shopify specification migration. Pure: approvals, rejections, edits and the export
 * only change local state or produce a file. Nothing here writes to Supabase, Cloudinary or any workbook on disk.
 */
import { loadExcelJs, SPECIFICATION_HEADERS } from "./catalogWorkbook.ts";
import { SPEC_SECTIONS, type ExtractionResult, type SpecConfidence, type SpecSection, type SpecSourceType } from "./productSpecificationExtraction.ts";

export type SpecStatus = "proposed" | "approved" | "rejected" | "conflict";

export type SpecProposal = {
  id: string;
  productId: string;
  productTitle: string;
  /** Product Key of the importer's Specifications sheet = the product slug. */
  productKey: string;
  handle: string;
  section: SpecSection;
  name: string;
  value: string;
  /** The extractor's value; stays visible after an Owner edit. */
  originalValue: string;
  confidence: SpecConfidence;
  sourceType: SpecSourceType;
  evidence: string;
  status: SpecStatus;
  ownerEdited: boolean;
  ownerResolved: boolean;
  alternatives: { value: string; evidence: string; sourceType: SpecSourceType }[];
};

export type SpecReview = { proposals: SpecProposal[]; productsWithoutSpecs: string[] };

export type SpecSourceEntry = { productId: string; productTitle: string; productKey: string; handle: string; extraction: ExtractionResult };

const keyOf = (proposal: Pick<SpecProposal, "productId" | "section" | "name">) => `${proposal.productId}|${proposal.section}|${proposal.name.trim().toLowerCase()}`;

export function buildSpecReview(entries: SpecSourceEntry[]): SpecReview {
  const proposals: SpecProposal[] = [];
  const productsWithoutSpecs: string[] = [];
  for (const entry of entries) {
    const base = { productId: entry.productId, productTitle: entry.productTitle, productKey: entry.productKey, handle: entry.handle, ownerEdited: false, ownerResolved: false };
    for (const spec of entry.extraction.specs)
      proposals.push({ ...base, id: `${entry.productId}|${spec.section}|${spec.name}`, section: spec.section, name: spec.name, value: spec.value, originalValue: spec.value, confidence: spec.confidence, sourceType: spec.sourceType, evidence: spec.evidence, status: "proposed", alternatives: [] });
    for (const conflict of entry.extraction.conflicts)
      proposals.push({ ...base, id: `${entry.productId}|${conflict.section}|${conflict.name}`, section: conflict.section, name: conflict.name, value: "", originalValue: "", confidence: "Review", sourceType: conflict.alternatives[0].sourceType, evidence: conflict.alternatives.map((alt) => alt.evidence).join("  ⟷  "), status: "conflict", alternatives: conflict.alternatives });
    if (entry.extraction.specs.length === 0 && entry.extraction.conflicts.length === 0) productsWithoutSpecs.push(entry.productId);
  }
  return { proposals, productsWithoutSpecs };
}

const replace = (review: SpecReview, id: string, change: (proposal: SpecProposal) => SpecProposal): SpecReview => ({
  ...review,
  proposals: review.proposals.map((proposal) => (proposal.id === id ? change(proposal) : proposal)),
});

/** Why a proposal cannot be approved right now, or null. */
export function approvalBlocker(review: SpecReview, proposal: SpecProposal): string | null {
  if (proposal.status === "conflict") return "Conflict: resolve it by choosing a value first.";
  if (!proposal.section.trim() || !proposal.name.trim() || !proposal.value.trim() || !proposal.productKey.trim()) return "Section, name, value and product key are all required.";
  const duplicate = review.proposals.find((other) => other.id !== proposal.id && keyOf(other) === keyOf(proposal) && other.status === "approved");
  return duplicate ? `Another approved row already sets ${proposal.section} / ${proposal.name} for this product.` : null;
}

export function approveProposal(review: SpecReview, id: string): SpecReview {
  const proposal = review.proposals.find((entry) => entry.id === id);
  if (!proposal || approvalBlocker(review, proposal)) return review;
  return replace(review, id, (entry) => ({ ...entry, status: "approved" }));
}

export const rejectProposal = (review: SpecReview, id: string): SpecReview =>
  replace(review, id, (entry) => (entry.status === "conflict" ? entry : { ...entry, status: "rejected" }));

export const restoreProposal = (review: SpecReview, id: string): SpecReview =>
  replace(review, id, (entry) => (entry.status === "rejected" || entry.status === "approved" ? { ...entry, status: "proposed" } : entry));

/** Owner edits the VALUE. The row is marked Owner Edited, the original evidence stays, and it must be approved again. */
export function editProposalValue(review: SpecReview, id: string, value: string): SpecReview {
  const next = value.trim().replace(/\s+/g, " ");
  if (!next) return review;
  return replace(review, id, (entry) => (entry.status === "conflict" ? entry : { ...entry, value: next, ownerEdited: next !== entry.originalValue, status: "proposed" }));
}

/** Owner picks one of the conflicting values (an explicit decision, so the row is approved and marked Owner Resolved). */
export function resolveConflict(review: SpecReview, id: string, alternativeIndex: number): SpecReview {
  return replace(review, id, (entry) => {
    const alternative = entry.status === "conflict" ? entry.alternatives[alternativeIndex] : undefined;
    return alternative ? { ...entry, value: alternative.value, originalValue: alternative.value, sourceType: alternative.sourceType, evidence: alternative.evidence, status: "approved", ownerResolved: true, confidence: "Review" } : entry;
  });
}

const isBulkEligible = (review: SpecReview, proposal: SpecProposal) =>
  proposal.confidence === "High" && proposal.status === "proposed" && proposal.alternatives.length === 0 && !approvalBlocker(review, proposal);

/** Approves only High-confidence, conflict-free proposals. Review and Conflict rows are never touched. */
export function approveAllHighConfidence(review: SpecReview, productId?: string): SpecReview {
  let next = review;
  for (const proposal of review.proposals) {
    if (productId && proposal.productId !== productId) continue;
    if (isBulkEligible(next, proposal)) next = replace(next, proposal.id, (entry) => ({ ...entry, status: "approved" }));
  }
  return next;
}

export function reviewSummary(review: SpecReview, targetedProducts: number, safelyMatchedProducts: number) {
  const rows = review.proposals;
  const count = (predicate: (proposal: SpecProposal) => boolean) => rows.filter(predicate).length;
  const productsWithProposals = new Set(rows.map((proposal) => proposal.productId));
  const approved = rows.filter((proposal) => proposal.status === "approved");
  return {
    targetedProducts,
    safelyMatchedProducts,
    needingSourceReview: targetedProducts - safelyMatchedProducts,
    productsWithProposals: productsWithProposals.size,
    productsWithNoSpecs: safelyMatchedProducts - productsWithProposals.size,
    high: count((proposal) => proposal.confidence === "High" && proposal.status !== "conflict"),
    review: count((proposal) => proposal.confidence === "Review" && proposal.status !== "conflict"),
    conflicts: count((proposal) => proposal.status === "conflict"),
    approved: approved.length,
    rejected: count((proposal) => proposal.status === "rejected"),
    productsWithApproved: new Set(approved.map((proposal) => proposal.productId)).size,
    unresolvedReview: count((proposal) => proposal.confidence === "Review" && proposal.status === "proposed"),
  };
}

// ---------------- Export (Specifications sheet of the Android importer) ----------------

export type SpecificationExportRow = { productKey: string; section: string; name: string; value: string };

/** Approved rows only, in the importer's Specifications format. Duplicate Product Key + Section + Name rows are an error. */
export function approvedSpecificationRows(review: SpecReview): { rows: SpecificationExportRow[]; errors: string[] } {
  const approved = review.proposals.filter((proposal) => proposal.status === "approved");
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const proposal of approved) {
    if (!proposal.productKey.trim() || !proposal.section.trim() || !proposal.name.trim() || !proposal.value.trim()) errors.push(`${proposal.productTitle}: ${proposal.section} / ${proposal.name} has an empty field.`);
    const key = `${proposal.productKey}|${proposal.section.toLowerCase()}|${proposal.name.toLowerCase()}`;
    if (seen.has(key)) errors.push(`${proposal.productTitle}: duplicate ${proposal.section} / ${proposal.name}.`);
    seen.add(key);
  }
  const rows = approved
    .slice()
    .sort((a, b) => a.productTitle.localeCompare(b.productTitle) || SPEC_SECTIONS.indexOf(a.section) - SPEC_SECTIONS.indexOf(b.section) || a.name.localeCompare(b.name))
    .map((proposal) => ({ productKey: proposal.productKey, section: proposal.section, name: proposal.name, value: proposal.value }));
  return { rows, errors };
}

/** A workbook with ONE sheet, "Specifications", using exactly the importer's four headers — ready to merge into the Android workbook. */
export async function buildSpecificationsWorkbook(rows: SpecificationExportRow[]): Promise<Uint8Array<ArrayBuffer>> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "iSolutions Admin Studio";
  workbook.title = "Approved product specifications (one-time Shopify migration)";
  const sheet = workbook.addWorksheet("Specifications");
  sheet.columns = SPECIFICATION_HEADERS.map((header, index) => ({ header, key: header, width: [30, 18, 26, 40][index], ...(index === 0 ? { style: { numFmt: "@" } } : {}) }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow([row.productKey, row.section, row.name, row.value]);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer) as Uint8Array<ArrayBuffer>;
}

/**
 * Re-extraction after the Owner resolves more Shopify sources: Owner decisions (approved / rejected / edited / resolved)
 * survive for rows whose extracted value did not change; everything else starts fresh.
 */
export function mergeSpecReviews(previous: SpecReview, fresh: SpecReview): SpecReview {
  const old = new Map(previous.proposals.map((proposal) => [proposal.id, proposal]));
  return {
    ...fresh,
    proposals: fresh.proposals.map((proposal) => {
      const before = old.get(proposal.id);
      if (!before || before.status === "proposed" || before.status === "conflict") return proposal;
      const sameSource = before.originalValue === proposal.originalValue && proposal.status !== "conflict" && before.evidence === proposal.evidence;
      return sameSource || before.ownerResolved ? { ...proposal, status: before.status, value: before.value, ownerEdited: before.ownerEdited, ownerResolved: before.ownerResolved } : proposal;
    }),
  };
}
