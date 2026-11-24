import {
  normalizeStockLines,
  type BrandReference,
  type CatalogSheetRow,
} from "./catalogSheet.ts";
import { normalizeCapacity } from "./bulkCatalog.ts";
import { normalizeColor } from "./catalogColors.ts";
import { CATEGORY_LABEL } from "./stockUpdateWording.ts";
import { ALL_COLOURS_LABEL, expandSupplierBlocks, type SupplierOrigin } from "./supplierListBlocks.ts";
import { CANONICAL_CONDITION, CANONICAL_PTA } from "./commercialDefaults.ts";

// Admin "Android Stock Update": parse the latest Android stock list, compare it with the CURRENT Android
// phones on the website and produce a review + an update PLAN. Pure functions only. Nothing here reads or
// writes the database; the final "Update Website" write is a separate, explicitly approved step.
// Parsing is delegated to the existing stock-line normalizer (normalizeStockLines): one parser, not two.
// Supplier blocks ("Samsung S26 Ultra 12-512Gb" + "Blk @438,000" lines) are first rewritten into one line per
// variant by supplierListBlocks.ts (Android Stock Update only; Bulk Import is not affected).
//
// Two update modes (Owner decision 2026-11-23):
//   "listed"   (Only products in this list — the page default): only the listed phones / variants change (price,
//              new variant, new phone). Nothing is hidden or shown, and the stock of existing variants is kept.
//   "complete" (Complete stock list — the original behaviour, the library default): the latest list is the truth
//              for Android availability: in the list -> keep / update price / add variant / add phone / stock 30;
//              absent -> hide (never delete); hidden but back in the list -> show again.
// In both modes images, specifications, URLs, SKUs, PTA, condition and publication data of every existing phone
// are never touched by this tool.

export type UpdateMode = "listed" | "complete";

// ---------------------------------------------------------------------------
// Catalog snapshot (read-only input)
// ---------------------------------------------------------------------------

export type CatalogDeltaVariant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  stock: number | null;
  ptaStatus: string | null;
  condition: string | null;
  conditionGrade: string | null;
  batteryHealth: number | null;
  cycleCount: number | null;
  /** product_variants.is_active — false means "hidden from the store" (the existing admin mechanism). */
  isActive: boolean;
  /** Read only so a new variant can inherit them from its siblings (never written back to existing rows). */
  warrantyOverride?: string | null;
  deliveryScope?: string | null;
};

export type CatalogDeltaProduct = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  category: string | null;
  categorySlug?: string | null;
  publicationStatus: string | null;
  mediaCount: number;
  specCount: number;
  variants: CatalogDeltaVariant[];
};

/** Owner rule (2026-10-15): every Android item in the latest list is visible with stock 30 (existing, returning, new variant or new phone). */
export const STOCK_UPDATE_TARGET = 30;

const FEATURE_PHONE_BRANDS = new Set(["nokia", "hmd"]);
const IPHONE = /\biphone\b/i;
const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * The Android phones this tool is allowed to touch: real Mobile Phones whose brand is not Apple / a feature-phone
 * brand and whose title is not an iPhone (the same rule the Android warranty backfill used). Everything else on the
 * website (iPhones, tablets, accessories, feature phones) is invisible to this tool: never matched, never hidden.
 */
export function isAndroidCatalogProduct(product: Pick<CatalogDeltaProduct, "brand" | "category" | "categorySlug" | "title">): boolean {
  const brand = lower(product.brand);
  const mobile = lower(product.categorySlug) === "mobile-phones" || lower(product.category) === "mobile phones";
  return mobile && brand !== "" && brand !== "apple" && !FEATURE_PHONE_BRANDS.has(brand) && !IPHONE.test(product.title);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type RowCategory = "smartphone" | "iphone" | "tablet" | "accessory" | "feature_phone" | "other" | "unknown";

export type ExcludedLine = { lineNumber: number; line: string; reason: string };

export type ParsedStockList = {
  rows: CatalogSheetRow[];
  excluded: ExcludedLine[];
  summary: ReturnType<typeof normalizeStockLines>["summary"];
  /** Lines rewritten from a supplier block: line number -> the Owner's own line and its heading. */
  origins?: Record<number, SupplierOrigin>;
};

const GIFT_BOX_LINE = /^gift\s*box\b/i;

const stripLeadingDecoration = (line: string) => line.replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** Raw WhatsApp-style text -> structured variant rows (one row per colour). Lines the normalizer deliberately skips are listed. */
export function parseStockList(text: string, brands: BrandReference[]): ParsedStockList {
  // Supplier blocks -> one line per variant (same line numbers), then the shared parser.
  const supplier = expandSupplierBlocks(text, brands);
  const { rows, summary } = normalizeStockLines(supplier.text, { brands });
  const excluded: ExcludedLine[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (GIFT_BOX_LINE.test(stripLeadingDecoration(line))) {
        excluded.push({ lineNumber: index + 1, line: line.trim(), reason: `${CATEGORY_LABEL.accessory} — not part of this Android update` });
      }
    });
  return supplier.variantLines ? { rows, excluded, summary, origins: supplier.origins } : { rows, excluded, summary };
}

/** "All Colours" (or "Any Colour") written instead of real colours: the Owner chooses the colours, nothing is assumed. */
export const isAllColours = (color: string | null) => Boolean(color && ALL_COLOURS_LABEL.test(color.trim()));

/** CSV / XLSX rows -> the same raw text the parser reads. Header columns (Brand, Model, RAM, Storage, Color, Price) are used when present. */
export function tableToStockText(table: string[][]): string {
  const rows = table.map((cells) => cells.map((cell) => String(cell ?? "").trim())).filter((cells) => cells.some(Boolean));
  if (!rows.length) return "";
  const header = rows[0].map((cell) => cell.toLowerCase());
  const column = (...names: string[]) => header.findIndex((cell) => names.includes(cell));
  const brand = column("brand");
  const model = column("model", "model / product title", "product", "title", "name");
  const price = column("price", "rate", "pkr");
  if (model < 0 || price < 0) return rows.map((cells) => cells.filter(Boolean).join(" ")).join("\n");
  const ram = column("ram");
  const storage = column("storage", "rom");
  const color = column("color", "colour", "colors");
  const lines: string[] = [];
  let currentBrand = "";
  for (const cells of rows.slice(1)) {
    const rowBrand = brand >= 0 ? cells[brand] : "";
    if (rowBrand && rowBrand !== currentBrand) {
      currentBrand = rowBrand;
      lines.push("", rowBrand);
    }
    const capacity = [ram >= 0 ? cells[ram] : "", storage >= 0 ? cells[storage] : ""].filter(Boolean).join("/");
    const colors = color >= 0 ? cells[color].replace(/[,;]\s*/g, "/") : "";
    lines.push([cells[model], capacity, colors, `@ ${cells[price]}`].filter(Boolean).join(" "));
  }
  return lines.join("\n");
}

/** Only "smartphone" rows take part in the Android update; every other category is listed under Not Android Phones. */
export function rowCategory(row: CatalogSheetRow): RowCategory {
  switch (row.productType) {
    case "Tablet":
      return "tablet";
    case "Accessory":
      return "accessory";
    case "Gadget":
    case "Laptop":
      return "other";
    case "Mobile Phone": {
      const brand = lower(row.brand);
      if (brand === "apple" || IPHONE.test(`${row.model ?? ""} ${row.productTitle ?? ""}`)) return "iphone";
      if (FEATURE_PHONE_BRANDS.has(brand) || (!row.storage && !row.ram)) return "feature_phone";
      return "smartphone";
    }
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

export type DeltaKind = "unchanged" | "price_change" | "new_variant" | "new_product" | "ambiguous" | "blocked";

/**
 * A possible spelling mistake for ONE existing phone ("Redmi Note 15 Pr" -> "Xiaomi Redmi Note 15 Pro"), found only when the
 * line matches no phone exactly. Offered only when exactly one same-brand phone fits, no other phone looks alike, and that
 * phone has exactly one variant with the line's RAM / storage / colour (and any PTA / condition / battery facts it states).
 */
export type SpellingSuggestion = {
  productId: string;
  productTitle: string;
  variantId: string;
  /** The listed word and the word it becomes. */
  from: string;
  to: string;
  /** Safe to apply without the Owner's click only if the variant is visible and the phone is published or a draft. */
  autoSafe: boolean;
};

/** Why a row needs the Owner (null for every other row). */
export type AttentionKind =
  /** One clear spelling correction is offered: the Owner confirms it (or corrects the line). */
  | "spelling"
  /** The line looks like one or more existing phones but cannot be matched safely: correct it, or confirm a new phone. */
  | "looks_like_existing"
  /** The Owner confirmed a phone for this line earlier, but it no longer matches exactly. */
  | "decision_stale"
  /** The line says "All Colours": the Owner ticks which existing colours of that storage get the price. */
  | "all_colours"
  /** "Only products in this list": a phone not on the website — shown for review, never created unless confirmed. */
  | "new_phone_review";

/** One existing colour the Owner can tick for an "All Colours" line (never pre-ticked). */
export type ColourChoice = { variantId: string; sku: string; color: string; ram: string | null; storage: string | null; priceMinor: number; isActive: boolean };

/** The Owner's saved per-row decision about the line's identity (from stockListDraft.applyResolutions), aligned with the rows. */
export type RowDecision = {
  /** "Yes, this line is that phone": accepted only while it is still the one spelling suggestion for the line. */
  matchProductId?: string;
  /** "This is a new phone": the line is not compared with similar-looking phones. */
  confirmNewPhone?: boolean;
};

/**
 * Spelling corrections are never applied without the Owner's click (Owner rule: no guessing). Turning this on would apply a
 * suggestion automatically when it is `autoSafe`; it stays off unless the Owner decides otherwise.
 */
export const AUTO_APPLY_SPELLING_CORRECTIONS = false;

export type DeltaEntry = {
  id: string;
  kind: DeltaKind;
  /** What the row would be if it were not held back for attention (ambiguous rows only). */
  provisionalKind: Exclude<DeltaKind, "ambiguous" | "blocked"> | null;
  category: RowCategory;
  row: CatalogSheetRow;
  label: string;
  productId: string | null;
  productTitle: string;
  productSlug: string;
  variantId: string | null;
  sku: string | null;
  currentPriceMinor: number | null;
  newPriceMinor: number | null;
  diffMinor: number | null;
  stock: number | null;
  mediaCount: number | null;
  specCount: number | null;
  /** The matched phone's publication state (null when the row matched nothing). */
  publicationStatus: string | null;
  /** Matched an existing variant that is currently hidden: the update switches it back on. */
  showAgain: boolean;
  reasons: string[];
  notes: string[];
  /** The list is the truth: this row WILL be written (price / new variant / new phone / shown again). Not an Owner choice. */
  willUpdate: boolean;
  /** New phones only: what is still needed before the phone can go live. */
  requirements: string[];
  /** Why the Owner is needed for this row (spelling / looks like an existing phone / stale decision), else null. */
  attention: AttentionKind | null;
  /** The one spelling correction offered (attention "spelling") or applied (Owner-confirmed), else null. */
  suggestion: SpellingSuggestion | null;
  /** Existing phones this unmatched line looks like. They are never hidden while the row waits for the Owner. */
  nearTitles: string[];
  /** attention "all_colours": the existing colours of the listed storage the Owner can choose from. */
  colourChoices?: ColourChoice[];
};

export type MissingAction = "hide" | "already_hidden" | "held";

/** An Android phone / variant on the website that is NOT in the latest list. Hidden, never deleted. */
export type MissingEntry = {
  id: string;
  scope: "product" | "variant";
  productId: string;
  productTitle: string;
  productSlug: string;
  variantId: string | null;
  /** The variant rows the hide would switch off (product scope: every currently visible variant). */
  variantIds: string[];
  label: string;
  sku: string | null;
  priceMinor: number | null;
  stock: number | null;
  /** Shown on the website right now (published phone with an active variant). */
  isVisible: boolean;
  publicationStatus: string | null;
  action: MissingAction;
  reason: string;
  mediaCount: number;
  specCount: number;
};

export type StockDelta = {
  entries: DeltaEntry[];
  missing: MissingEntry[];
  excluded: ExcludedLine[];
  counts: DeltaCounts;
  /** "listed": only listed phones change (nothing hidden, existing stock kept). "complete": the original full-list behaviour. */
  mode: UpdateMode;
  /** "listed" mode: Android phones on the website that are not in this list (left exactly as they are). */
  untouchedPhones: number;
  /** The Owner's list-wide PTA / condition choice (null: lines use only their own words, the original behaviour). */
  listFacts: ListFacts | null;
};

/**
 * The PTA / condition the Owner chose for the whole list (like iPhone Stock, Owner-approved 2026-11-23). It applies to
 * every line that does not state its own PTA / condition. Existing variants are only ever re-priced (their PTA /
 * condition never change); new phones are created with these values; a new variant must match the phone's own variants.
 */
export type ListFacts = { ptaStatus: "approved" | "not_approved"; condition: "brand_new" | "used" };
export const DEFAULT_LIST_FACTS: ListFacts = { ptaStatus: "approved", condition: "brand_new" };

export type DeltaOptions = { mode?: UpdateMode; listFacts?: ListFacts };

/** The facts a row stands for: its own words first, else the Owner's list choice (no choice = only its own words). */
export function effectiveFacts(row: Pick<CatalogSheetRow, "ptaStatus" | "condition">, listFacts: ListFacts | null | undefined) {
  return { ptaStatus: row.ptaStatus ?? listFacts?.ptaStatus ?? null, condition: row.condition ?? listFacts?.condition ?? null };
}

/** Reason for an "All Colours" line: the Owner picks the colours (written as a plain sentence for the page). */
export const ALL_COLOURS_REASON = "“All Colours” — tick which colours get this price";
/** "Only products in this list" (Owner-approved 2026-11-24): a phone missing from the website waits for the Owner. */
export const NEW_PHONE_REVIEW = "New Phone — Review Required: this phone is not on the website. Nothing is created from this list unless you confirm it is a new phone (it is then created as a draft when you update the website)";
export const ALL_COLOURS_NO_PHONE = "“All Colours” needs the colours written in the list — this phone is not on the website yet";
export const ALL_COLOURS_OTHER_FACTS = "“All Colours” — this phone's colours for this storage have a different PTA / condition than this line or your choice above; their PTA / condition is never changed here — change the choice or Skip";
export const ALL_COLOURS_NO_VARIANT ="“All Colours” — this phone has no variant with this storage; write the colours in the list";
// ---------------------------------------------------------------------------
// PTA / condition safety (Owner-approved 2026-11-23)
// ---------------------------------------------------------------------------
// A NEW variant copies PTA / condition from the phone's other variants, and a NEW phone gets the Android defaults
// (PTA Approved, Brand New). When the line itself states a different PTA or condition ("Non-PTA", "Used"), saving would
// silently store something else, so the row needs the Owner instead (fix the line, add it by hand, or Skip).

export const PTA_WORDS: Record<string, string> = { approved: "PTA Approved", not_approved: "Non-PTA", not_applicable: "PTA not applicable", unknown: "PTA unknown" };
export const CONDITION_WORDS: Record<string, string> = { brand_new: "Brand New", used: "Used", open_box: "Open Box", refurbished: "Refurbished", unknown: "condition unknown" };

/** What a new variant of this phone would be saved with (copied only when every sibling agrees), else null. */
export function siblingFacts(product: CatalogDeltaProduct): { ptaStatus: string; condition: string } | null {
  const active = product.variants.filter((variant) => variant.isActive);
  const siblings = active.length ? active : product.variants;
  const pta = [...new Set(siblings.map((variant) => variant.ptaStatus ?? null))];
  const condition = [...new Set(siblings.map((variant) => variant.condition ?? null))];
  return pta.length === 1 && condition.length === 1 && pta[0] && condition[0] ? { ptaStatus: pta[0], condition: condition[0] } : null;
}

/** The plain reason when the line states a PTA / condition that differs from what would be saved, else null. */
export function statedFactsConflict(row: Pick<CatalogSheetRow, "ptaStatus" | "condition">, saved: { ptaStatus: string; condition: string }, what: "new variant" | "new phone"): string | null {
  const listed: string[] = [];
  const target: string[] = [];
  if (row.ptaStatus && row.ptaStatus !== saved.ptaStatus) {
    listed.push(PTA_WORDS[row.ptaStatus] ?? row.ptaStatus);
    target.push(PTA_WORDS[saved.ptaStatus] ?? saved.ptaStatus);
  }
  if (row.condition && row.condition !== saved.condition) {
    listed.push(CONDITION_WORDS[row.condition] ?? row.condition);
    target.push(CONDITION_WORDS[saved.condition] ?? saved.condition);
  }
  if (!listed.length) return null;
  const source = what === "new variant" ? "copied from this phone's other variants" : "the Android new-phone default";
  return `This line says ${listed.join(" / ")}, but the ${what} would be saved as ${target.join(" / ")} (${source}) — add it by hand in Catalog, correct the line, or Skip`;
}

const factWords = (facts: { ptaStatus: string | null; condition: string | null }) =>
  [facts.ptaStatus ? PTA_WORDS[facts.ptaStatus] ?? facts.ptaStatus : null, facts.condition ? CONDITION_WORDS[facts.condition] ?? facts.condition : null].filter(Boolean).join(" / ");

/** A line that states a PTA / condition different from the Owner's list choice: the Owner decides, nothing is assumed. */
export function lineVersusChoice(row: Pick<CatalogSheetRow, "ptaStatus" | "condition">, listFacts: ListFacts): string | null {
  const listed: { ptaStatus: string | null; condition: string | null } = { ptaStatus: null, condition: null };
  const chosen: { ptaStatus: string | null; condition: string | null } = { ptaStatus: null, condition: null };
  if (row.ptaStatus && row.ptaStatus !== listFacts.ptaStatus) {
    listed.ptaStatus = row.ptaStatus;
    chosen.ptaStatus = listFacts.ptaStatus;
  }
  if (row.condition && row.condition !== listFacts.condition) {
    listed.condition = row.condition;
    chosen.condition = listFacts.condition;
  }
  if (!listed.ptaStatus && !listed.condition) return null;
  return `This line says ${factWords(listed)}, but you chose ${factWords(chosen)} for this list — correct the line, change the choice above, or Skip`;
}

/** The Owner's choice (not the line) differs from the phone's own variants: a new variant cannot be added here. */
export function choiceVersusPhone(effective: { ptaStatus: string | null; condition: string | null }, saved: { ptaStatus: string; condition: string }): string | null {
  const wanted: { ptaStatus: string | null; condition: string | null } = { ptaStatus: null, condition: null };
  const phone: { ptaStatus: string | null; condition: string | null } = { ptaStatus: null, condition: null };
  if (effective.ptaStatus && effective.ptaStatus !== saved.ptaStatus) {
    wanted.ptaStatus = effective.ptaStatus;
    phone.ptaStatus = saved.ptaStatus;
  }
  if (effective.condition && effective.condition !== saved.condition) {
    wanted.condition = effective.condition;
    phone.condition = saved.condition;
  }
  if (!wanted.ptaStatus && !wanted.condition) return null;
  return `You chose ${factWords(wanted)}, but this phone's other variants are ${factWords(phone)} — this page can only add a new variant that matches them (a database update is needed for this); add it by hand in Catalog, change the choice above, or Skip`;
}

/** Note prefix on rows made from an "All Colours" line after the Owner ticked the colours (stockListDraft.applyResolutions). */
export const CHOSEN_FROM_ALL_COLOURS = "Chosen by you from “All Colours”";
export const RAM_NOT_IN_LIST = "This line gives no RAM and the phone has more than one RAM for this storage — add the RAM to the line";

export type DeltaCounts = {
  parsedRows: number;
  parsedProducts: number;
  matchedProducts: number;
  matchedVariants: number;
  unchanged: number;
  priceChanges: number;
  newVariants: number;
  newProducts: number;
  newProductVariants: number;
  showAgain: number;
  missingProducts: number;
  missingVariants: number;
  /** Phones + variants that will be hidden (currently visible, not held). */
  willHide: number;
  alreadyHidden: number;
  heldHides: number;
  ambiguous: number;
  /** Rows waiting for the Owner to confirm a spelling correction. */
  spellingSuggestions: number;
  /** Unmatched rows that look like an existing phone (correct the line, or confirm a new phone). */
  looksLikeExisting: number;
  /** Rows needing attention that matched no phone at all (nothing on the website is changed for them). */
  notMatched: number;
  blocked: number;
  excluded: number;
  /** Lines outside this Android update: non-Android rows + excluded lines. */
  notAndroid: number;
};

/** Identity-only key: case, spacing and punctuation are ignored, "+" is "plus" (Note 15 Pro+ is not Note 15 Pro). */
export const identityKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]/g, "");

const capacity = (value: string | null) => (value ? normalizeCapacity(value) ?? value.trim() : null);
const colorKey = (value: string | null) => (value ? normalizeColor(value).color.toLowerCase() : null);

function rowLabel(row: CatalogSheetRow) {
  return [row.ram, row.storage, row.color].filter(Boolean).join(" / ") || "—";
}

function variantLabel(variant: CatalogDeltaVariant) {
  return [variant.ram, variant.storage, variant.color].filter(Boolean).join(" / ") || "—";
}

/** Facts the list states must agree with the existing variant; facts the list leaves blank match anything (the importer's rule). */
function factsCompatible(row: CatalogSheetRow, variant: CatalogDeltaVariant) {
  const agrees = (listed: string | number | null, existing: string | number | null, unknownValue?: string) =>
    listed === null || existing === listed || (unknownValue !== undefined && existing === unknownValue);
  return (
    agrees(row.ptaStatus, variant.ptaStatus, "unknown") &&
    agrees(row.condition, variant.condition, "unknown") &&
    agrees(row.conditionGrade, variant.conditionGrade) &&
    agrees(row.batteryHealth, variant.batteryHealth) &&
    agrees(row.cycleCount, variant.cycleCount)
  );
}

function sameConfiguration(row: CatalogSheetRow, variant: CatalogDeltaVariant) {
  return (
    capacity(row.ram) === capacity(variant.ram) &&
    capacity(row.storage) === capacity(variant.storage) &&
    colorKey(row.color) === colorKey(variant.color)
  );
}

function newProductRequirements(row: CatalogSheetRow, complete: boolean, listFacts?: ListFacts | null) {
  const facts = effectiveFacts(row, listFacts);
  const used = (facts.condition ?? CANONICAL_CONDITION) === "used";
  const requirements = [
    "SKU: given automatically (MB###)",
    "Image: add one before the phone can go live",
    listFacts
      ? `PTA status and condition: ${factWords({ ptaStatus: facts.ptaStatus ?? CANONICAL_PTA, condition: facts.condition ?? CANONICAL_CONDITION })} (from the line or your choice for this list)`
      : "PTA status and condition: set from the usual defaults (not in the list)",
    ...(used ? ["Warranty: none is assumed for a Used phone — add it in Catalog before publishing"] : []),
    `Stock: set to ${STOCK_UPDATE_TARGET}`,
    "Specifications: optional, can be added later",
    "Goes live only after it has an image and is published",
  ];
  if (!complete) requirements.unshift("Add the missing RAM / storage / color / price before this phone can be created");
  return requirements;
}

const isPublished = (product: CatalogDeltaProduct) => product.publicationStatus === "published";

// ---------------------------------------------------------------------------
// Spelling suggestions (strict; never applied without the Owner)
// ---------------------------------------------------------------------------

/** Name words for comparison: lower case, "+" is the word "plus", punctuation separates words. */
export const nameWords = (title: string) =>
  title
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** True when a and b differ by exactly one insertion, deletion, substitution or swap of two neighbouring letters. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) diffs.push(index);
    if (diffs.length === 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let index = 0; index < long.length; index += 1) if (long.slice(0, index) + long.slice(index + 1) === short) return true;
  return false;
}

/**
 * The single word correction that turns the listed name into the phone's name, or null. Rules (all must hold):
 * same number of words; exactly one word differs; both words are letters only (a word with a digit — 15, A57, 5G — is never
 * corrected); the listed word is not a real word of any phone name (so "Lite" is never turned into "Life"); and either the
 * listed word is a shortened form of at least 2 letters (Pr -> Pro) or, for words of 4+ letters, one letter is wrong.
 */
export function oneWordCorrection(listed: readonly string[], existing: readonly string[], knownWords: ReadonlySet<string>): { from: string; to: string } | null {
  if (listed.length !== existing.length) return null;
  let found: { from: string; to: string } | null = null;
  for (let index = 0; index < listed.length; index += 1) {
    const from = listed[index];
    const to = existing[index];
    if (from === to) continue;
    if (found) return null;
    if (!/^[a-z]+$/.test(from) || !/^[a-z]+$/.test(to) || knownWords.has(from)) return null;
    const shortened = from.length >= 2 && to.startsWith(from);
    const misspelt = from.length >= 4 && to.length >= 4 && oneEditApart(from, to);
    if (!shortened && !misspelt) return null;
    found = { from, to };
  }
  return found;
}

type NearMatch = {
  /** The one safe correction, or null. */
  suggestion: SpellingSuggestion | null;
  /** Every existing phone the line looks like (similar names + correction candidates). */
  near: CatalogDeltaProduct[];
  /** Exactly one phone fits the spelling, but it has no single variant with the line's RAM / storage / colour. */
  variantMissing: boolean;
};

function findNearMatches(row: CatalogSheetRow, title: string, catalog: readonly CatalogDeltaProduct[], knownWords: ReadonlySet<string>): NearMatch {
  const key = identityKey(title);
  const similar = catalog.filter((product) => {
    const other = identityKey(product.title);
    return other !== key && (other.startsWith(key) || key.startsWith(other));
  });
  const brand = lower(row.brand);
  const listed = nameWords(title);
  const corrections = brand
    ? catalog
        .filter((product) => lower(product.brand) === brand && product.publicationStatus !== "archived")
        .map((product) => ({ product, change: oneWordCorrection(listed, nameWords(product.title), knownWords) }))
        .filter((item): item is { product: CatalogDeltaProduct; change: { from: string; to: string } } => item.change !== null)
    : [];
  const near = [...new Set([...similar, ...corrections.map((item) => item.product)])];
  if (corrections.length !== 1 || near.length !== 1) return { suggestion: null, near, variantMissing: false };
  const { product, change } = corrections[0];
  const matches = product.variants.filter((variant) => sameConfiguration(row, variant) && factsCompatible(row, variant));
  if (matches.length !== 1) return { suggestion: null, near, variantMissing: true };
  const variant = matches[0];
  return {
    suggestion: {
      productId: product.id,
      productTitle: product.title,
      variantId: variant.id,
      from: change.from,
      to: change.to,
      autoSafe: variant.isActive && (product.publicationStatus === "published" || product.publicationStatus === "draft"),
    },
    near,
    variantMissing: false,
  };
}

export function buildStockDelta(parsed: ParsedStockList, fullCatalog: CatalogDeltaProduct[], decisions?: readonly (RowDecision | undefined)[], options: DeltaOptions = {}): StockDelta {
  const mode: UpdateMode = options.mode ?? "complete";
  const listed = mode === "listed";
  const listFacts = options.listFacts ?? null;
  // Only Android phones take part. iPhones, tablets, accessories and feature phones on the website are never matched or hidden.
  const catalog = fullCatalog.filter(isAndroidCatalogProduct);
  const byKey = new Map<string, CatalogDeltaProduct[]>();
  const bySlug = new Map<string, CatalogDeltaProduct[]>();
  const knownWords = new Set<string>();
  for (const product of catalog) {
    byKey.set(identityKey(product.title), [...(byKey.get(identityKey(product.title)) ?? []), product]);
    bySlug.set(product.slug, [...(bySlug.get(product.slug) ?? []), product]);
    for (const word of nameWords(product.title)) knownWords.add(word);
  }
  const byId = new Map(catalog.map((product) => [product.id, product] as const));

  const entries: DeltaEntry[] = [];
  const touchedProducts = new Set<string>();
  /** Phones referenced by a row that still needs attention: nothing of theirs is hidden until the Owner fixes the row. */
  const attentionProducts = new Set<string>();
  const matchedVariantIds = new Set<string>();
  const claimedVariants = new Map<string, number>();

  parsed.rows.forEach((row, index) => {
    const category = rowCategory(row);
    const title = row.productTitle ?? [row.brand, row.model].filter(Boolean).join(" ");
    const base: DeltaEntry = {
      id: `row-${index}`,
      kind: "blocked",
      provisionalKind: null,
      category,
      row,
      label: rowLabel(row),
      productId: null,
      productTitle: title || row.sourceLine,
      productSlug: row.slug ?? "",
      variantId: null,
      sku: null,
      currentPriceMinor: null,
      newPriceMinor: row.priceMinor,
      diffMinor: null,
      stock: null,
      mediaCount: null,
      specCount: null,
      publicationStatus: null,
      showAgain: false,
      reasons: [],
      notes: [],
      willUpdate: false,
      requirements: [],
      attention: null,
      suggestion: null,
      nearTitles: [],
    };

    // Not an Android phone: listed for information only, never compared or applied.
    if (category !== "smartphone") {
      entries.push({ ...base, reasons: [`${CATEGORY_LABEL[category]} — not part of this Android update`] });
      return;
    }
    // An Android line we cannot read fully needs the Owner's attention (fix the line; there is no skip).
    if (row.priceMinor === null || !title) {
      // The phone is still in the list: hold it (never hide it) until the Owner fixes this row.
      if (title) for (const product of [...(byKey.get(identityKey(title)) ?? []), ...(row.slug ? bySlug.get(row.slug) ?? [] : [])]) attentionProducts.add(product.id);
      entries.push({ ...base, kind: "ambiguous", reasons: [...row.reviewReasons, "Price or model missing — cannot compare"] });
      return;
    }

    const keyMatches = byKey.get(identityKey(title)) ?? [];
    const slugMatches = row.slug ? bySlug.get(row.slug) ?? [] : [];
    const candidates = [...new Set([...keyMatches, ...slugMatches])];
    const reasons = [...row.reviewReasons];
    const notes: string[] = [];
    // The Owner's list choice fills PTA / condition the line does not state (used for matching and for new phones).
    const factsRow: CatalogSheetRow = listFacts ? ({ ...row, ...effectiveFacts(row, listFacts) } as CatalogSheetRow) : row;
    if (listFacts) {
      const versus = lineVersusChoice(row, listFacts);
      if (versus) reasons.push(versus);
    }

    // Similar-but-different existing models are shown, never merged (Edge 70 vs Edge 70 Fusion).
    const key = identityKey(title);
    const similar = catalog.filter((product) => {
      const other = identityKey(product.title);
      return other !== key && (other.startsWith(key) || key.startsWith(other));
    });

    if (candidates.length > 1) {
      for (const product of candidates) attentionProducts.add(product.id);
      entries.push({ ...base, kind: "ambiguous", reasons: [...reasons, `Matches ${candidates.length} existing products (${candidates.map((product) => product.title).join(", ")})`] });
      return;
    }

    // No exact match: never guess. A line that looks like an existing phone waits for the Owner (and that phone is never
    // hidden meanwhile), so a typo can never create a duplicate phone or hide the real one.
    let correction: SpellingSuggestion | null = null;
    if (candidates.length === 0 && isAllColours(row.color)) {
      // "All Colours" of a phone the website does not have: there is nothing to choose from, so the colours must be written.
      entries.push({ ...base, kind: "ambiguous", reasons: [ALL_COLOURS_NO_PHONE], notes });
      return;
    }
    if (candidates.length === 0) {
      const decision = decisions?.[index];
      const near = findNearMatches(factsRow, title, catalog, knownWords);
      const nearTitles = near.near.map((product) => product.title);
      const hold = () => {
        for (const product of near.near) attentionProducts.add(product.id);
      };
      if (decision?.matchProductId) {
        if (near.suggestion && near.suggestion.productId === decision.matchProductId) {
          correction = near.suggestion;
          notes.push(`Spelling corrected by you: “${correction.from}” → “${correction.to}”`);
        } else {
          hold();
          if (byId.has(decision.matchProductId)) attentionProducts.add(decision.matchProductId);
          entries.push({ ...base, kind: "ambiguous", attention: "decision_stale", nearTitles, reasons: [...reasons, "The phone you chose for this line no longer matches it exactly — check the line again"], notes });
          return;
        }
      } else if (near.suggestion && AUTO_APPLY_SPELLING_CORRECTIONS && near.suggestion.autoSafe) {
        correction = near.suggestion;
        notes.push(`Spelling corrected: “${correction.from}” → “${correction.to}”`);
      } else if (!decision?.confirmNewPhone && near.near.length) {
        hold();
        const reason = near.suggestion
          ? `Looks like a spelling mistake for “${near.suggestion.productTitle}” (“${near.suggestion.from}” → “${near.suggestion.to}”) — confirm it, or correct the line`
          : near.variantMissing
            ? `Looks like “${nearTitles[0]}”, but that phone has no ${rowLabel(row)} variant — correct the line, or confirm it is a new phone`
            : `Looks like the existing ${nearTitles.join(", ")} — correct the line, or confirm it is a new phone`;
        entries.push({ ...base, kind: "ambiguous", attention: near.suggestion ? "spelling" : "looks_like_existing", suggestion: near.suggestion, nearTitles, reasons: [...reasons, reason], notes });
        return;
      }

      if (!correction) {
        const complete = Boolean(row.ram && row.storage && row.color && row.priceMinor !== null);
        if (near.near.length) notes.push(`You confirmed this is a new phone (different from ${nearTitles.join(", ")})`);
        else if (similar.length) notes.push(`Different from the existing: ${similar.map((product) => product.title).join(", ")}`);
        // A new phone must be complete: it cannot be left out, so a missing RAM / storage / color needs attention.
        if (!complete) reasons.push("New phone is missing RAM / storage / color — add them to the line");
        // "Only products in this list" (Owner-approved 2026-11-24): a phone missing from the catalog is never created
        // automatically — it waits for the Owner's "New phone" confirmation (then it is created as a draft on update).
        if (listed && !decision?.confirmNewPhone) {
          entries.push({ ...base, kind: "ambiguous", provisionalKind: "new_product", attention: "new_phone_review", reasons: [...reasons, NEW_PHONE_REVIEW], notes, requirements: newProductRequirements(row, complete, listFacts) });
          return;
        }
        // With a list choice the new phone is created with the chosen / stated values (a stated value that differs from the
        // choice is already held above). Without one, the original Android defaults apply and a different stated value is held.
        const phoneConflict = listFacts ? null : statedFactsConflict(row, { ptaStatus: CANONICAL_PTA, condition: CANONICAL_CONDITION }, "new phone");
        if (phoneConflict) reasons.push(phoneConflict);
        const held = reasons.length > 0;
        entries.push({
          ...base,
          kind: held ? "ambiguous" : "new_product",
          provisionalKind: held ? "new_product" : null,
          reasons,
          notes,
          willUpdate: !held,
          requirements: newProductRequirements(row, complete, listFacts),
        });
        return;
      }
    }

    const product = correction ? (byId.get(correction.productId) as CatalogDeltaProduct) : candidates[0];
    touchedProducts.add(product.id);
    if (product.slug !== row.slug || product.title !== title) notes.push(`Matched to “${product.title}” on the website`);
    if (similar.length) notes.push(`Not the same as: ${similar.map((other) => other.title).join(", ")}`);
    const common = { productId: product.id, productTitle: product.title, productSlug: product.slug, mediaCount: product.mediaCount, specCount: product.specCount, publicationStatus: product.publicationStatus };

    // "All Colours": the existing colours of this storage are offered as choices; nothing is changed until the Owner ticks them.
    if (isAllColours(row.color)) {
      const storageMatches = product.variants.filter((variant) => capacity(variant.storage) === capacity(row.storage) && (row.ram === null || capacity(variant.ram) === capacity(row.ram)));
      const sameStorage = storageMatches.filter((variant) => factsCompatible(factsRow, variant));
      attentionProducts.add(product.id);
      if (!sameStorage.length && storageMatches.length) {
        // The colours exist, but with a different PTA / condition than the line or the Owner's choice: never re-faceted.
        entries.push({ ...base, ...common, kind: "ambiguous", reasons: [ALL_COLOURS_OTHER_FACTS], notes });
        return;
      }
      entries.push({
        ...base,
        ...common,
        kind: "ambiguous",
        provisionalKind: "price_change",
        reasons: [sameStorage.length ? ALL_COLOURS_REASON : ALL_COLOURS_NO_VARIANT],
        notes,
        attention: sameStorage.length ? "all_colours" : null,
        colourChoices: sameStorage
          .filter((variant) => variant.color)
          .map((variant) => ({ variantId: variant.id, sku: variant.sku, color: variant.color as string, ram: variant.ram, storage: variant.storage, priceMinor: variant.priceMinor, isActive: variant.isActive })),
      });
      return;
    }

    let configMatches = product.variants.filter((variant) => sameConfiguration(row, variant));
    // The list gives storage but no RAM ("256Gb" under a heading): the existing variant is used only when this phone has
    // exactly ONE RAM for that storage + colour. Otherwise (or for a new colour) the RAM is never guessed.
    if (!configMatches.length && row.ram === null && row.storage) {
      const sameStorageColour = product.variants.filter((variant) => capacity(variant.storage) === capacity(row.storage) && colorKey(variant.color) === colorKey(row.color));
      const rams = new Set(sameStorageColour.map((variant) => capacity(variant.ram)));
      if (sameStorageColour.length && rams.size === 1 && [...rams][0]) {
        configMatches = sameStorageColour;
        notes.push(`RAM ${sameStorageColour[0].ram} taken from the existing variant (the list gives only ${row.storage})`);
      } else if (sameStorageColour.length) {
        reasons.push(RAM_NOT_IN_LIST);
      }
    }
    const variantMatches = configMatches.filter((variant) => factsCompatible(factsRow, variant));

    // A corrected spelling only ever updates the one existing variant it was verified against — never a new variant.
    if (correction && (variantMatches.length !== 1 || variantMatches[0].id !== correction.variantId)) {
      attentionProducts.add(product.id);
      entries.push({ ...base, ...common, kind: "ambiguous", attention: "decision_stale", reasons: [...reasons, "The phone you chose for this line no longer matches it exactly — check the line again"], notes });
      return;
    }

    if (variantMatches.length > 1) {
      attentionProducts.add(product.id);
      entries.push({ ...base, ...common, kind: "ambiguous", reasons: [...reasons, `Matches ${variantMatches.length} existing variants (${variantMatches.map((variant) => variant.sku).join(", ")}); add PTA / Condition / Battery Health to tell them apart`], notes });
      return;
    }

    if (variantMatches.length === 0) {
      if (configMatches.length) reasons.push("Same RAM/Storage/Color exists with different PTA/Condition facts — review");
      else {
        const copied = siblingFacts(product);
        const variantConflict = copied ? statedFactsConflict(row, copied, "new variant") ?? (listFacts ? choiceVersusPhone(effectiveFacts(row, listFacts), copied) : null) : null;
        if (variantConflict) reasons.push(variantConflict);
      }
      const held = reasons.length > 0;
      if (held) attentionProducts.add(product.id);
      entries.push({
        ...base,
        ...common,
        kind: held ? "ambiguous" : "new_variant",
        provisionalKind: held ? "new_variant" : null,
        reasons,
        notes,
        stock: STOCK_UPDATE_TARGET,
        willUpdate: !held,
        requirements: ["SKU: given automatically (MB###)", `Stock: set to ${STOCK_UPDATE_TARGET}`, "PTA / condition / warranty: same as the existing phone"],
      });
      return;
    }

    const variant = variantMatches[0];
    matchedVariantIds.add(variant.id);
    claimedVariants.set(variant.id, (claimedVariants.get(variant.id) ?? 0) + 1);
    const diff = row.priceMinor - variant.priceMinor;
    const kind: "unchanged" | "price_change" = diff === 0 ? "unchanged" : "price_change";
    // "listed" mode never changes visibility: a hidden variant keeps its new price but stays hidden.
    const showAgain = !variant.isActive && !listed;
    if (showAgain) notes.push("Currently hidden on the website — it will be shown again");
    if (!variant.isActive && listed) notes.push("Hidden on the website — it stays hidden (this mode never shows or hides anything)");
    if (!isPublished(product)) notes.push("This phone is not published yet — it needs an image and publishing before it appears");
    if (kind === "price_change" && variant.compareAtPriceMinor !== null && row.priceMinor >= variant.compareAtPriceMinor) {
      reasons.push("New price is not below the existing compare-at price — adjust compare-at first (database rule)");
    }
    const held = reasons.length > 0;
    if (held) attentionProducts.add(product.id);
    entries.push({
      ...base,
      ...common,
      kind: held ? "ambiguous" : kind,
      provisionalKind: held ? kind : null,
      // A line without RAM shows the matched variant's full RAM / storage / colour.
      label: row.ram === null ? variantLabel(variant) : base.label,
      variantId: variant.id,
      sku: variant.sku,
      currentPriceMinor: variant.priceMinor,
      diffMinor: diff,
      stock: variant.stock,
      showAgain,
      reasons,
      notes,
      willUpdate: !held && (kind === "price_change" || showAgain),
      suggestion: correction,
    });
  });

  // A spelling suggestion for a variant that another line already lists exactly is not offered (it would claim it twice).
  for (const entry of entries) {
    if (entry.attention !== "spelling" || !entry.suggestion || !matchedVariantIds.has(entry.suggestion.variantId)) continue;
    const title = entry.suggestion.productTitle;
    entry.suggestion = null;
    entry.attention = "looks_like_existing";
    entry.reasons = [...entry.row.reviewReasons, `Looks like “${title}”, but another line already lists that variant — correct the line, or confirm it is a new phone`];
  }

  // The same existing variant claimed by two list rows is a conflict (e.g. the same colour listed twice at different prices).
  for (const entry of entries) {
    if (entry.variantId && (claimedVariants.get(entry.variantId) ?? 0) > 1 && entry.kind !== "ambiguous") {
      entry.provisionalKind = entry.kind as DeltaEntry["provisionalKind"];
      entry.kind = "ambiguous";
      entry.reasons.push("The same existing variant is listed more than once");
      entry.willUpdate = false;
      if (entry.productId) attentionProducts.add(entry.productId);
    }
  }

  // Android phones / variants absent from the latest list: hidden (is_active = false), never deleted.
  // A phone with an unresolved row keeps everything visible until the Owner fixes that row.
  const missing: MissingEntry[] = [];
  const decide = (productId: string, visible: boolean): Pick<MissingEntry, "action" | "reason"> => {
    if (attentionProducts.has(productId)) return { action: "held", reason: "Fix the rows that need attention for this phone first" };
    if (!visible) return { action: "already_hidden", reason: "Already hidden — stays hidden" };
    return { action: "hide", reason: "Not in the latest list — will be hidden from the website (not deleted)" };
  };
  // "listed" mode: phones and variants that are not in the list are left exactly as they are (never hidden).
  for (const product of listed ? [] : catalog) {
    const shared = { productId: product.id, productTitle: product.title, productSlug: product.slug, publicationStatus: product.publicationStatus, mediaCount: product.mediaCount, specCount: product.specCount };
    if (!touchedProducts.has(product.id)) {
      const visibleVariants = isPublished(product) ? product.variants.filter((variant) => variant.isActive) : [];
      missing.push({
        id: `missing-product-${product.id}`,
        scope: "product",
        ...shared,
        variantId: null,
        variantIds: visibleVariants.map((variant) => variant.id),
        label: `${product.variants.length} variant(s)`,
        sku: null,
        priceMinor: null,
        stock: null,
        isVisible: visibleVariants.length > 0,
        ...decide(product.id, visibleVariants.length > 0),
      });
      continue;
    }
    for (const variant of product.variants) {
      if (matchedVariantIds.has(variant.id)) continue;
      const visible = variant.isActive && isPublished(product);
      missing.push({
        id: `missing-variant-${variant.id}`,
        scope: "variant",
        ...shared,
        variantId: variant.id,
        variantIds: visible ? [variant.id] : [],
        label: variantLabel(variant),
        sku: variant.sku,
        priceMinor: variant.priceMinor,
        stock: variant.stock,
        isVisible: visible,
        ...decide(product.id, visible),
      });
    }
  }

  const count = (kind: DeltaKind) => entries.filter((entry) => entry.kind === kind).length;
  const newProductEntries = entries.filter((entry) => entry.kind === "new_product");
  const smartphoneRows = entries.filter((entry) => entry.category === "smartphone");
  const blocked = count("blocked");
  const counts: DeltaCounts = {
    parsedRows: parsed.rows.length,
    parsedProducts: new Set(smartphoneRows.map((entry) => entry.productSlug || identityKey(entry.productTitle))).size,
    matchedProducts: touchedProducts.size,
    matchedVariants: matchedVariantIds.size,
    unchanged: count("unchanged"),
    priceChanges: count("price_change"),
    newVariants: count("new_variant"),
    newProducts: new Set(newProductEntries.map((entry) => entry.productSlug || identityKey(entry.productTitle))).size,
    newProductVariants: newProductEntries.length,
    showAgain: entries.filter((entry) => entry.showAgain && entry.kind !== "ambiguous").length,
    missingProducts: missing.filter((entry) => entry.scope === "product").length,
    missingVariants: missing.filter((entry) => entry.scope === "variant").length,
    willHide: missing.filter((entry) => entry.action === "hide").length,
    alreadyHidden: missing.filter((entry) => entry.action === "already_hidden").length,
    heldHides: missing.filter((entry) => entry.action === "held").length,
    ambiguous: count("ambiguous"),
    spellingSuggestions: entries.filter((entry) => entry.attention === "spelling").length,
    looksLikeExisting: entries.filter((entry) => entry.attention === "looks_like_existing").length,
    notMatched: entries.filter((entry) => entry.kind === "ambiguous" && entry.category === "smartphone" && entry.productId === null).length,
    blocked,
    excluded: parsed.excluded.length,
    notAndroid: blocked + parsed.excluded.length,
  };
  // Where a supplier-block row came from, and colours the Owner chose from "All Colours", are shown on the row.
  for (const entry of entries) {
    const origin = parsed.origins?.[entry.row.lineNumber];
    if (origin) entry.notes.unshift(`From your list: “${origin.original}” under “${origin.heading}”`);
    for (const note of entry.row.notes ?? []) if (note.startsWith(CHOSEN_FROM_ALL_COLOURS)) entry.notes.push(note);
  }
  const untouchedPhones = listed ? catalog.filter((product) => !touchedProducts.has(product.id) && !attentionProducts.has(product.id)).length : 0;
  return { entries, missing, excluded: parsed.excluded, counts, mode, untouchedPhones, listFacts };
}

// ---------------------------------------------------------------------------
// Selection + update plan (a PLAN only: nothing is written)
// ---------------------------------------------------------------------------

// The latest list is the final truth. There is no Owner selection: ticks on the page only mark rows as reviewed.
// Every listed Android item is updated (price / new variant / new phone / shown again / stock 30) and every absent,
// visible Android item is hidden. The only way to stop a write is a Needs Attention row, which blocks the whole update.

export const willHide = (entry: MissingEntry) => entry.action === "hide";

export type PlannedVariant = { entryId: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number };

export type ApplyAction =
  | { op: "update_price"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; fromMinor: number; toMinor: number; diffMinor: number; writes: string[] }
  | { op: "create_variant"; entryId: string; productId: string; productTitle: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number; sku: string; inherits: string[]; writes: string[] }
  | { op: "create_product"; productTitle: string; slug: string; brand: string | null; category: string; status: string; variants: PlannedVariant[]; requirements: string[]; writes: string[] }
  | { op: "set_stock"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; fromStock: number; toStock: number; writes: string[] }
  | { op: "show_variant"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; writes: string[] }
  | { op: "hide_variant"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; writes: string[] }
  | { op: "hide_product"; entryId: string; productId: string; productTitle: string; variantIds: string[]; writes: string[] };

/** Every operation the plan can contain. There is no delete, no media, no specification and no publication operation. */
export const PLAN_OPERATIONS = ["update_price", "set_stock", "create_variant", "create_product", "show_variant", "hide_variant", "hide_product"] as const;

export type ApplyPlan = {
  actions: ApplyAction[];
  counts: { priceUpdates: number; stockUpdates: number; newVariants: number; newProducts: number; newProductVariants: number; showAgain: number; hideVariants: number; hideProducts: number };
  /** Existing website data that the plan never touches. */
  preserved: string[];
  writesPerformed: false;
};

export const PRESERVED_GUARANTEES = [
  "Product IDs, slugs and URLs of every existing phone",
  "SKUs of every existing variant (price updates and hide / show keep the same variant row)",
  "Images / media of every existing phone",
  "Specification rows of every existing phone (none are reset, replaced or removed)",
  "PTA status and Condition of existing variants and phones",
  "Publication state of every existing phone (hiding switches variants off; it never unpublishes, archives or deletes)",
  "Stock: every Android item in the list is set to 30; a hidden item's stock is left as it is",
  "Nothing is ever deleted: hidden phones and variants keep their records and come back when they are in a later list",
];

const HIDE_WRITE = "product_variants.is_active = false (hidden from the store, not deleted)";
const SHOW_WRITE = "product_variants.is_active = true (shown again)";

/**
 * An existing variant that is in the latest list and will be visible after the update gets stock 30.
 * Same, Price Changed and Back On Website rows always. Rows that need attention, non-Android rows and hidden rows never get a stock change.
 */
export function needsStockTarget(entry: DeltaEntry): boolean {
  if ((entry.kind !== "unchanged" && entry.kind !== "price_change") || !entry.variantId || !entry.productId) return false;
  return (entry.stock ?? 0) !== STOCK_UPDATE_TARGET;
}

export function buildApplyPlan(delta: StockDelta): ApplyPlan {
  const actions: ApplyAction[] = [];
  const newProducts = new Map<string, Extract<ApplyAction, { op: "create_product" }>>();
  for (const entry of delta.entries) {
    if (!entry.willUpdate) continue;
    if (entry.kind === "price_change" && entry.productId && entry.variantId && entry.currentPriceMinor !== null && entry.newPriceMinor !== null) {
      actions.push({ op: "update_price", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantId: entry.variantId, sku: entry.sku ?? "", label: entry.label, fromMinor: entry.currentPriceMinor, toMinor: entry.newPriceMinor, diffMinor: entry.newPriceMinor - entry.currentPriceMinor, writes: ["product_variants.price_minor (price only)"] });
    } else if (entry.kind === "new_variant" && entry.productId && entry.newPriceMinor !== null) {
      actions.push({ op: "create_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: STOCK_UPDATE_TARGET, sku: "given automatically (MB###)", inherits: ["PTA status", "Condition", "Warranty", "Delivery scope"], writes: ["product_variants (new row)", "inventory_movements (opening stock)"] });
    } else if (entry.kind === "new_product" && entry.newPriceMinor !== null) {
      const key = entry.productSlug || identityKey(entry.productTitle);
      const existing = newProducts.get(key) ?? { op: "create_product" as const, productTitle: entry.productTitle, slug: entry.productSlug, brand: entry.row.brand, category: "Mobile Phones", status: "Draft — hidden until it has an image and is published", variants: [], requirements: entry.requirements, writes: ["products (new row, draft)", "product_variants (new rows)", "inventory_movements (opening stock)"] };
      existing.variants.push({ entryId: entry.id, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: STOCK_UPDATE_TARGET });
      newProducts.set(key, existing);
    }
    if (entry.showAgain && entry.productId && entry.variantId) {
      actions.push({ op: "show_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantId: entry.variantId, sku: entry.sku ?? "", label: entry.label, writes: [SHOW_WRITE] });
    }
  }
  actions.push(...newProducts.values());
  for (const entry of delta.entries) {
    if (!needsStockTarget(entry)) continue;
    actions.push({ op: "set_stock", entryId: entry.id, productId: entry.productId as string, productTitle: entry.productTitle, variantId: entry.variantId as string, sku: entry.sku ?? "", label: entry.label, fromStock: entry.stock ?? 0, toStock: STOCK_UPDATE_TARGET, writes: [`inventory_movements (one correction row: ${STOCK_UPDATE_TARGET} minus the stock at that moment)`] });
  }
  for (const entry of delta.missing) {
    if (!willHide(entry)) continue;
    if (entry.scope === "variant" && entry.variantId) {
      actions.push({ op: "hide_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantId: entry.variantId, sku: entry.sku ?? "", label: entry.label, writes: [HIDE_WRITE] });
    } else if (entry.scope === "product" && entry.variantIds.length) {
      actions.push({ op: "hide_product", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantIds: entry.variantIds, writes: [`${HIDE_WRITE} for each of its ${entry.variantIds.length} visible variant(s); the products row, images, specifications and URL are untouched`] });
    }
  }
  const tally = (op: ApplyAction["op"]) => actions.filter((action) => action.op === op).length;
  return {
    actions,
    counts: {
      priceUpdates: tally("update_price"),
      stockUpdates: tally("set_stock"),
      newVariants: tally("create_variant"),
      newProducts: newProducts.size,
      newProductVariants: [...newProducts.values()].reduce((sum, product) => sum + product.variants.length, 0),
      showAgain: tally("show_variant"),
      hideVariants: tally("hide_variant"),
      hideProducts: tally("hide_product"),
    },
    preserved: PRESERVED_GUARANTEES,
    writesPerformed: false,
  };
}

export const formatMinor = (minor: number | null) => (minor === null ? "—" : `Rs ${(minor / 100).toLocaleString("en-PK")}`);
export const formatDiff = (minor: number | null) => (minor === null ? "—" : `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${Math.abs(minor / 100).toLocaleString("en-PK")}`);
