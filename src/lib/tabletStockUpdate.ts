/**
 * Tablets & MacBooks Stock Update (New + Used): Paste List -> Check Changes. Pure: nothing here reads from or writes to the
 * database.
 *
 * Owner rules (approved 2026-10-26):
 *   - Product type comes from the Owner's choice on the page, never from the title alone:
 *       iPad    -> Apple iPads           (category "tablets", brand Apple)
 *       Tablet  -> Android/other tablets (category "tablets", any brand except Apple)
 *       MacBook -> Apple MacBooks        (category "laptops", brand Apple). Windows laptops are not sold: never added.
 *   - New and Used are separate products: "Apple MacBook Air M5" and "Apple MacBook Air M5 (Used)". A product is only
 *     matched by that exact title, and only if every variant it has is of the list's condition (as iPhone Stock Update).
 *   - Listed existing variant: price only, stock kept. Hidden listed variant: shown again with the latest price, stock kept.
 *   - New variant / new product: opening stock 20, delivery Karachi only, warranty / grade / battery / SIM blank (NULL).
 *     A new product is a draft. Variants and products absent from the list are never touched.
 *   - RAM, storage and colour are read from the list; a missing colour stays blank (NULL). Nothing is guessed.
 *   - PTA: WiFi tablets and MacBooks are "Not Applicable"; Cellular tablets need the Owner's PTA Approved / Non-PTA.
 *     When the connectivity is unclear the line waits for the Owner.
 *
 * List formats (as the Owner writes them), mixed freely:
 *   Galaxy Tab A8 4/64; 43,000                one line: model, RAM/storage, optional colour, price
 *   Macbook Air M5 Now Available              a model heading, then a price line and a configuration line (either order)
 *   420500
 *   16-512Gb Midnight
 *   Macbook Air M5 16-256Gb                   model + configuration without a price, then one colour + price per line
 *   SkyBlue 397,000
 *   Silver @402,000
 *   Samsung Tab S10 Lite 6-128Gb@98,500       one-line entry, then more configurations of the same model with their price
 *   6-256Gb @115,000
 */
import { normalizeColor } from "./catalogColors.ts";
import { normalizeStockLines, type BrandReference } from "./catalogSheet.ts";
import { identityKey, type CatalogDeltaProduct, type CatalogDeltaVariant } from "./stockListDelta.ts";

/** Opening stock of every new variant (Owner rule). Existing variants keep their stock. */
export const TABLET_NEW_VARIANT_STOCK = 20;
export const USED_TITLE_SUFFIX = " (Used)";

export type TabletProductType = "ipad" | "tablet" | "macbook";
export type TabletCondition = "brand_new" | "used";
export type TabletConnectivity = "wifi" | "cellular_pta" | "cellular_non_pta";
export type TabletPta = "approved" | "not_approved" | "not_applicable";
export type TabletSelection = { productType: TabletProductType | null; condition: TabletCondition | null; connectivity: TabletConnectivity | null };

export const PRODUCT_TYPE_LABEL: Record<TabletProductType, string> = { ipad: "iPad", tablet: "Tablet", macbook: "MacBook" };
export const CONDITION_LABEL: Record<TabletCondition, string> = { brand_new: "New", used: "Used" };
export const CONNECTIVITY_LABEL: Record<TabletConnectivity, string> = { wifi: "WiFi Only", cellular_pta: "Cellular — PTA Approved", cellular_non_pta: "Cellular — Non-PTA" };
export const PTA_LABEL: Record<TabletPta, string> = { approved: "PTA Approved", not_approved: "Non-PTA", not_applicable: "PTA Not Applicable" };

/** Where each product type lives (existing categories; nothing is created or renamed). */
export const TYPE_CATEGORY: Record<TabletProductType, { slug: "tablets" | "laptops"; name: "Tablets" | "Laptops"; productType: "Tablet" | "Laptop" }> = {
  ipad: { slug: "tablets", name: "Tablets", productType: "Tablet" },
  tablet: { slug: "tablets", name: "Tablets", productType: "Tablet" },
  macbook: { slug: "laptops", name: "Laptops", productType: "Laptop" },
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Connectivity = "wifi" | "cellular" | "both" | null;

/** One variant read from the list (one per colour), not yet compared. */
export type TabletLine = {
  lineNumber: number;
  sourceLine: string;
  /** Stable key of this exact line (number + text) for the Owner's decisions. */
  lineKey: string;
  /** The New title as read ("Apple MacBook Air M5"); the Used title adds " (Used)". */
  baseTitle: string | null;
  brand: string | null;
  ram: string | null;
  storage: string | null;
  /** The colour as written (title-cased), before any Owner decision; null = not written (stays blank). */
  colorWritten: string | null;
  colorKnown: boolean;
  priceMinor: number | null;
  /** New/Used and PTA words written on the heading or the line (null = not written). */
  listedCondition: TabletCondition | null;
  listedPta: "approved" | "not_approved" | null;
  /** WiFi / 4G / 5G / LTE / Cellular words in the title or the line. */
  listedConnectivity: Connectivity;
  notes: string[];
  problems: string[];
};

export type TabletUnreadLine = { lineNumber: number; line: string; reason: string };
export type ParsedTabletList = { lines: TabletLine[]; unread: TabletUnreadLine[] };

/** Owner-confirmed announcement wording (2026-10-26: "Macbook Air M5 Now Available"). No other phrase is ever removed. */
const ANNOUNCEMENT = /\bnow\s+available\b/gi;
const WIFI_WORD = /\bwi[\s-]?fi\b/i;
const CELLULAR_WORD = /\b(?:4g|5g|lte|cellular)\b/i;
const PRICE_DIGITS = "(?:rs\\.?\\s*)?([0-9][0-9,]*)\\s*(?:\\/-)?";
/** A line that is only a price: "420500", "Rs 43,000", "@ 26,500/-". Four or more digits, or comma-grouped. */
const PRICE_ONLY = /^@?\s*(?:rs\.?\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})\s*(?:\/-)?$/i;
/** "Galaxy Tab A8 4/64; 43,000" */
const PRICE_AFTER_SEMICOLON = new RegExp(`^(.*?);\\s*${PRICE_DIGITS}\\s*$`, "i");
/** "8/256 Grey @ 52,000" */
const PRICE_AT_END = new RegExp(`^(.*?)@\\s*${PRICE_DIGITS}\\s*$`, "i");
/** "@52,000 8/256 Grey" */
const PRICE_AT_START = new RegExp(`^@\\s*${PRICE_DIGITS}\\s+(.+)$`, "i");
/** "8/256 Grey 52,000": only a comma-grouped amount or 5+ digits counts, so "iPad 11 128" is never a price. */
const PRICE_BARE_END = /^(.*?\S)\s+(?:rs\.?\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,})\s*(?:\/-)?\s*$/i;
/** A configuration line starts with RAM/storage ("16/512GB", "8/256") or storage ("256GB"). */
const CONFIG_START = /^(?:(\d{1,3})\s*(?:gb)?\s*\/\s*(\d{1,4})\s*(gb|tb)?|(\d{1,4})\s*(gb|tb))(?=\s|$)/i;

const priceToMinor = (digits: string): number | null => {
  const clean = digits.replace(/,/g, "");
  if (!/^[0-9]{1,12}$/.test(clean)) return null;
  const rupees = Number(clean);
  return rupees > 0 ? rupees * 100 : null;
};

function splitPrice(line: string): { text: string; digits: string } | null {
  const semicolon = line.match(PRICE_AFTER_SEMICOLON);
  if (semicolon) return { text: semicolon[1], digits: semicolon[2] };
  const end = line.match(PRICE_AT_END);
  if (end) return { text: end[1], digits: end[2] };
  const start = line.match(PRICE_AT_START);
  if (start) return { text: start[2], digits: start[1] };
  const bare = line.match(PRICE_BARE_END);
  if (bare) return { text: bare[1], digits: bare[2] };
  return null;
}

/** "16-512Gb" / "16GB-512GB" -> "16/512Gb" (RAM-storage written with a dash). Only RAM of 1–2 digits followed by a GB/TB storage. */
const dashToSlash = (text: string) => text.replace(/\b(\d{1,2})\s*(?:gb)?\s*-\s*(\d{1,4})\s*(gb|tb)\b/gi, "$1/$2$3");

/** Words that belong to model names, never read as a colour on a colour + price line. */
const NOT_A_COLOUR = /^(?:ipad|macbook|tab|tablet|pad|galaxy|air|pro|mini|max|ultra|lite|plus|fe|m\d+)$/i;

type Tags = { condition: TabletCondition | null; pta: "approved" | "not_approved" | null; problems: string[]; rest: string };

/** Lifts New / Used / PTA / Non-PTA words out of a piece of text (connectivity words stay: they are part of names). */
function liftTags(text: string): Tags {
  const problems: string[] = [];
  let rest = ` ${text} `;
  const take = (pattern: RegExp) => {
    const found = pattern.test(rest);
    if (found) rest = rest.replace(pattern, " ");
    return found;
  };
  const nonPta = take(/\bnon[\s-]*pta\b/gi);
  const pta = take(/\bpta(?:\s*approved)?\b/gi);
  const used = take(/\bused\b/gi);
  const isNew = take(/\b(?:brand\s*new|new)\b/gi);
  if (nonPta && pta) problems.push("Both PTA and Non-PTA are written");
  if (used && isNew) problems.push("Both New and Used are written");
  return {
    condition: used && !isNew ? "used" : isNew && !used ? "brand_new" : null,
    pta: nonPta && !pta ? "not_approved" : pta && !nonPta ? "approved" : null,
    problems,
    rest: rest.replace(/\s+/g, " ").trim(),
  };
}

const connectivityOf = (...texts: (string | null | undefined)[]): Connectivity => {
  const joined = texts.filter(Boolean).join(" ");
  const wifi = WIFI_WORD.test(joined);
  const cellular = CELLULAR_WORD.test(joined);
  return wifi && cellular ? "both" : wifi ? "wifi" : cellular ? "cellular" : null;
};

const capacityLabel = (amount: string, unit: string | undefined) => `${Number(amount)} ${(unit ?? "gb").toUpperCase()}`;

/** Colours after the configuration: split on "/" or ","; each kept as written (title-cased by the shared reader). */
function readColors(text: string): { written: string; known: boolean }[] {
  return text
    .replace(/[;:]+$/, "")
    .split(/\s*[/,]\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const { color, known } = normalizeColor(segment);
      return { written: color, known };
    });
}

type Config = { ram: string | null; storage: string | null; colors: { written: string; known: boolean }[] };

/** "16/512GB Midnight" -> RAM 16 GB, storage 512 GB, colour Midnight. Null when the text does not start with one. */
function readConfig(text: string): Config | null {
  const match = text.match(CONFIG_START);
  if (!match) return null;
  const rest = text.slice(match[0].length).trim();
  if (match[2]) return { ram: capacityLabel(match[1], "gb"), storage: capacityLabel(match[2], match[3]), colors: readColors(rest) };
  return { ram: null, storage: capacityLabel(match[4], match[5]), colors: readColors(rest) };
}

/**
 * The text of a "colour + price" line ("SkyBlue", "Silver -", "Blue/Grey"), or null when it is not only colours. A known
 * colour, or one plain word that is not a brand or a model word (an unknown colour, which waits for the Owner's "Keep").
 */
function readColorOnly(text: string, brands: BrandReference[]): { written: string; known: boolean }[] | null {
  const clean = text.replace(/[\s;:,=\-–]+$/, "").trim();
  if (!clean || /\d/.test(clean) || WIFI_WORD.test(clean) || CELLULAR_WORD.test(clean)) return null;
  const brandNames = new Set(brands.flatMap((brand) => [brand.name, ...(brand.aliases ?? [])]).map((name) => name.toLowerCase()));
  const segments = clean.split(/\s*[/,]\s*/).filter(Boolean);
  const plainWord = (segment: string) => /^[a-z]+$/i.test(segment) && !NOT_A_COLOUR.test(segment) && !brandNames.has(segment.toLowerCase());
  if (!segments.every((segment) => normalizeColor(segment).known || plainWord(segment))) return null;
  return readColors(clean);
}

type Model = { lineNumber: number; baseTitle: string; brand: string | null; condition: TabletCondition | null; pta: "approved" | "not_approved" | null; connectivityText: string; notes: string[]; problems: string[] };

type Pending =
  | { kind: "price"; lineNumber: number; line: string; digits: string }
  | { kind: "config"; lineNumber: number; line: string; model: Model; config: Config; tags: Tags };

/**
 * Raw list text -> one TabletLine per colour. A model heading is followed by a price line and a configuration line in
 * either order (the Owner-confirmed MacBook block); a one-line entry carries everything itself. Two prices or two
 * configurations in a row, a configuration without a model above, and anything else not understood is listed for the
 * Owner, never guessed.
 */
export function parseTabletList(text: string, brands: BrandReference[]): ParsedTabletList {
  const lines: TabletLine[] = [];
  const unread: TabletUnreadLine[] = [];
  let heading: Model | null = null;
  let pending: Pending | null = null;
  /** Under one heading, the first price + configuration pair sets the order; the other order is unclear and waits. */
  let blockOrder: "price_first" | "config_first" | null = null;
  const ORDER_UNCLEAR = "Price and configuration lines are in a different order than the pair above — which price belongs to which configuration is unclear";

  const flush = (reason?: string) => {
    const waiting = pending as Pending | null;
    if (waiting)
      unread.push({
        lineNumber: waiting.lineNumber,
        line: waiting.line,
        reason: reason ?? (waiting.kind === "price" ? "A price without a configuration (RAM/storage) after it — not used" : "A configuration without a price — not used; write the price on this line or the next line"),
      });
    pending = null;
  };

  /** A configuration (without colour) that colour + price lines below it belong to, and the latest one-line entry. */
  type ColorGroup = { model: Model; config: Config; tags: Tags; lineNumber: number; line: string };
  let colorGroup: ColorGroup | null = null;
  let lastOneLine: { model: Model; lineNumber: number } | null = null;

  const emit = (model: Model, config: Config, digits: string, tags: Tags, lineNumbers: number[], sourceLines: string[], at?: number) => {
    const problems = [...model.problems, ...tags.problems];
    const priceMinor = priceToMinor(digits);
    if (priceMinor === null) problems.push("The price could not be read");
    if (!config.storage) problems.push("No storage is written (for example 256GB)");
    const lineNumber = at ?? Math.min(...lineNumbers);
    const sourceLine = sourceLines.length > 1 ? `${sourceLines.join(" · ")} (lines ${lineNumbers.join(", ")})` : sourceLines[0];
    const shared = {
      lineNumber,
      sourceLine,
      baseTitle: model.baseTitle,
      brand: model.brand,
      ram: config.ram,
      storage: config.storage,
      priceMinor,
      listedCondition: tags.condition ?? model.condition,
      listedPta: tags.pta ?? model.pta,
      listedConnectivity: connectivityOf(model.connectivityText, tags.rest),
      notes: [...model.notes],
    };
    if (!config.colors.length) {
      lines.push({ ...shared, lineKey: `${lineNumber}:${sourceLine}`, colorWritten: null, colorKnown: true, problems });
      return;
    }
    config.colors.forEach((color, index) =>
      lines.push({
        ...shared,
        lineKey: config.colors.length === 1 ? `${lineNumber}:${sourceLine}` : `${lineNumber}:${index}:${sourceLine}`,
        colorWritten: color.written,
        colorKnown: color.known,
        problems: [...problems],
      }),
    );
  };

  /** The model text of a heading or one-line entry, read by the shared catalog reader (brand + model name). */
  const readModel = (text: string, lineNumber: number, tags: Tags) => {
    const notes: string[] = [];
    let modelText = text;
    if (ANNOUNCEMENT.test(modelText)) {
      modelText = modelText.replace(ANNOUNCEMENT, " ").replace(/\s+/g, " ").trim();
      notes.push("“Now Available” read as an announcement, not part of the name");
    }
    ANNOUNCEMENT.lastIndex = 0;
    const row = normalizeStockLines(modelText, { brands }).rows[0];
    if (!row || !row.productTitle) return null;
    const model: Model = { lineNumber, baseTitle: row.productTitle, brand: row.brand, condition: tags.condition, pta: tags.pta, connectivityText: modelText, notes, problems: [...tags.problems] };
    return { model, row };
  };

  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, index) => {
      const lineNumber = index + 1;
      const line = raw.trim();
      if (!line) return;

      const bare = line.match(PRICE_ONLY);
      if (bare) {
        colorGroup = null;
        lastOneLine = null;
        const waiting = pending as Pending | null;
        if (waiting?.kind === "config") {
          if (heading && blockOrder === "price_first") {
            flush(ORDER_UNCLEAR);
            unread.push({ lineNumber, line, reason: ORDER_UNCLEAR });
            return;
          }
          if (heading) blockOrder = "config_first";
          emit(waiting.model, waiting.config, bare[1], waiting.tags, [waiting.lineNumber, lineNumber], [waiting.line, line]);
          pending = null;
        } else if (waiting?.kind === "price") {
          flush("Two prices in a row — which configuration each belongs to is unclear");
          unread.push({ lineNumber, line, reason: "Two prices in a row — which configuration each belongs to is unclear" });
        } else if (!heading) {
          unread.push({ lineNumber, line, reason: "A price without a model above it" });
        } else {
          pending = { kind: "price", lineNumber, line, digits: bare[1] };
        }
        return;
      }

      const price = splitPrice(line);
      const tags = liftTags(dashToSlash(price ? price.text : line));
      const config = readConfig(tags.rest);
      const colors = config ? null : readColorOnly(tags.rest, brands);
      const waitingNow = pending as Pending | null;

      // "SkyBlue 397,000" / "Silver @402,000": one colour + price under the configuration above it.
      if (colors && (price || waitingNow?.kind === "config" || colorGroup)) {
        if (!price) {
          flush();
          colorGroup = null;
          unread.push({ lineNumber, line, reason: "A colour without a price — not used; write the price on the same line (for example “Silver 402,000”)" });
          return;
        }
        if (waitingNow?.kind === "config") {
          if (waitingNow.config.colors.length) {
            flush("This configuration already has a colour, and colour + price lines follow it — which price is for which colour is unclear");
          } else {
            colorGroup = { model: waitingNow.model, config: waitingNow.config, tags: waitingNow.tags, lineNumber: waitingNow.lineNumber, line: waitingNow.line };
            pending = null;
          }
        } else flush();
        const group = colorGroup as ColorGroup | null;
        if (!group) {
          unread.push({
            lineNumber,
            line,
            reason: heading
              ? `A colour and price under “${heading.baseTitle}”, but no RAM/storage is written above it — write it with the model (for example “Macbook Air M5 16-256Gb”)`
              : "A colour and price without a model and RAM/storage above it — not used",
          });
          return;
        }
        const problems = [...group.tags.problems, ...tags.problems];
        if (tags.condition && group.tags.condition && tags.condition !== group.tags.condition) problems.push(`New / Used on this line differs from line ${group.lineNumber}`);
        if (tags.pta && group.tags.pta && tags.pta !== group.tags.pta) problems.push(`PTA on this line differs from line ${group.lineNumber}`);
        const merged: Tags = { condition: tags.condition ?? group.tags.condition, pta: tags.pta ?? group.tags.pta, problems, rest: `${group.tags.rest} ${tags.rest}` };
        emit(group.model, { ...group.config, colors }, price.digits, merged, [group.lineNumber, lineNumber], [group.line, line], lineNumber);
        return;
      }
      colorGroup = null;

      if (config) {
        if (!heading) {
          flush();
          const above = lastOneLine as { model: Model; lineNumber: number } | null;
          if (above && price) {
            // "6-256Gb @115,000" right under "Samsung Tab S10 Lite 6-128Gb@98,500": another configuration of that model.
            const model: Model = { ...above.model, notes: [...above.model.notes, `Model “${above.model.baseTitle}” read from line ${above.lineNumber} above`] };
            emit(model, config, price.digits, tags, [lineNumber], [line]);
            return;
          }
          unread.push({
            lineNumber,
            line,
            reason: above
              ? `A configuration without a price under “${above.model.baseTitle}” — write the price on the same line (for example “6-256Gb @115,000”)`
              : "A configuration without a model heading above it",
          });
          return;
        }
        const model: Model = heading;
        const waiting = pending as Pending | null;
        if (price) {
          flush();
          emit(model, config, price.digits, tags, [lineNumber], [line]);
        } else if (waiting?.kind === "price") {
          if (blockOrder === "config_first") {
            flush(ORDER_UNCLEAR);
            unread.push({ lineNumber, line, reason: ORDER_UNCLEAR });
            return;
          }
          blockOrder = "price_first";
          emit(model, config, waiting.digits, tags, [waiting.lineNumber, lineNumber], [waiting.line, line]);
          pending = null;
        } else {
          flush();
          pending = { kind: "config", lineNumber, line, model, config, tags };
        }
        return;
      }

      flush();
      const read = readModel(tags.rest, lineNumber, tags);
      lastOneLine = null;
      if (!read) {
        heading = null;
        unread.push({ lineNumber, line, reason: "Not understood: write a model (for example “Galaxy Tab A8 4/64; 43,000”) or a configuration with its price" });
        return;
      }
      if (read.row.storage) {
        // One-line entry: model + RAM/storage (+ colour) on the same line, price here or on the next line.
        const own: Config = { ram: read.row.ram, storage: read.row.storage, colors: read.row.color ? readColors(read.row.color) : [] };
        heading = null;
        blockOrder = null;
        lastOneLine = { model: read.model, lineNumber };
        if (price) emit(read.model, own, price.digits, { ...tags, rest: read.model.connectivityText }, [lineNumber], [line]);
        else pending = { kind: "config", lineNumber, line, model: read.model, config: own, tags: { ...tags, rest: read.model.connectivityText } };
        return;
      }
      if (price) {
        heading = null;
        unread.push({ lineNumber, line, reason: "A price on a model line without RAM/storage — which configuration it is for is unclear" });
        return;
      }
      heading = read.model;
      blockOrder = null;
    });
  flush();

  return { lines, unread: unread.sort((a, b) => a.lineNumber - b.lineNumber) };
}

// ---------------------------------------------------------------------------
// Owner decisions (kept with the list; a decision only applies to the exact line it was made for)
// ---------------------------------------------------------------------------

export type TabletDecisions = {
  /** lineKey -> the colour the Owner chose for an unknown colour (kept as written). */
  colors: Record<string, string>;
  /** Product titles the Owner confirmed as genuinely new products (identity keys). */
  newProducts: Record<string, true>;
};

export const emptyDecisions = (): TabletDecisions => ({ colors: {}, newProducts: {} });

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type TabletEntryKind = "same" | "price_change" | "show_again" | "new_variant" | "new_product" | "attention";

export type TabletEntry = {
  id: string;
  kind: TabletEntryKind;
  line: TabletLine;
  productType: TabletProductType | null;
  /** The title this line belongs to (New or "(Used)" title), or null when it could not be read. */
  productTitle: string | null;
  /** Grouping key: an existing product id, or "new:<identity of title>". */
  productKey: string | null;
  productId: string | null;
  condition: TabletCondition | null;
  pta: TabletPta | null;
  ram: string | null;
  storage: string | null;
  color: string | null;
  priceMinor: number | null;
  variantId: string | null;
  sku: string | null;
  currentPriceMinor: number | null;
  stock: number | null;
  reasons: string[];
  notes: string[];
  /** An unknown colour the Owner has not decided yet. */
  colorDecision: { written: string } | null;
  /** This new product needs the Owner's "This is a new product" confirmation; the existing look-alike titles. */
  confirmNewProduct: string[] | null;
};

export type TabletComparison = {
  entries: TabletEntry[];
  unread: TabletUnreadLine[];
  counts: Record<TabletEntryKind, number> & { lines: number; unread: number };
};

export const usedTitle = (baseTitle: string) => `${baseTitle}${USED_TITLE_SUFFIX}`;
export const titleFor = (baseTitle: string, condition: TabletCondition) => (condition === "used" ? usedTitle(baseTitle) : baseTitle);
const isUsedTitle = (title: string) => /\s\(used\)\s*$/i.test(title);
const baseOf = (title: string) => title.replace(/\s*\(used\)\s*$/i, "");
const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
/** RAM / storage / colour compared without spacing or case ("16 GB" = "16GB"); blank stays blank. */
const factKey = (value: string | null | undefined) => (value?.trim() ? value.replace(/\s+/g, "").toLowerCase() : null);
const isApple = (brand: string | null | undefined) => lower(brand) === "apple";
const hasUnitFacts = (variant: CatalogDeltaVariant) => variant.conditionGrade !== null || variant.batteryHealth !== null || variant.cycleCount !== null;
const digitsOf = (value: string) => value.replace(/[^0-9]/g, "");

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

/** The product type rules for one line; returns the reasons it does not fit (empty = it fits). */
function typeProblems(type: TabletProductType, line: TabletLine): string[] {
  const title = line.baseTitle ?? "";
  if (!line.brand) return [`The brand of “${title}” is not recognised — add the brand in Admin first (nothing is guessed)`];
  if (type === "ipad") return isApple(line.brand) && /\bipad\b/i.test(title) ? [] : [`“${title}” is not an Apple iPad — choose the right product type`];
  if (type === "macbook") return isApple(line.brand) && /\bmacbook\b/i.test(title) ? [] : [`“${title}” is not an Apple MacBook — only Apple MacBooks are sold; Windows laptops are never added`];
  if (isApple(line.brand)) return [`“${title}” is an Apple product — choose iPad (or MacBook)`];
  if (/\b(?:macbook|laptop|notebook)\b/i.test(title)) return [`“${title}” looks like a laptop — laptops other than Apple MacBooks are never added`];
  return [];
}

/** PTA of one line from its connectivity: the Owner's choice, or the words in the list when they agree with it. */
function ptaFor(type: TabletProductType, line: TabletLine, selection: TabletSelection): { pta: TabletPta | null; reasons: string[] } {
  if (type === "macbook") {
    if (line.listedConnectivity === "cellular" || line.listedConnectivity === "both" || line.listedPta)
      return { pta: null, reasons: ["Cellular / PTA is written for a MacBook — check this line"] };
    return { pta: "not_applicable", reasons: [] };
  }
  if (line.listedConnectivity === "both") return { pta: null, reasons: ["Both WiFi and Cellular are written — check this line"] };
  const chosen = selection.connectivity;
  const chosenKind = chosen === "wifi" ? "wifi" : chosen ? "cellular" : null;
  const kind = line.listedConnectivity ?? chosenKind;
  if (!kind) return { pta: null, reasons: ["Connectivity is not clear — choose WiFi Only or Cellular for this list (or write WiFi / 4G / 5G on the line)"] };
  if (line.listedConnectivity && chosenKind && line.listedConnectivity !== chosenKind)
    return { pta: null, reasons: [`The list says ${line.listedConnectivity === "wifi" ? "WiFi" : "Cellular"} but you chose ${CONNECTIVITY_LABEL[chosen as TabletConnectivity]} — check this line`] };
  if (kind === "wifi") {
    if (line.listedPta) return { pta: null, reasons: ["PTA is written for a WiFi tablet — check this line"] };
    return { pta: "not_applicable", reasons: [] };
  }
  const pta = line.listedPta ?? (chosen === "cellular_pta" ? "approved" : chosen === "cellular_non_pta" ? "not_approved" : null);
  if (!pta) return { pta: null, reasons: ["Cellular tablet: choose Cellular — PTA Approved or Cellular — Non-PTA (or write PTA / Non-PTA on the line)"] };
  return { pta, reasons: [] };
}

/**
 * Compares the list with the website. Only products in the type's category ("tablets" / "laptops") are ever matched, only by
 * the exact New / Used title, and a MacBook only when it is Apple. Nothing is written here.
 */
export function compareTabletList(parsed: ParsedTabletList, catalog: readonly CatalogDeltaProduct[], selection: TabletSelection, decisions: TabletDecisions = emptyDecisions()): TabletComparison {
  const entries: TabletEntry[] = parsed.lines.map((line, index) => {
    const type = selection.productType;
    const condition = line.listedCondition ?? selection.condition;
    const reasons = [...line.problems];
    const notes = [...line.notes];
    let pta: TabletPta | null = null;
    if (!type) reasons.push("Choose iPad, Tablet or MacBook for this list");
    else {
      reasons.push(...typeProblems(type, line));
      const read = ptaFor(type, line, selection);
      pta = read.pta;
      reasons.push(...read.reasons);
    }
    if (!condition) reasons.push("Choose New or Used for this list (or write it on the line)");

    let color = line.colorWritten;
    let colorDecision: TabletEntry["colorDecision"] = null;
    if (line.colorWritten && !line.colorKnown) {
      const chosen = decisions.colors[line.lineKey];
      if (chosen?.trim()) {
        color = normalizeColor(chosen).color;
        notes.push(`Colour “${line.colorWritten}” kept as written (your decision)`);
      } else {
        colorDecision = { written: line.colorWritten };
        reasons.push(`“${line.colorWritten}” is not a known colour — check the spelling`);
      }
    }

    return {
      id: `line-${line.lineNumber}-${index}`,
      kind: reasons.length ? "attention" : "same",
      line,
      productType: type,
      productTitle: line.baseTitle && condition ? titleFor(line.baseTitle, condition) : null,
      productKey: null,
      productId: null,
      condition,
      pta,
      ram: line.ram,
      storage: line.storage,
      color,
      priceMinor: line.priceMinor,
      variantId: null,
      sku: null,
      currentPriceMinor: null,
      stock: null,
      reasons,
      notes,
      colorDecision,
      confirmNewProduct: null,
    };
  });

  for (const entry of entries) {
    if (!entry.productTitle || !entry.condition || !entry.productType) continue;
    const category = TYPE_CATEGORY[entry.productType];
    const key = identityKey(entry.productTitle);
    const matches = catalog.filter((product) => identityKey(product.title) === key);
    if (matches.length > 1) {
      entry.productKey = `title:${key}`;
      entry.reasons.push(`More than one product on the website is named “${entry.productTitle}”`);
      continue;
    }
    if (matches.length === 0) {
      entry.productKey = `new:${key}`;
      continue;
    }
    const product = matches[0];
    entry.productKey = product.id;
    entry.productId = product.id;
    if (lower(product.categorySlug) !== category.slug) {
      entry.reasons.push(`“${product.title}” is not in ${category.name} on the website; this update never touches it`);
      continue;
    }
    if (category.slug === "laptops" && !isApple(product.brand)) {
      entry.reasons.push(`“${product.title}” is not an Apple product; only Apple MacBooks are updated`);
      continue;
    }
    if (isUsedTitle(product.title) !== (entry.condition === "used")) {
      entry.reasons.push(`“${product.title}” does not follow the ${CONDITION_LABEL[entry.condition]} title rule`);
      continue;
    }
    if (!product.variants.length) {
      entry.reasons.push(`“${product.title}” has no variants on the website, so New / Used cannot be confirmed; add its first variant in Admin`);
      continue;
    }
    const otherCondition = product.variants.filter((variant) => variant.condition !== entry.condition);
    if (otherCondition.length) {
      entry.reasons.push(`“${product.title}” on the website has ${otherCondition.length} variant(s) that are not ${CONDITION_LABEL[entry.condition]} (${otherCondition.map((variant) => variant.sku).join(", ")}); it is never updated by a ${CONDITION_LABEL[entry.condition]} list`);
      continue;
    }
    if (entry.reasons.length || !entry.storage || entry.priceMinor === null || !entry.pta) continue;

    const sameCore = product.variants.filter((variant) => factKey(variant.storage) === factKey(entry.storage) && variant.ptaStatus === entry.pta && variant.condition === entry.condition);
    const exact = sameCore.filter((variant) => factKey(variant.ram) === factKey(entry.ram) && factKey(variant.color) === factKey(entry.color) && !hasUnitFacts(variant));
    if (exact.length > 1) {
      entry.reasons.push(`More than one website variant matches this line (${exact.map((variant) => variant.sku).join(", ")})`);
      continue;
    }
    if (exact.length === 0) {
      // A website variant that differs only by a fact one side leaves blank (RAM, colour) or by unit details is unclear.
      const unclear = sameCore.filter(
        (variant) =>
          (factKey(variant.ram) === null) !== (entry.ram === null) ||
          (factKey(variant.color) === null) !== (entry.color === null) ||
          (factKey(variant.ram) === factKey(entry.ram) && factKey(variant.color) === factKey(entry.color) && hasUnitFacts(variant)),
      );
      if (unclear.length) {
        entry.reasons.push(`Website variant ${unclear.map((variant) => variant.sku).join(", ")} may be the same item but its RAM / colour / unit details differ from this line; update it by hand`);
        continue;
      }
      entry.kind = "new_variant";
      continue;
    }
    const variant = exact[0];
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

  // New products: confirm when the same model already exists under the other title, or a title is one letter away.
  for (const entry of entries) {
    if (!entry.productKey?.startsWith("new:") || !entry.productTitle || !entry.productType) continue;
    const category = TYPE_CATEGORY[entry.productType];
    const base = baseOf(entry.productTitle);
    const lookalikes = catalog
      .filter((product) => lower(product.categorySlug) === category.slug)
      .filter((product) => {
        const other = baseOf(product.title);
        if (identityKey(product.title) === identityKey(entry.productTitle as string)) return false;
        if (identityKey(other) === identityKey(base)) return true;
        return digitsOf(other) === digitsOf(base) && distance(identityKey(other), identityKey(base)) <= 2;
      })
      .map((product) => product.title);
    if (lookalikes.length && !decisions.newProducts[identityKey(entry.productTitle)]) {
      entry.confirmNewProduct = lookalikes;
      entry.reasons.push(`A similar product is already on the website (${lookalikes.join(", ")}); confirm that “${entry.productTitle}” is a new, separate product`);
    } else if (lookalikes.length) {
      entry.notes.push(`Confirmed as a new product (separate from ${lookalikes.join(", ")})`);
    }
    if (!entry.reasons.length) entry.kind = "new_product";
  }

  // The same variant twice in one list: every copy waits for the Owner.
  const groups = new Map<string, TabletEntry[]>();
  for (const entry of entries) {
    if (!entry.productKey || !entry.storage || !entry.pta) continue;
    const key = [entry.productKey, factKey(entry.ram), factKey(entry.storage), factKey(entry.color), entry.pta].join("|");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const lines = group.map((entry) => entry.line.lineNumber).join(", ");
    for (const entry of group) entry.reasons.push(`The same variant is listed more than once (lines ${lines})`);
  }

  for (const entry of entries) if (entry.reasons.length) entry.kind = "attention";

  const counts = { same: 0, price_change: 0, show_again: 0, new_variant: 0, new_product: 0, attention: 0, lines: entries.length, unread: parsed.unread.length };
  for (const entry of entries) counts[entry.kind] += 1;
  return { entries, unread: parsed.unread, counts };
}

// ---------------------------------------------------------------------------
// Per-product plan
// ---------------------------------------------------------------------------

/** One step as apply_tablet_stock_product reads it (see migration 202610270001). */
export type TabletRpcStep =
  | { kind: "price"; variant_id: string; from_minor: number; to_minor: number }
  | { kind: "show"; variant_id: string; from_minor: number; to_minor: number }
  | { kind: "add_variant"; ram: string | null; storage: string; color: string | null; price_minor: number; stock: number; pta_status: TabletPta; condition: TabletCondition };

export type TabletRpcPayload = {
  product_id: string;
  condition: TabletCondition;
  expected: { variants: { id: string; price_minor: number; is_active: boolean }[] };
  steps: TabletRpcStep[];
};

/** One new product for apply_catalog_bulk_import_v2 (action "Create" only; created as a draft). */
export type TabletNewProductPayload = {
  source: string;
  action: "Create";
  product_type: "Tablet" | "Laptop";
  brand: string;
  category: "Tablets" | "Laptops";
  title: string;
  variants: {
    source: string;
    ram: string | null;
    storage: string;
    color: string | null;
    price_minor: number;
    stock: number;
    pta_status: TabletPta;
    condition: TabletCondition;
    condition_grade: null;
    battery_health_percent: null;
    battery_cycle_count: null;
    sim_configuration: null;
    warranty: null;
    delivery_scope: "karachi_only";
  }[];
};

export type TabletProductUpdate =
  | { kind: "existing"; key: string; productId: string; productTitle: string; categorySlug: "tablets" | "laptops"; entries: TabletEntry[]; payload: TabletRpcPayload }
  | { kind: "new"; key: string; productId: null; productTitle: string; categorySlug: "tablets" | "laptops"; entries: TabletEntry[]; payload: TabletNewProductPayload };

export type TabletHeldProduct = { key: string; productTitle: string; reasons: string[]; lines: number[] };

export type TabletPlan = {
  products: TabletProductUpdate[];
  held: TabletHeldProduct[];
  changeCount: number;
  counts: { priceUpdates: number; shownAgain: number; newVariants: number; newProducts: number; newProductVariants: number; same: number; heldProducts: number };
};

const WRITING_KINDS = new Set<TabletEntryKind>(["price_change", "show_again", "new_variant", "new_product"]);

export const variantLabel = (entry: Pick<TabletEntry, "ram" | "storage" | "color">) => [entry.ram && entry.storage ? `${entry.ram} / ${entry.storage}` : entry.storage, entry.color].filter(Boolean).join(" ") || "—";

/**
 * Groups the comparison by product. A product with ANY line that needs attention is held whole (nothing written).
 * Every other product becomes ONE all-or-nothing database call. Lines that are the same need no write.
 */
export function buildTabletPlan(comparison: TabletComparison, catalog: readonly CatalogDeltaProduct[]): TabletPlan {
  const byId = new Map(catalog.map((product) => [product.id, product] as const));
  const byProduct = new Map<string, TabletEntry[]>();
  const held = new Map<string, TabletHeldProduct>();
  for (const entry of comparison.entries) {
    if (!entry.productKey) {
      const key = `line:${entry.line.lineNumber}:${entry.id}`;
      held.set(key, { key, productTitle: entry.line.baseTitle ?? entry.line.sourceLine, reasons: [...entry.reasons], lines: [entry.line.lineNumber] });
      continue;
    }
    byProduct.set(entry.productKey, [...(byProduct.get(entry.productKey) ?? []), entry]);
  }

  const products: TabletProductUpdate[] = [];
  for (const [key, entries] of byProduct) {
    const title = entries[0].productTitle ?? "";
    const problems = entries.filter((entry) => entry.kind === "attention");
    if (problems.length) {
      held.set(key, { key, productTitle: title, reasons: [...new Set(problems.flatMap((entry) => entry.reasons.map((reason) => `Line ${entry.line.lineNumber}: ${reason}`)))], lines: problems.map((entry) => entry.line.lineNumber) });
      continue;
    }
    const writing = entries.filter((entry) => WRITING_KINDS.has(entry.kind));
    if (!writing.length) continue;
    const condition = entries[0].condition as TabletCondition;
    const category = TYPE_CATEGORY[entries[0].productType as TabletProductType];
    if (key.startsWith("new:")) {
      products.push({
        kind: "new",
        key,
        productId: null,
        productTitle: title,
        categorySlug: category.slug,
        entries: writing,
        payload: {
          source: `Tablets & MacBooks Stock Update: ${title}`,
          action: "Create",
          product_type: category.productType,
          brand: entries[0].line.brand as string,
          category: category.name,
          title,
          variants: writing.map((entry) => ({
            source: `Line ${entry.line.lineNumber}: ${variantLabel(entry)}`,
            ram: entry.ram,
            storage: entry.storage as string,
            color: entry.color,
            price_minor: entry.priceMinor as number,
            stock: TABLET_NEW_VARIANT_STOCK,
            pta_status: entry.pta as TabletPta,
            condition,
            condition_grade: null,
            battery_health_percent: null,
            battery_cycle_count: null,
            sim_configuration: null,
            warranty: null,
            delivery_scope: "karachi_only",
          })),
        },
      });
      continue;
    }
    const product = byId.get(key);
    if (!product) continue;
    const steps: TabletRpcStep[] = writing.map((entry) => {
      if (entry.kind === "price_change") return { kind: "price", variant_id: entry.variantId as string, from_minor: entry.currentPriceMinor as number, to_minor: entry.priceMinor as number };
      if (entry.kind === "show_again") return { kind: "show", variant_id: entry.variantId as string, from_minor: entry.currentPriceMinor as number, to_minor: entry.priceMinor as number };
      return { kind: "add_variant", ram: entry.ram, storage: entry.storage as string, color: entry.color, price_minor: entry.priceMinor as number, stock: TABLET_NEW_VARIANT_STOCK, pta_status: entry.pta as TabletPta, condition };
    });
    products.push({
      kind: "existing",
      key,
      productId: product.id,
      productTitle: product.title,
      categorySlug: category.slug,
      entries: writing,
      payload: {
        product_id: product.id,
        condition,
        expected: { variants: product.variants.map((variant) => ({ id: variant.id, price_minor: variant.priceMinor, is_active: variant.isActive })) },
        steps,
      },
    });
  }

  const written = products.flatMap((product) => product.entries);
  const count = (kind: TabletEntryKind) => written.filter((entry) => entry.kind === kind).length;
  const heldList = [...held.values()];
  return {
    products,
    held: heldList,
    changeCount: written.length,
    counts: {
      priceUpdates: count("price_change"),
      shownAgain: count("show_again"),
      newVariants: count("new_variant"),
      newProducts: products.filter((product) => product.kind === "new").length,
      newProductVariants: count("new_product"),
      same: comparison.entries.filter((entry) => entry.kind === "same").length,
      heldProducts: heldList.length,
    },
  };
}

/** Fingerprint of everything Check Changes looked at (list text, choices, decisions): Update Website needs a fresh check. */
export function checkFingerprint(text: string, selection: TabletSelection, decisions: TabletDecisions): string {
  const source = JSON.stringify([text.replace(/\r\n?/g, "\n"), selection.productType, selection.condition, selection.connectivity, Object.entries(decisions.colors).sort(), Object.keys(decisions.newProducts).sort()]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${source.length}:${hash.toString(16).padStart(8, "0")}`;
}
