/**
 * Deterministic classifier for the Legacy Shopify Specification Migration "Needs Review" rows.
 * A Review row may be bulk-approved ONLY when its evidence directly states the value as a fact about THIS product:
 * no speculative / forward-looking wording, no unresolved alternatives, no other product named, no 4G/5G variant mix-up,
 * and a source that is not itself speculative or contaminated by another product. Everything else stays manual with a reason.
 * Pure review state: no database access, nothing is written anywhere.
 */
import { htmlToText } from "./productSpecificationExtraction.ts";
import { approvalBlocker, type SpecProposal, type SpecReview } from "./specificationReview.ts";

export type ReviewBlockCategory =
  | "Speculative evidence"
  | "Multiple possible values"
  | "Different product named in evidence"
  | "Variant ambiguity"
  | "Source contamination"
  | "Manual review required";

export type ReviewVerdict = { safe: true } | { safe: false; category: ReviewBlockCategory; detail: string };

export type ReviewContext = {
  /** Brand of the catalog product ("Nothing", "Samsung"…). */
  brand: string | null;
  /** Plain text of the whole Shopify description the proposal came from. */
  sourceText: string;
};

/** Forward-looking or hedged wording: the statement is not a fact about a shipped product. */
const SPECULATIVE = /\b(expect(?:s|ed|ing)?|likely|anticipat(?:ed|es|ion)|rumou?r(?:ed|s)?|reportedly|probably|speculat\w*|might|may|could|upcoming|leak(?:ed|s)?|will\s+(?:launch|feature|come|offer|boast|house|debut))\b/i;
/** A source with this many speculative sentences is a forward-looking article, not a product description. */
const SPECULATIVE_SOURCE_LIMIT = 3;

/** Phone brands whose name followed by a model ("CMF Phone 2 Pro", "Samsung Galaxy S25") means another product is being described. */
const KNOWN_BRANDS = ["Apple", "Samsung", "Xiaomi", "Redmi", "Poco", "Oppo", "Vivo", "Realme", "Honor", "Huawei", "Infinix", "Tecno", "itel", "Nothing", "CMF", "Motorola", "OnePlus", "Google", "Nokia", "HMD", "Sony", "Asus", "Lenovo", "ZTE", "Vgotel", "iQOO", "Meizu"];
/** Sub-brands that are the same maker: a Redmi Note is a Xiaomi product, Galaxy is Samsung's own line. */
const SAME_MAKER: Record<string, string[]> = { xiaomi: ["redmi", "poco"], redmi: ["xiaomi", "poco"], poco: ["xiaomi", "redmi"], hmd: ["nokia"], nokia: ["hmd"] };
const FAMILY = "Phone|Galaxy|Redmi|Reno|Note|Edge|Fold|Flip|Spark|Camon|Hot|Poco|Pixel|Find|Mate|Nova|Magic|Moto|Zenfone|Xperia|Pad|Tab";

/** Another product named in the text: a DIFFERENT known brand directly followed by a phone model-family word ("CMF Phone"). Component makers ("Sony IMX896") are not products. */
export function otherProductNamed(text: string, brand: string | null): string | null {
  const own = (brand ?? "").trim().toLowerCase();
  const allowed = new Set([own, ...(SAME_MAKER[own] ?? [])]);
  const pattern = new RegExp(`\\b(${KNOWN_BRANDS.join("|")})\\s+(?:${FAMILY})\\b`, "g");
  for (const match of text.matchAll(pattern)) if (!allowed.has(match[1].toLowerCase())) return match[0];
  return null;
}

const speculativeSentences = (sourceText: string) => sourceText.split(/\n|(?<=[.!?])\s+/).filter((sentence) => SPECULATIVE.test(sentence)).length;

/** Number-like cores of a value ("25W" -> "25", "IP68" -> "IP68", "6.5 inches" -> "6.5"). */
const cores = (value: string) => [...value.matchAll(/[A-Za-z]{0,2}\d+(?:\.\d+)?/g)].map((match) => match[0]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "25W or upgraded 45W", "IP67 or IP68", "6.5-inch or 6.6-inch": the evidence offers alternatives. */
function offersAlternatives(evidence: string, value: string): boolean {
  const parts = cores(value);
  for (let i = 0; i < parts.length; i += 1)
    for (let j = 0; j < parts.length; j += 1)
      if (i !== j && new RegExp(`${escape(parts[i])}[^.;]{0,16}\\b(?:or|either)\\b[^.;]{0,24}${escape(parts[j])}`, "i").test(evidence)) return true;
  return false;
}

/** A hedge directly qualifying the proposed NUMBER ("around 45W", "typically 5,000 mAh", "45W … depending on region"). */
function qualifiesNumber(evidence: string, value: string): boolean {
  for (const core of cores(value)) {
    const number = escape(core).replace(/^(\d)(\d{3})$/, "$1,?$2");
    if (new RegExp(`\\b(?:around|approximately|approx\\.?|about|roughly|estimated|typically|usually|~)\\s*(?:up\\s*to\\s*)?(?:[A-Za-z]+\\s+){0,1}${number}`, "i").test(evidence)) return true;
    if (new RegExp(`${number}[^,.;]{0,30}\\bdepending\\s+on\\b|\\bdepending\\s+on\\b[^,.;]{0,30}${number}`, "i").test(evidence)) return true;
  }
  return false;
}

/** Classifies ONE Review proposal. Conservative: any doubt keeps the row manual. */
export function classifyReviewProposal(proposal: SpecProposal, context: ReviewContext): ReviewVerdict {
  const block = (category: ReviewBlockCategory, detail: string): ReviewVerdict => ({ safe: false, category, detail });
  if (proposal.status !== "proposed" || proposal.confidence !== "Review" || proposal.alternatives.length > 0)
    return block("Manual review required", "Only a Proposed Review row (not a Conflict, approved or rejected row) can be classified.");
  if (proposal.sourceType !== "Shopify Body HTML")
    return block("Manual review required", "The value comes from a generic Shopify metafield, not from a sentence that states it.");
  if (!proposal.section.trim() || !proposal.name.trim() || !proposal.value.trim()) return block("Manual review required", "A required field is empty.");
  const evidence = proposal.evidence;

  const named = otherProductNamed(evidence, context.brand);
  if (named) return block("Different product named in evidence", `The evidence names "${named}".`);
  if (SPECULATIVE.test(evidence)) return block("Speculative evidence", `Forward-looking wording: "${evidence.match(SPECULATIVE)![0]}".`);
  if (/\s\/\s/.test(proposal.value) || offersAlternatives(evidence, proposal.value)) return block("Multiple possible values", "The text offers alternatives (an \"or\" between values) or the row carries several unresolved values.");
  if (/\b[45]G\s+(?:version|variant|model|edition)s?\b|\b(?:version|variant|model|edition)s?\s+(?:with|of)\s+[45]G\b/i.test(evidence) || (/\b4G\b/.test(evidence) && /\b5G\b/.test(evidence) && /\b(version|variant)s?\b/i.test(evidence)))
    return block("Variant ambiguity", "The evidence mixes 4G / 5G versions without proving which one applies to this catalog product.");
  if (qualifiesNumber(evidence, proposal.value)) return block("Speculative evidence", "The number is qualified by hedging wording (around / typically / depending on…).");

  const contamination = otherProductNamed(context.sourceText, context.brand);
  if (contamination) return block("Source contamination", `The source description names another product ("${contamination}"), so its general statements may not be about this product.`);
  if (speculativeSentences(context.sourceText) >= SPECULATIVE_SOURCE_LIMIT) return block("Speculative evidence", "The source description is forward-looking throughout (expected / likely / anticipated).");
  return { safe: true };
}

export type SafeReviewResult = {
  review: SpecReview;
  approved: number;
  /** Review rows left manual, with the reason. */
  blocked: { id: string; category: ReviewBlockCategory; detail: string }[];
};

/**
 * Approves every Proposed Review row the classifier calls safe. High-confidence rows (already approved or not),
 * Conflict rows and rejected rows are never touched; a row whose Section + Name is already approved stays as is.
 */
export function approveSafeReviewSpecs(review: SpecReview, contextFor: (proposal: SpecProposal) => ReviewContext): SafeReviewResult {
  let next = review;
  let approved = 0;
  const blocked: SafeReviewResult["blocked"] = [];
  for (const proposal of review.proposals) {
    if (proposal.status !== "proposed" || proposal.confidence !== "Review") continue;
    const verdict = classifyReviewProposal(proposal, contextFor(proposal));
    const duplicate = verdict.safe ? approvalBlocker(next, proposal) : null;
    if (verdict.safe && !duplicate) {
      next = { ...next, proposals: next.proposals.map((entry) => (entry.id === proposal.id ? { ...entry, status: "approved" as const } : entry)) };
      approved += 1;
    } else blocked.push({ id: proposal.id, category: verdict.safe ? "Manual review required" : verdict.category, detail: verdict.safe ? (duplicate ?? "") : verdict.detail });
  }
  return { review: next, approved, blocked };
}

/** Plain text of a Shopify description (for the source-level checks). */
export const sourceTextOf = (bodyHtml: string) => htmlToText(bodyHtml);
