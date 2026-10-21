/**
 * iPhone Stock Update (New + Used): Paste List -> Check Changes. Pure: nothing here reads from or writes to the database.
 *
 * Owner rules (locked 2026-10-21):
 *   - New and Used iPhones are separate products in Mobile Phones:
 *       New  -> "Apple iPhone 15 Pro Max"        Used -> "Apple iPhone 15 Pro Max (Used)"
 *   - A product is only ever matched by that exact title, and only if every variant it has is of the list's condition.
 *     A plain-title product holding Used variants (or the reverse) is never updated, renamed or merged: it is held.
 *   - Listed existing variant: price only, stock kept. Hidden listed variant: shown again with the latest price, stock kept.
 *   - New variant / new phone: opening stock 20. RAM, grade, battery health, cycles, SIM and warranty stay blank (NULL).
 *   - Variants absent from the list are never touched (no hiding, no stock or price change).
 *   - New/Used and PTA come from the Owner's choice on the page or from words in the list, never from a default.
 *   - Spelling is never corrected automatically; an unknown colour holds its phone until the Owner decides.
 *
 * List format (as the Owner writes it): a heading with model + storage, then one "Colour @ price" line per colour.
 *   IPhone 15Pro Max 512Gb
 *   Blue @298,000
 *   Black @298,000
 */
import { normalizeColor } from "./catalogColors.ts";
import { normalizeStockLines, type BrandReference } from "./catalogSheet.ts";
import { identityKey, type CatalogDeltaProduct, type CatalogDeltaVariant } from "./stockListDelta.ts";
import { simConfigurationLabel } from "./variantFacts.ts";

/** Opening stock of every new iPhone variant (Owner rule 2026-10-21). Existing variants keep their stock. */
export const IPHONE_NEW_VARIANT_STOCK = 20;
export const USED_TITLE_SUFFIX = " (Used)";

export type IphoneCondition = "brand_new" | "used";
export type IphonePta = "approved" | "not_approved";
export type IphoneSelection = { condition: IphoneCondition | null; pta: IphonePta | null };

export const CONDITION_LABEL: Record<IphoneCondition, string> = { brand_new: "New", used: "Used" };
export const PTA_LABEL: Record<IphonePta, string> = { approved: "PTA Approved", not_approved: "Non-PTA" };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** One colour line of the list, read but not yet compared. */
export type IphoneLine = {
  lineNumber: number;
  sourceLine: string;
  /** Stable key of this exact line (number + text) for the Owner's decisions. */
  lineKey: string;
  /** "Apple iPhone 15 Pro Max" (the New title; the Used title adds " (Used)"). */
  baseTitle: string | null;
  storage: string | null;
  /** The colour as written (title-cased), before any Owner decision. */
  colorWritten: string | null;
  colorKnown: boolean;
  priceMinor: number | null;
  /** New/Used and PTA written on the heading or the line itself (null = not written). */
  listedCondition: IphoneCondition | null;
  listedPta: IphonePta | null;
  /** SIM written on the heading or line ("Physical Dual" = dual_physical_sim); SIM information, never colour or model. */
  listedSim: IphoneSim | null;
  /** Owner-confirmed spelling applied to this colour ("Blaxk" read as "Black"). */
  colorNote: string | null;
  /** Problems found while reading (no heading, unreadable price, ...). */
  problems: string[];
};

export type IphoneUnreadLine = { lineNumber: number; line: string; reason: string };

/** A price line with no colour (Owner rule 2026-10-21: SKIP). Nothing is created or changed for it; it is shown as skipped. */
export type IphoneSkippedLine = { lineNumber: number; line: string; model: string | null; reason: string };

export type ParsedIphoneList = { lines: IphoneLine[]; unread: IphoneUnreadLine[]; skipped: IphoneSkippedLine[] };

export const SKIPPED_NO_COLOUR = "Price without a colour — skipped: no variant is created and nothing on the website is changed";
const COLOURS_WITHOUT_PRICE = "Colours without a price — not used; write the price on this line or on the next line (for example “@ 122,000”)";

/**
 * SIM values the iPhone list can name. Only "Physical Dual" is written in the Owner's lists (Owner-confirmed 2026-10-21:
 * two physical SIMs = dual_physical_sim, migration 202610210002). It is never mapped to physical_sim (one physical SIM),
 * physical_plus_esim or dual_esim. A line without SIM wording leaves the SIM blank (NULL).
 */
export type IphoneSim = "dual_physical_sim";

type Tags = { condition: IphoneCondition | null; pta: IphonePta | null; sim: IphoneSim | null; problems: string[]; rest: string };

/** Lifts New / Used / PTA / Non-PTA words out of a piece of text (the shared reader would read a trailing "PTA" as a colour). */
function liftTags(text: string): Tags {
  const problems: string[] = [];
  let rest = ` ${text} `;
  const take = (pattern: RegExp) => {
    const found = pattern.test(rest);
    if (found) rest = rest.replace(pattern, " ");
    return found;
  };
  const physicalDual = take(/\bphysical[\s-]*dual(?:[\s-]*sim)?\b/gi);
  const nonPta = take(/\bnon[\s-]*pta\b/gi);
  const pta = take(/\bpta(?:\s*approved)?\b/gi);
  const used = take(/\bused\b/gi);
  const isNew = take(/\b(?:brand\s*new|new)\b/gi);
  if (/\bjv\b/i.test(rest)) problems.push("“JV” is written on this line; JV iPhones are not part of this update");
  if (nonPta && pta) problems.push("Both PTA and Non-PTA are written");
  if (used && isNew) problems.push("Both New and Used are written");
  return {
    condition: used && !isNew ? "used" : isNew && !used ? "brand_new" : null,
    pta: nonPta && !pta ? "not_approved" : pta && !nonPta ? "approved" : null,
    sim: physicalDual ? "dual_physical_sim" : null,
    problems,
    rest: rest.replace(/\s+/g, " ").trim(),
  };
}

const IPHONE_WORD = /\biphone\b/i;
/** A heading written without "iPhone": "14Pro 512Gb", "15 Pro Max 256GB", "16e 128GB" (model number first). */
const BARE_MODEL_HEADING = /^\d{1,2}(?:e|\s*(?:pro|plus|max|mini)\b|\s|$)/i;
const PRICE_NUMBER = "(?:rs\\.?\\s*)?([0-9][0-9,]*)\\s*(?:\\/-)?";
/** "Blue @298,000", "White@230,000" */
const PRICE_AT_END = new RegExp(`^(.*?)@\\s*${PRICE_NUMBER}\\s*$`, "i");
/** "@215,000 Purple/Gold/White/Blk" */
const PRICE_AT_START = new RegExp(`^@\\s*${PRICE_NUMBER}\\s+(.+)$`, "i");
/** "White 245,000" (no @): only a comma-grouped amount or 5+ digits counts as a price, so "13 128" is never one. */
const PRICE_BARE_END = /^(.*?\S)\s+(?:rs\.?\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,})\s*(?:\/-)?\s*$/i;

const priceToMinor = (digits: string): number | null => {
  const clean = digits.replace(/,/g, "");
  if (!/^[0-9]{1,12}$/.test(clean)) return null;
  const rupees = Number(clean);
  return rupees > 0 ? rupees * 100 : null;
};

/** The text before or after the price, and the price digits; null when the line has no price. */
function splitPrice(line: string): { text: string; digits: string } | null {
  const end = line.match(PRICE_AT_END);
  if (end) return { text: end[1], digits: end[2] };
  const start = line.match(PRICE_AT_START);
  if (start) return { text: start[2], digits: start[1] };
  const bare = line.match(PRICE_BARE_END);
  if (bare) return { text: bare[1], digits: bare[2] };
  return null;
}

/** Owner-confirmed spellings (2026-10-21), for the iPhone list only. "Blk" -> Black is already a shared colour alias. */
const IPHONE_COLOR_SPELLINGS: Record<string, string> = { blaxk: "Black", purppe: "Purple" };

/** Single colour words that can be listed side by side ("White Blue" = White and Blue). Any other word keeps a phrase whole. */
const SPLITTABLE_COLOR_WORDS = new Set(["black", "blk", "blaxk", "white", "blue", "red", "green", "gold", "purple", "purppe", "pink", "yellow", "silver", "natural", "grey", "gray", "orange", "teal", "starlight"]);
/** Two-word iPhone colours made only of splittable words: always one colour. */
const WHOLE_COLOR_PHRASES = new Set(["midnight green"]);

type ListedColor = { written: string; color: string; known: boolean; note: string | null };

function readColor(written: string): ListedColor {
  const words = written.split(/\s+/);
  const corrected = words.map((word) => IPHONE_COLOR_SPELLINGS[word.toLowerCase()] ?? word);
  const { color, known } = normalizeColor(corrected.join(" "));
  const changed = words.some((word) => IPHONE_COLOR_SPELLINGS[word.toLowerCase()]);
  return { written, color, known, note: changed ? `“${written}” read as “${color}” (Owner-confirmed spelling)` : null };
}

/**
 * "White Blue/Blk/Red" -> White, Blue, Black, Red. Split on "/" or ","; a space splits only when every word is a single
 * colour word ("White Blue"), so "Space Black", "Deep Purple" or "Natural Titanium" stay one colour.
 */
function readColors(text: string): ListedColor[] {
  const segments = text
    .replace(/[;:]+$/, "")
    .split(/\s*[/,]\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.flatMap((segment) => {
    const words = segment.split(/\s+/);
    const splittable = words.length > 1 && !WHOLE_COLOR_PHRASES.has(words.join(" ").toLowerCase()) && words.every((word) => SPLITTABLE_COLOR_WORDS.has(word.toLowerCase()));
    return (splittable ? words : [segment]).map(readColor);
  });
}

type Heading = { baseTitle: string; storage: string; condition: IphoneCondition | null; pta: IphonePta | null; sim: IphoneSim | null; problems: string[] };

/** "IPhone 15Pro Max 512Gb" / "14Pro 512Gb Physical Dual" -> model + storage (the shared model reader does the naming). */
function readHeading(text: string, brands: BrandReference[]): Heading | string {
  const tags = liftTags(text);
  const model = IPHONE_WORD.test(tags.rest) ? tags.rest : `iPhone ${tags.rest}`;
  const row = normalizeStockLines(model, { brands }).rows[0];
  if (!row || (row.brand ?? "").toLowerCase() !== "apple" || !row.productTitle) return "This heading could not be read as an iPhone model";
  if (!row.storage) return "This heading has no storage (for example 256GB)";
  if (row.productType !== "Mobile Phone") return "This heading could not be read as an iPhone model";
  if (row.ram) return "This heading has a RAM size; iPhone variants are stored without RAM — write only the storage";
  if (row.color) return `This heading could not be read fully (“${row.color}” is left over)`;
  return { baseTitle: row.productTitle, storage: row.storage, condition: tags.condition, pta: tags.pta, sim: tags.sim, problems: tags.problems };
}

const isHeadingLike = (text: string) => IPHONE_WORD.test(text) || BARE_MODEL_HEADING.test(text.trim());

/**
 * A line of colours only ("Green /Red Blue Blk Pink"): no digits and no price. Its colours wait for the price on the next
 * line; an unknown spelling among them still goes to Needs Attention, and colours that never get a price are listed.
 */
function colourOnly(line: string): boolean {
  if (/[0-9@]/.test(line)) return false;
  return readColors(liftTags(line).rest).length > 0;
}

/**
 * Raw list text -> one IphoneLine per colour (a line with three colours gives three). A colour-only line takes its price
 * from the next line ("Green /Red Blue Blk Pink" then "@122,000" = five variants at 122,000). Lines that are not understood
 * are listed, never guessed. A colour is never invented: a price without a colour is skipped (shown, nothing written).
 */
export function parseIphoneList(text: string, brands: BrandReference[]): ParsedIphoneList {
  const lines: IphoneLine[] = [];
  const unread: IphoneUnreadLine[] = [];
  const skipped: IphoneSkippedLine[] = [];
  let heading: Heading | null = null;
  let headingProblem: { lineNumber: number; reason: string } | null = null;
  /** Colours waiting for the price on the next line. */
  let pending: { lineNumber: number; line: string } | null = null;
  const dropPending = () => {
    const waiting = pending as { lineNumber: number; line: string } | null;
    if (waiting) unread.push({ lineNumber: waiting.lineNumber, line: waiting.line, reason: COLOURS_WITHOUT_PRICE });
    pending = null;
  };

  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, index) => {
      const lineNumber = index + 1;
      const line = raw.trim();
      if (!line) return;
      const price = splitPrice(line);

      if (!price && isHeadingLike(line)) {
        dropPending();
        const read = readHeading(line, brands);
        if (typeof read === "string") {
          heading = null;
          headingProblem = { lineNumber, reason: read };
          unread.push({ lineNumber, line, reason: read });
        } else {
          heading = read;
          headingProblem = null;
        }
        return;
      }
      if (!price && heading && colourOnly(line)) {
        dropPending();
        pending = { lineNumber, line };
        return;
      }
      if (!price) {
        unread.push({ lineNumber, line, reason: "Not understood: write a model heading (for example “iPhone 15 Pro Max 256GB”) or a colour with its price (for example “Blue @ 274,000”)" });
        return;
      }

      // A bare price ("@122,000") belongs to the colour-only line just above it.
      const waiting = pending as { lineNumber: number; line: string } | null;
      pending = null;
      const priceOnly = !liftTags(price.text).rest;
      if (waiting && !priceOnly) unread.push({ lineNumber: waiting.lineNumber, line: waiting.line, reason: COLOURS_WITHOUT_PRICE });
      const joined = waiting && priceOnly ? waiting : null;
      if (priceOnly && !joined) {
        const current = heading as Heading | null;
        skipped.push({ lineNumber, line, model: current ? `${current.baseTitle} ${current.storage}` : null, reason: SKIPPED_NO_COLOUR });
        return;
      }

      const problems: string[] = [];
      let base: string | null = null;
      let storage: string | null = null;
      let tags = liftTags(joined ? `${joined.line} ${price.text}` : price.text);
      let condition: IphoneCondition | null = null;
      let pta: IphonePta | null = null;
      let sim: IphoneSim | null = null;
      if (isHeadingLike(tags.rest)) {
        // One-line form: "iPhone 15 Pro Max 256GB Blue @ 280,000".
        const model = IPHONE_WORD.test(tags.rest) ? tags.rest : `iPhone ${tags.rest}`;
        const row = normalizeStockLines(model, { brands }).rows[0];
        const readable = row && row.productType === "Mobile Phone" && (row.brand ?? "").toLowerCase() === "apple" && row.productTitle && row.storage && !row.ram;
        if (readable && !row.color && !joined) {
          skipped.push({ lineNumber, line, model: `${row.productTitle} ${row.storage}`, reason: SKIPPED_NO_COLOUR });
          return;
        }
        if (readable && row.color) {
          base = row.productTitle;
          storage = row.storage;
          tags = { ...tags, rest: row.color };
        } else {
          problems.push("This line could not be read as an iPhone model, storage, colour and price");
        }
      } else if (heading) {
        const current: Heading = heading;
        base = current.baseTitle;
        storage = current.storage;
        condition = current.condition;
        pta = current.pta;
        sim = current.sim;
        problems.push(...current.problems);
      } else {
        const problem = headingProblem as { lineNumber: number; reason: string } | null;
        problems.push(problem ? `The model heading above (line ${problem.lineNumber}) could not be read` : "This colour line has no iPhone model heading above it");
      }

      problems.push(...tags.problems);
      // A word on the line itself wins over its heading.
      condition = tags.condition ?? condition;
      pta = tags.pta ?? pta;
      sim = tags.sim ?? sim;
      const priceMinor = priceToMinor(price.digits);
      if (priceMinor === null) problems.push("The price could not be read");
      const colors = readColors(tags.rest);
      const sourceLine = joined ? `${joined.line} ${line} (lines ${joined.lineNumber}–${lineNumber})` : line;
      const shared = { lineNumber: joined?.lineNumber ?? lineNumber, sourceLine, baseTitle: base, storage, priceMinor, listedCondition: condition, listedPta: pta, listedSim: sim };
      const keyLine = shared.lineNumber;

      if (!colors.length) {
        lines.push({ ...shared, lineKey: `${keyLine}:${sourceLine}`, colorWritten: null, colorKnown: false, colorNote: null, problems: [...problems, "This line has no colour"] });
        return;
      }
      colors.forEach((color, colorIndex) => {
        lines.push({
          ...shared,
          lineKey: colors.length === 1 ? `${keyLine}:${sourceLine}` : `${keyLine}:${colorIndex}:${sourceLine}`,
          colorWritten: color.color,
          colorKnown: color.known,
          colorNote: color.note,
          problems: [...problems],
        });
      });
    });
  dropPending();

  return { lines, unread: unread.sort((a, b) => a.lineNumber - b.lineNumber), skipped };
}

// ---------------------------------------------------------------------------
// Owner decisions (kept with the list; a decision only applies to the exact line it was made for)
// ---------------------------------------------------------------------------

export type IphoneDecisions = {
  /** lineKey -> the colour the Owner chose for an unknown colour (the written one, or a suggestion). */
  colors: Record<string, string>;
  /** Product titles the Owner confirmed as genuinely new phones (identity keys). */
  newPhones: Record<string, true>;
};

export const emptyDecisions = (): IphoneDecisions => ({ colors: {}, newPhones: {} });

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type IphoneEntryKind = "same" | "price_change" | "show_again" | "new_variant" | "new_phone" | "attention";

export type IphoneEntry = {
  id: string;
  kind: IphoneEntryKind;
  line: IphoneLine;
  /** The title this line belongs to (New or "(Used)" title), or null when it could not be read. */
  productTitle: string | null;
  /** Grouping key of the phone: an existing product id, or "new:<identity of title>". */
  phoneKey: string | null;
  productId: string | null;
  condition: IphoneCondition | null;
  pta: IphonePta | null;
  /** The colour that will be used (after the Owner's decision). */
  color: string | null;
  storage: string | null;
  /** SIM written in the list (blank = NULL, never guessed). */
  sim: IphoneSim | null;
  priceMinor: number | null;
  variantId: string | null;
  sku: string | null;
  currentPriceMinor: number | null;
  stock: number | null;
  /** Why this line needs the Owner (attention), or plain notes. */
  reasons: string[];
  notes: string[];
  /** An unknown colour the Owner has not decided yet, with an optional one-letter suggestion. */
  colorDecision: { written: string; suggestion: string | null } | null;
  /** This new phone needs the Owner's "This is a new phone" confirmation; the existing look-alike titles. */
  confirmNewPhone: string[] | null;
};

/** A website variant as the iPhone check reads it: the delta variant plus its stored SIM (undefined = not loaded). */
export type IphoneCatalogVariant = CatalogDeltaVariant & { simConfiguration?: string | null };

export type IphoneComparison = {
  entries: IphoneEntry[];
  unread: IphoneUnreadLine[];
  skipped: IphoneSkippedLine[];
  counts: Record<IphoneEntryKind, number> & { lines: number; unread: number; skipped: number };
};

export const usedTitle = (baseTitle: string) => `${baseTitle}${USED_TITLE_SUFFIX}`;
export const titleFor = (baseTitle: string, condition: IphoneCondition) => (condition === "used" ? usedTitle(baseTitle) : baseTitle);
const isUsedTitle = (title: string) => /\s\(used\)\s*$/i.test(title);
const baseOf = (title: string) => title.replace(/\s*\(used\)\s*$/i, "");

const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const isApple = (product: CatalogDeltaProduct) => lower(product.brand) === "apple" || IPHONE_WORD.test(product.title);
const isMobile = (product: CatalogDeltaProduct) => lower(product.categorySlug) === "mobile-phones" || lower(product.category) === "mobile phones";
const hasUnitFacts = (variant: CatalogDeltaVariant) => Boolean(variant.ram?.trim()) || variant.conditionGrade !== null || variant.batteryHealth !== null || variant.cycleCount !== null;

/** Levenshtein distance, small inputs only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = temp;
    }
  }
  return row[b.length];
}

const digitsOf = (value: string) => value.replace(/[^0-9]/g, "");
const simLabel = (value: string) => simConfigurationLabel(value) ?? value;

/** Common iPhone colour words, only used to SUGGEST a fix for an unknown colour (the Owner decides). */
const SUGGESTION_COLORS = ["Black", "White", "Blue", "Gold", "Purple", "Silver", "Natural", "Red", "Green", "Pink", "Yellow", "Grey", "Midnight", "Starlight", "Graphite", "Titanium"];

/** One colour exactly one letter away from the written one, or null (never two candidates). */
function suggestColor(written: string, known: readonly string[]): string | null {
  const candidates = [...new Set([...known, ...SUGGESTION_COLORS])].filter((color) => color.split(" ").length === written.split(" ").length && distance(color.toLowerCase(), written.toLowerCase()) === 1);
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Compares the list with the website. Only Apple products in Mobile Phones are ever matched, and only by the exact
 * New / Used title. Nothing is written here.
 */
export function compareIphoneList(parsed: ParsedIphoneList, catalog: readonly CatalogDeltaProduct[], selection: IphoneSelection, decisions: IphoneDecisions = emptyDecisions()): IphoneComparison {
  const apple = catalog.filter(isApple);
  const appleColors = [...new Set(apple.flatMap((product) => product.variants.map((variant) => variant.color ?? "").filter(Boolean)))];

  const entries: IphoneEntry[] = parsed.lines.map((line, index) => {
    const condition = line.listedCondition ?? selection.condition;
    const pta = line.listedPta ?? selection.pta;
    const reasons = [...line.problems];
    const notes: string[] = [];
    if (!condition) reasons.push("Choose New or Used for this list (or write it on the line)");
    if (!pta) reasons.push("Choose PTA Approved or Non-PTA for this list (or write it on the line)");

    let color = line.colorWritten;
    let colorDecision: IphoneEntry["colorDecision"] = null;
    if (line.colorNote) notes.push(line.colorNote);
    if (line.colorWritten && !line.colorKnown) {
      const chosen = decisions.colors[line.lineKey];
      if (chosen?.trim()) {
        color = normalizeColor(chosen).color;
        notes.push(chosen.trim().toLowerCase() === line.colorWritten.toLowerCase() ? `Colour “${line.colorWritten}” kept as written (your decision)` : `Colour “${line.colorWritten}” changed to “${color}” (your decision)`);
      } else {
        colorDecision = { written: line.colorWritten, suggestion: suggestColor(line.colorWritten, appleColors) };
        reasons.push(`“${line.colorWritten}” is not a known colour — check the spelling`);
      }
    }

    const productTitle = line.baseTitle && condition ? titleFor(line.baseTitle, condition) : null;
    return {
      id: `line-${line.lineNumber}-${index}`,
      kind: reasons.length ? "attention" : "same",
      line,
      productTitle,
      phoneKey: null,
      productId: null,
      condition,
      pta,
      color,
      storage: line.storage,
      sim: line.listedSim,
      priceMinor: line.priceMinor,
      variantId: null,
      sku: null,
      currentPriceMinor: null,
      stock: null,
      reasons,
      notes,
      colorDecision,
      confirmNewPhone: null,
    };
  });

  for (const entry of entries) {
    if (!entry.productTitle || !entry.condition) continue;
    const key = identityKey(entry.productTitle);
    const matches = apple.filter((product) => identityKey(product.title) === key);
    if (matches.length > 1) {
      entry.phoneKey = `title:${key}`;
      entry.reasons.push(`More than one product on the website is named “${entry.productTitle}”`);
      continue;
    }
    if (matches.length === 0) {
      entry.phoneKey = `new:${key}`;
      continue;
    }
    const product = matches[0];
    entry.phoneKey = product.id;
    entry.productId = product.id;
    if (!isMobile(product)) {
      entry.reasons.push(`“${product.title}” is not in Mobile Phones on the website; this update never touches it`);
      continue;
    }
    if (isUsedTitle(product.title) !== (entry.condition === "used")) {
      entry.reasons.push(`“${product.title}” does not follow the ${CONDITION_LABEL[entry.condition]} title rule`);
      continue;
    }
    const otherCondition = product.variants.filter((variant) => variant.condition !== entry.condition);
    if (otherCondition.length) {
      entry.reasons.push(`“${product.title}” on the website has ${otherCondition.length} variant(s) that are not ${CONDITION_LABEL[entry.condition]} (${otherCondition.map((variant) => variant.sku).join(", ")}); it is never updated by a ${CONDITION_LABEL[entry.condition]} list`);
      continue;
    }
    if (!product.variants.length) {
      entry.reasons.push(`“${product.title}” has no variants on the website, so New / Used cannot be confirmed; add its first variant in Admin`);
      continue;
    }
    if (entry.reasons.length || !entry.storage || !entry.color || entry.priceMinor === null || !entry.pta) continue;

    const same = product.variants.filter((variant) => lower(variant.storage) === lower(entry.storage) && lower(variant.color) === lower(entry.color) && variant.ptaStatus === entry.pta && variant.condition === entry.condition);
    const exact = same.filter((variant) => !hasUnitFacts(variant));
    if (exact.length > 1) {
      entry.reasons.push(`More than one website variant is ${entry.storage} ${entry.color} (${exact.map((variant) => variant.sku).join(", ")})`);
      continue;
    }
    if (exact.length === 0 && same.length) {
      entry.reasons.push(`The website variant ${same.map((variant) => variant.sku).join(", ")} is ${entry.storage} ${entry.color} with RAM / grade / battery details this list does not give; update it by hand`);
      continue;
    }
    if (exact.length === 0) {
      entry.kind = "new_variant";
      continue;
    }
    const variant: IphoneCatalogVariant = exact[0];
    // SIM given in the list must equal the stored SIM; the update never changes an existing variant's SIM.
    if (entry.sim && variant.simConfiguration !== entry.sim) {
      entry.reasons.push(
        variant.simConfiguration === undefined
          ? `The SIM of website variant ${variant.sku} could not be checked; click Check Changes again`
          : `The list says ${simLabel(entry.sim)} but website variant ${variant.sku} has ${variant.simConfiguration ? simLabel(variant.simConfiguration) : "no SIM set"}; this update never changes an existing SIM — fix it in Admin first`,
      );
      continue;
    }
    entry.variantId = variant.id;
    entry.sku = variant.sku;
    entry.currentPriceMinor = variant.priceMinor;
    entry.stock = variant.stock;
    const priceChanges = variant.priceMinor !== entry.priceMinor;
    if (priceChanges && variant.compareAtPriceMinor !== null && entry.priceMinor >= variant.compareAtPriceMinor) {
      entry.reasons.push(`The new price is not below the website's compare-at price (${variant.compareAtPriceMinor / 100}); fix it in Admin first`);
      continue;
    }
    entry.kind = !variant.isActive ? "show_again" : priceChanges ? "price_change" : "same";
    if (!variant.isActive) entry.notes.push(`Hidden on the website now; it will be shown again${priceChanges ? " with the new price" : ""}. Stock stays ${variant.stock ?? 0}.`);
  }

  // New phones: confirm when the same model already exists under the other title, or a title is one letter away.
  for (const entry of entries) {
    if (!entry.phoneKey?.startsWith("new:") || !entry.productTitle || !entry.condition) continue;
    const base = baseOf(entry.productTitle);
    const lookalikes = apple
      .filter((product) => {
        const other = baseOf(product.title);
        if (identityKey(product.title) === identityKey(entry.productTitle as string)) return false;
        if (identityKey(other) === identityKey(base)) return true;
        return digitsOf(other) === digitsOf(base) && distance(identityKey(other), identityKey(base)) <= 2;
      })
      .map((product) => product.title);
    if (lookalikes.length && !decisions.newPhones[identityKey(entry.productTitle)]) {
      entry.confirmNewPhone = lookalikes;
      entry.reasons.push(`A similar phone is already on the website (${lookalikes.join(", ")}); confirm that “${entry.productTitle}” is a new, separate phone`);
    } else if (lookalikes.length) {
      entry.notes.push(`Confirmed as a new phone (separate from ${lookalikes.join(", ")})`);
    }
    if (!entry.reasons.length) entry.kind = "new_phone";
  }

  // The same variant twice in one list: every copy waits for the Owner.
  const groups = new Map<string, IphoneEntry[]>();
  for (const entry of entries) {
    if (!entry.phoneKey || !entry.storage || !entry.color || !entry.pta) continue;
    const key = [entry.phoneKey, lower(entry.storage), lower(entry.color), entry.pta].join("|");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const lines = group.map((entry) => entry.line.lineNumber).join(", ");
    for (const entry of group) entry.reasons.push(`The same variant is listed more than once (lines ${lines})`);
  }

  for (const entry of entries) if (entry.reasons.length) entry.kind = "attention";

  const counts = { same: 0, price_change: 0, show_again: 0, new_variant: 0, new_phone: 0, attention: 0, lines: entries.length, unread: parsed.unread.length, skipped: parsed.skipped.length };
  for (const entry of entries) counts[entry.kind] += 1;
  return { entries, unread: parsed.unread, skipped: parsed.skipped, counts };
}

// ---------------------------------------------------------------------------
// Per-phone plan
// ---------------------------------------------------------------------------

/** One step as apply_iphone_stock_phone reads it (see the migration). */
export type IphoneRpcStep =
  | { kind: "price"; variant_id: string; from_minor: number; to_minor: number }
  | { kind: "show"; variant_id: string; from_minor: number; to_minor: number }
  | { kind: "add_variant"; storage: string; color: string; price_minor: number; stock: number; pta_status: IphonePta; condition: IphoneCondition; sim_configuration: IphoneSim | null };

export type IphoneRpcPayload = {
  product_id: string;
  condition: IphoneCondition;
  expected: { variants: { id: string; price_minor: number; is_active: boolean }[] };
  steps: IphoneRpcStep[];
};

/** One new phone for apply_catalog_bulk_import_v2 (action "Create" only; created as a draft). */
export type IphoneNewPhonePayload = {
  source: string;
  action: "Create";
  product_type: "Mobile Phone";
  brand: "Apple";
  category: "Mobile Phones";
  title: string;
  variants: {
    source: string;
    ram: null;
    storage: string;
    color: string;
    price_minor: number;
    stock: number;
    pta_status: IphonePta;
    condition: IphoneCondition;
    condition_grade: null;
    battery_health_percent: null;
    battery_cycle_count: null;
    sim_configuration: IphoneSim | null;
    warranty: null;
    delivery_scope: "karachi_only";
  }[];
};

export type IphonePhoneUpdate =
  | { kind: "existing"; key: string; productId: string; productTitle: string; entries: IphoneEntry[]; payload: IphoneRpcPayload }
  | { kind: "new"; key: string; productId: null; productTitle: string; entries: IphoneEntry[]; payload: IphoneNewPhonePayload };

export type IphoneHeldPhone = { key: string; productTitle: string; reasons: string[]; lines: number[] };

export type IphonePlan = {
  phones: IphonePhoneUpdate[];
  held: IphoneHeldPhone[];
  changeCount: number;
  counts: { priceUpdates: number; shownAgain: number; newVariants: number; newPhones: number; newPhoneVariants: number; same: number; heldPhones: number };
};

const WRITING_KINDS = new Set<IphoneEntryKind>(["price_change", "show_again", "new_variant", "new_phone"]);

/**
 * Groups the comparison by phone. A phone with ANY line that needs attention is held whole (nothing written).
 * Every other phone becomes ONE all-or-nothing database call. Lines that are the same need no write.
 */
export function buildIphonePlan(comparison: IphoneComparison, catalog: readonly CatalogDeltaProduct[]): IphonePlan {
  const byId = new Map(catalog.map((product) => [product.id, product] as const));
  const byPhone = new Map<string, IphoneEntry[]>();
  const held = new Map<string, IphoneHeldPhone>();
  for (const entry of comparison.entries) {
    if (!entry.phoneKey) {
      const key = `line:${entry.line.lineNumber}`;
      held.set(key, { key, productTitle: entry.line.baseTitle ?? entry.line.sourceLine, reasons: [...entry.reasons], lines: [entry.line.lineNumber] });
      continue;
    }
    byPhone.set(entry.phoneKey, [...(byPhone.get(entry.phoneKey) ?? []), entry]);
  }

  const phones: IphonePhoneUpdate[] = [];
  for (const [key, entries] of byPhone) {
    const title = entries[0].productTitle ?? "";
    const problems = entries.filter((entry) => entry.kind === "attention");
    if (problems.length) {
      held.set(key, { key, productTitle: title, reasons: [...new Set(problems.flatMap((entry) => entry.reasons.map((reason) => `Line ${entry.line.lineNumber}: ${reason}`)))], lines: problems.map((entry) => entry.line.lineNumber) });
      continue;
    }
    const writing = entries.filter((entry) => WRITING_KINDS.has(entry.kind));
    if (!writing.length) continue;
    const condition = entries[0].condition as IphoneCondition;
    if (key.startsWith("new:")) {
      phones.push({
        kind: "new",
        key,
        productId: null,
        productTitle: title,
        entries: writing,
        payload: {
          source: `iPhone Stock Update: ${title}`,
          action: "Create",
          product_type: "Mobile Phone",
          brand: "Apple",
          category: "Mobile Phones",
          title,
          variants: writing.map((entry) => ({
            source: `Line ${entry.line.lineNumber}: ${entry.storage} ${entry.color}`,
            ram: null,
            storage: entry.storage as string,
            color: entry.color as string,
            price_minor: entry.priceMinor as number,
            stock: IPHONE_NEW_VARIANT_STOCK,
            pta_status: entry.pta as IphonePta,
            condition,
            condition_grade: null,
            battery_health_percent: null,
            battery_cycle_count: null,
            sim_configuration: entry.sim,
            warranty: null,
            delivery_scope: "karachi_only",
          })),
        },
      });
      continue;
    }
    const product = byId.get(key);
    if (!product) continue;
    const steps: IphoneRpcStep[] = writing.map((entry) => {
      if (entry.kind === "price_change") return { kind: "price", variant_id: entry.variantId as string, from_minor: entry.currentPriceMinor as number, to_minor: entry.priceMinor as number };
      if (entry.kind === "show_again") return { kind: "show", variant_id: entry.variantId as string, from_minor: entry.currentPriceMinor as number, to_minor: entry.priceMinor as number };
      return { kind: "add_variant", storage: entry.storage as string, color: entry.color as string, price_minor: entry.priceMinor as number, stock: IPHONE_NEW_VARIANT_STOCK, pta_status: entry.pta as IphonePta, condition, sim_configuration: entry.sim };
    });
    phones.push({
      kind: "existing",
      key,
      productId: product.id,
      productTitle: product.title,
      entries: writing,
      payload: {
        product_id: product.id,
        condition,
        expected: { variants: product.variants.map((variant) => ({ id: variant.id, price_minor: variant.priceMinor, is_active: variant.isActive })) },
        steps,
      },
    });
  }

  const written = phones.flatMap((phone) => phone.entries);
  const count = (kind: IphoneEntryKind) => written.filter((entry) => entry.kind === kind).length;
  const heldList = [...held.values()];
  return {
    phones,
    held: heldList,
    changeCount: written.length,
    counts: {
      priceUpdates: count("price_change"),
      shownAgain: count("show_again"),
      newVariants: count("new_variant"),
      newPhones: phones.filter((phone) => phone.kind === "new").length,
      newPhoneVariants: count("new_phone"),
      same: comparison.entries.filter((entry) => entry.kind === "same").length,
      heldPhones: heldList.length,
    },
  };
}

/** Fingerprint of everything Check Changes looked at (list text, choices, decisions): Update Website needs a fresh check. */
export function checkFingerprint(text: string, selection: IphoneSelection, decisions: IphoneDecisions): string {
  const source = JSON.stringify([text.replace(/\r\n?/g, "\n"), selection.condition, selection.pta, Object.entries(decisions.colors).sort(), Object.keys(decisions.newPhones).sort()]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${source.length}:${hash.toString(16).padStart(8, "0")}`;
}
