import { normalizeCapacity } from "./bulkCatalog.ts";
import { normalizeColor } from "./catalogColors.ts";
import { parsePkrMajorToMinor } from "./money.ts";

// Bulk Upload v2 — Phase 1A. The fixed catalog sheet row contract shared by the
// rough-stock normalizer and (later) the Excel writer/reader. Pure functions only:
// nothing here reads from or writes to the database.

export type FieldStatus =
  | "explicit" // supplied in the source line
  | "inferred" // derived deterministically (brand family, product type, title, slug)
  | "default" // an Owner-locked default (Stock = 10, Used => A++)
  | "blank" // not supplied; stays blank, never guessed
  | "needs_review"; // unknown, ambiguous or conflicting

export type CatalogAction = "Create" | "Replace Existing";
export type CatalogProductType = "Mobile Phone" | "Accessory" | "Gadget" | "Tablet" | "Laptop";
export type CatalogPtaStatus = "approved" | "not_approved" | "not_applicable";
export type CatalogCondition = "brand_new" | "used" | "open_box" | "refurbished";
export type CatalogConditionGrade = "A++";
export type CatalogDeliveryScope = "karachi_only" | "nationwide";

export type CatalogSheetRow = {
  lineNumber: number;
  sourceLine: string;
  action: CatalogAction | null;
  productType: CatalogProductType | null;
  brand: string | null;
  model: string | null;
  productTitle: string | null;
  ram: string | null;
  storage: string | null;
  color: string | null;
  ptaStatus: CatalogPtaStatus | null;
  condition: CatalogCondition | null;
  conditionGrade: CatalogConditionGrade | null;
  batteryHealth: number | null;
  cycleCount: number | null;
  warranty: string | null;
  deliveryScope: CatalogDeliveryScope | null;
  priceMinor: number | null;
  compareAtPriceMinor: number | null;
  stock: number;
  sku: string | null;
  category: string | null;
  slug: string | null;
  notes: string[];
  fieldStatus: Record<CatalogField, FieldStatus>;
  needsReview: boolean;
  reviewReasons: string[];
};

export type CatalogField =
  | "action" | "productType" | "brand" | "model" | "productTitle"
  | "ram" | "storage" | "color" | "ptaStatus" | "condition" | "conditionGrade"
  | "batteryHealth" | "cycleCount" | "warranty" | "deliveryScope"
  | "priceMinor" | "compareAtPriceMinor" | "stock" | "sku" | "category" | "slug" | "notes";

/** Active brand names (plus optional aliases) supplied by the caller, e.g. from the brands table. */
export type BrandReference = { name: string; aliases?: string[] };

export type NormalizeStockOptions = { brands: BrandReference[] };

export type NormalizeStockResult = { rows: CatalogSheetRow[]; summary: NormalizeStockSummary };

export const DEFAULT_IMPORT_STOCK = 10;
const USED_CONDITION_GRADE: CatalogConditionGrade = "A++";
const MIN_PLAUSIBLE_PRICE_MINOR = 10_000; // Rs 100

// Model families that identify a brand without the brand being written. Only used
// when that brand is present in the supplied active-brand list; never creates brands.
const MODEL_FAMILY_BRANDS: Record<string, string> = {
  galaxy: "Samsung",
  redmi: "Xiaomi",
  poco: "Xiaomi",
  iphone: "Apple",
  ipad: "Apple",
  macbook: "Apple",
  airpods: "Apple",
  pixel: "Google",
};

// Canonical display casing for model-family and common suffix words.
const CANONICAL_MODEL_WORDS: Record<string, string> = {
  iphone: "iPhone",
  ipad: "iPad",
  macbook: "MacBook",
  airpods: "AirPods",
  galaxy: "Galaxy",
  redmi: "Redmi",
  poco: "Poco",
  pixel: "Pixel",
  se: "SE",
  fe: "FE",
  xl: "XL",
  "4g": "4G",
  "5g": "5G",
  wifi: "WiFi",
  lte: "LTE",
  gt: "GT",
  hmd: "HMD",
  nfc: "NFC",
};

// Known model suffix words written glued to a model code ("14pro", "15pro+", "A7pro",
// "V80lite", "S10FE"). Only these words are split off; no other boundaries are invented.
const GLUED_MODEL_SUFFIX = /^([a-z]*\d+[a-z]?)(pro|max|plus|ultra|lite|mini|neo|prime|fe)(\+*)$/i;

// Display casing only; identity (slug/SKU) is always derived case-insensitively.
// Known words and acronyms use their canonical form; letter-led model codes get an
// upper-case series letter while trailing letters stay as written (a16 -> A16,
// Y05e, X5c+); plain all-lower/all-upper words get an initial capital; any other
// deliberate mixed casing (e.g. "OnePlus", "X9D", "17T") is kept as written.
function canonicalModel(model: string) {
  return collapse(model)
    .split(" ")
    .flatMap((word) => {
      const glued = word.match(GLUED_MODEL_SUFFIX);
      return glued ? [glued[1], `${glued[2]}${glued[3]}`] : [word];
    })
    .map((word) => {
      const known = CANONICAL_MODEL_WORDS[word.toLowerCase()];
      if (known) return known;
      if (/^[a-z]+\d+[a-z]*\+*$/i.test(word)) return word.replace(/^[a-z]+/i, (letters) => letters.toUpperCase());
      if (/^[a-z]+\+*$/i.test(word) && (word === word.toLowerCase() || word === word.toUpperCase()))
        return word[0].toUpperCase() + word.slice(1).toLowerCase();
      return word;
    })
    .join(" ");
}

// Storage sizes accepted for a bare number (e.g. "iPhone 15 Pro 256 Natural").
const BARE_STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512]);

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");
const lower = (value: string) => collapse(value).toLowerCase();
// "+" is part of model identity (Note 15 Pro+ is not Note 15 Pro), so it becomes "-plus".
export const catalogSlug = (value: string) =>
  lower(value).replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (value: string) =>
  collapse(value).replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
const DECIMAL_DIGIT = /\p{Nd}/u;

/**
 * Maps every Unicode decimal digit (mathematical bold/double-struck/sans-serif/monospace,
 * fullwidth, Arabic-Indic, Devanagari, ...) to ASCII 0-9. Unicode encodes each digit set
 * as a contiguous 0..9 run (the mathematical sets are five runs back to back), so a
 * digit's value is its offset from the start of its run, modulo 10.
 */
export function normalizeDigits(value: string) {
  return value.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0)!;
    if (code >= 0x30 && code <= 0x39) return digit;
    let start = code;
    while (DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

const normalizeText = (value: string) =>
  normalizeDigits(value.normalize("NFKC"))
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\uff0f\u2044]/g, "/")
    .replace(/[\u2013\u2014]/g, "-");

// Emoji, pictographs, decorative symbols (\u2728 \u25aa\ufe0f \u2501 \ud83d\udd35), joiners and variation selectors.
const EMOJI_DECORATION = /(?:[\p{Extended_Pictographic}\p{So}]|\u200d|\ufe0f|\u20e3)+/gu;
const stripEmoji = (value: string) => collapse(value.replace(EMOJI_DECORATION, " "));
// Heading-only decoration additionally drops bullets and ASCII ornaments.
const stripHeadingDecoration = (value: string) =>
  stripEmoji(value.replace(/[\u2022\u00b7*~_=#|>]+/g, " ")).replace(/^[\s\-:.]+|[\s\-:.]+$/g, "");

function emptyStatus(): Record<CatalogField, FieldStatus> {
  return {
    action: "blank", productType: "blank", brand: "blank", model: "blank", productTitle: "blank",
    ram: "blank", storage: "blank", color: "blank", ptaStatus: "blank", condition: "blank",
    conditionGrade: "blank", batteryHealth: "blank", cycleCount: "blank", warranty: "blank",
    deliveryScope: "blank", priceMinor: "blank", compareAtPriceMinor: "blank", stock: "blank",
    sku: "blank", category: "blank", slug: "blank", notes: "blank",
  };
}

/** Parses a PKR major-unit price ("42,500", "Rs 42500", "42.5k") into minor units. */
export function parseCatalogPrice(token: string): number | null {
  const match = token.trim().match(/^(?:rs\.?|pkr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?$/i);
  if (!match) return null;
  try {
    const minor = parsePkrMajorToMinor(match[1].replaceAll(",", ""));
    return match[2] ? minor * 1000 : minor;
  } catch {
    return null;
  }
}

export type PriceText = {
  priceMinor: number | null;
  /** More than one price-like number: the price-to-colour mapping is not guessed. */
  ambiguous: boolean;
  /** Anything besides the price (dates, words), kept verbatim for review. */
  leftover: string | null;
};

const PRICE_NUMBER = /(?:(?:rs\.?|pkr)\s*)?(\d[\d,]*(?:\.\d+)?)(k)?(?![\d])/gi;
const DATE_TEXT = /\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g;

/**
 * Reads a wholesale price segment: "35800/-", "Rs 35800", "110000 active 25-04-26/-",
 * "176500/178500wht". Dates are never read as prices, and two or more price-like
 * numbers are reported as ambiguous instead of picking one.
 */
export function parsePriceText(value: string): PriceText {
  const text = collapse(value.replace(/\/\s*[-=]\s*$/, ""));
  const simple = parseCatalogPrice(text);
  if (simple !== null) return { priceMinor: simple, ambiguous: false, leftover: null };
  const withoutDates = text.replace(DATE_TEXT, " ");
  const candidates = [...withoutDates.matchAll(PRICE_NUMBER)].filter(
    (match) => match[1].replaceAll(",", "").split(".")[0].length >= 3,
  );
  if (candidates.length !== 1) return { priceMinor: null, ambiguous: candidates.length > 1, leftover: text || null };
  const priceMinor = parseCatalogPrice(candidates[0][0]);
  const rest = collapse(text.replace(candidates[0][0], " ").replace(/\/\s*[-=]/g, " ").replace(/^[\s/,-]+|[\s/,-]+$/g, ""));
  return { priceMinor, ambiguous: false, leftover: rest || null };
}

type BrandMatch ={ brand: string; rest: string; status: "explicit" | "inferred" } | { ambiguous: string[] } | null;

function matchBrand(text: string, brands: BrandReference[]): BrandMatch {
  const value = lower(text);
  const labels = brands.flatMap((brand) =>
    [brand.name, ...(brand.aliases ?? [])].map((label) => ({ label: lower(label), brand: brand.name })),
  );
  const prefixed = labels.filter(({ label }) => value === label || value.startsWith(`${label} `));
  if (prefixed.length) {
    const longest = Math.max(...prefixed.map(({ label }) => label.length));
    const winners = [...new Set(prefixed.filter(({ label }) => label.length === longest).map(({ brand }) => brand))];
    if (winners.length > 1) return { ambiguous: winners };
    return { brand: winners[0], rest: collapse(text).slice(longest).trim(), status: "explicit" };
  }
  const family = MODEL_FAMILY_BRANDS[value.split(" ")[0]];
  const known = family ? brands.find((brand) => lower(brand.name) === lower(family)) : undefined;
  return known ? { brand: known.name, rest: collapse(text), status: "inferred" } : null;
}

type Identity = {
  titleText: string;
  ram: string | null;
  /** RAM written as physical+extended ("3+5"): kept verbatim as RAM "3+5 GB", never summed. */
  ramExpression: string | null;
  storage: string | null;
  colors: string[];
  unknownColors: string[];
  /** Whitespace-separated colour text ("grey green"): kept as one value, never split. */
  multiWordColors: string[];
  /** Screen sizes ("9.7”", '10.1"'): never a colour; preserved in Notes. */
  screenSizes: string[];
};

// Screen size written in the identity ("9.7”", '10.1"', "11 inch").
const SCREEN_SIZE = /(?:^|\s)(\d{1,2}(?:\.\d+)?\s*(?:["“”″]|′′|''|-?\s*inch(?:es)?))(?=\s|$)/gi;

// Splits "Samsung A16 6/128 Black" or "iPhone 15 Pro 256 Natural" into title text,
// RAM/storage and colours. Without a RAM/storage anchor the whole segment is title text.
function splitIdentity(segment: string): Identity {
  const screenSizes = [...segment.matchAll(SCREEN_SIZE)].map((match) => collapse(match[1]));
  return { ...splitIdentityText(collapse(segment.replace(SCREEN_SIZE, " "))), screenSizes };
}

function splitIdentityText(text: string): Omit<Identity, "screenSizes"> {
  const ramStorage = text.match(/(?:^|\s)(\d+(?:\s*\+\s*\d+)?)\s*(?:GB)?\s*\/\s*(\d+)\s*(GB|TB)?(?=\s|$)/i);
  if (ramStorage) {
    const start = (ramStorage.index ?? 0) + (ramStorage[0].startsWith(" ") ? 1 : 0);
    const extended = ramStorage[1].includes("+");
    const ramExpression = extended ? ramStorage[1].replace(/\s+/g, "") : null;
    return {
      titleText: text.slice(0, start).trim(),
      // Extended notation stays distinct ("3+5 GB"), never summed or blanked, so
      // 3+5/64 and 4+4/64 remain different variants.
      ram: ramExpression ? `${ramExpression} GB` : normalizeCapacity(`${ramStorage[1]} GB`),
      ramExpression,
      storage: normalizeCapacity(`${ramStorage[2]} ${ramStorage[3] ?? "GB"}`),
      ...splitColors(text.slice((ramStorage.index ?? 0) + ramStorage[0].length)),
    };
  }
  const tokens = text.split(" ");
  for (let index = tokens.length - 1; index > 0; index -= 1) {
    const storage = tokens[index].match(/^(\d+)\s*(GB|TB)?$/i);
    if (!storage) continue;
    const size = Number(storage[1]);
    if (storage[2] || BARE_STORAGE_SIZES.has(size)) {
      return {
        titleText: tokens.slice(0, index).join(" "),
        ram: null,
        ramExpression: null,
        storage: normalizeCapacity(`${storage[1]} ${storage[2] ?? "GB"}`),
        ...splitColors(tokens.slice(index + 1).join(" ")),
      };
    }
  }
  // No RAM/Storage (feature phones, watches, accessories): only trailing words that are all
  // known colours ("105 black/blue", "Watch 8 Graphite") are read as colours.
  let colorStart = tokens.length;
  while (
    colorStart > 1 &&
    tokens[colorStart - 1].split(/[/,&]/).filter(Boolean).every((part) => normalizeColor(part).known)
  )
    colorStart -= 1;
  if (colorStart < tokens.length)
    return {
      titleText: tokens.slice(0, colorStart).join(" "),
      ram: null,
      ramExpression: null,
      storage: null,
      ...splitColors(tokens.slice(colorStart).join(" ")),
    };
  return { titleText: text, ram: null, ramExpression: null, storage: null, colors: [], unknownColors: [], multiWordColors: [] };
}

// "black/volt/green", "slv, green" or "blue & red" -> one canonical colour per variant.
function splitColors(value: string) {
  const colors: string[] = [];
  const unknownColors: string[] = [];
  const multiWordColors: string[] = [];
  for (const item of value.split(/\s*[/,&]\s*/)) {
    if (!item.trim()) continue;
    const { color, known } = normalizeColor(item);
    if (!colors.includes(color)) colors.push(color);
    if (!known && !unknownColors.includes(color)) unknownColors.push(color);
    if (/\s/.test(color) && !multiWordColors.includes(color)) multiWordColors.push(color);
  }
  return { colors, unknownColors, multiWordColors };
}

// Locked SKU system: the database assigns every new variant SKU when the variant is
// inserted (2-letter prefix + 3-digit per-prefix sequence, e.g. MB001), so simultaneous
// imports can never collide. The client never numbers SKUs; it only shows the expected
// prefix. An existing variant keeps its SKU forever, and SKUs are never used to match variants.
export type CatalogSkuPrefix = "MB" | "AC" | "GD" | "MC" | "IP";

export const CATALOG_SKU_PATTERN = /^(MB|AC|GD|MC|IP)[0-9]{3}$/;

export const CATALOG_SKU_PREFIX_BY_PRODUCT_TYPE: Record<CatalogProductType, CatalogSkuPrefix> = {
  "Mobile Phone": "MB",
  Accessory: "AC",
  Gadget: "GD",
  Laptop: "MC",
  Tablet: "IP",
};

/** Mirrors public.catalog_sku_prefix(): the locked category slug decides the prefix. */
export const CATALOG_SKU_PREFIX_BY_CATEGORY_SLUG: Record<string, CatalogSkuPrefix> = {
  "mobile-phones": "MB",
  "mobile-accessories": "AC",
  gadgets: "GD",
  laptops: "MC",
  tablets: "IP",
};

/** Preview text for a new variant, e.g. "MB — assigned on import". */
export const catalogSkuPending = (prefix: CatalogSkuPrefix) => `${prefix} — assigned on import`;

type Attributes = Pick<
  CatalogSheetRow,
  "ptaStatus" | "condition" | "conditionGrade" | "batteryHealth" | "cycleCount" | "warranty" | "deliveryScope" | "priceMinor"
> & { stock: number | null; gradeExplicit: boolean; notes: string[]; reviewReasons: string[] };

function setOnce<K extends keyof Attributes>(attributes: Attributes, key: K, value: Attributes[K], label: string) {
  const current = attributes[key];
  if (current !== null && current !== value) {
    attributes.reviewReasons.push(`Conflicting ${label} values`);
    return;
  }
  attributes[key] = value;
}

// Recognises one ";"-separated attribute token. Returns false for unknown tokens.
function applyToken(attributes: Attributes, token: string): boolean {
  const value = collapse(token);
  if (/^pta(?:\s*approved)?$/i.test(value)) {
    setOnce(attributes, "ptaStatus", "approved", "PTA");
  } else if (/^non[\s-]?pta$/i.test(value)) {
    setOnce(attributes, "ptaStatus", "not_approved", "PTA");
  } else if (/^(?:brand\s*new|new|box\s*pack(?:ed)?)$/i.test(value)) {
    setOnce(attributes, "condition", "brand_new", "Condition");
  } else if (/^(?:used|a\+\+)$/i.test(value)) {
    setOnce(attributes, "condition", "used", "Condition");
    setOnce(attributes, "conditionGrade", USED_CONDITION_GRADE, "Condition Grade");
    if (/^a\+\+$/i.test(value)) attributes.gradeExplicit = true;
  } else if (/^(?:bh|battery(?:\s*health)?)\s*[:=]?\s*\d{1,3}\s*%?$/i.test(value)) {
    const percent = Number(value.match(/(\d{1,3})\s*%?$/)?.[1]);
    if (percent < 1 || percent > 100) attributes.reviewReasons.push(`Battery Health out of range: ${value}`);
    else setOnce(attributes, "batteryHealth", percent, "Battery Health");
  } else if (/^(?:cycles?|cycle\s*count|cc)\s*[:=]?\s*\d+$/i.test(value)) {
    setOnce(attributes, "cycleCount", Number(value.match(/(\d+)$/)?.[1]), "Cycle Count");
  } else if (/^(?:qty|stock|quantity)\s*[:=]?\s*\d+$/i.test(value)) {
    setOnce(attributes, "stock", Number(value.match(/(\d+)$/)?.[1]), "Stock");
  } else if (/^(?:non|no|without)[\s-]?warranty$/i.test(value)) {
    setOnce(attributes, "warranty", NO_WARRANTY, "Warranty");
  } else if (/^(?:official|officail)\s*warranty$/i.test(value)) {
    setOnce(attributes, "warranty", OFFICIAL_WARRANTY, "Warranty");
  } else if (/^\d+\s*(?:years?|yrs?|months?)\s*(?:official\s*)?warranty$/i.test(value)) {
    setOnce(attributes, "warranty", titleCase(value), "Warranty");
  } else if (/^karachi(?:\s*only)?$/i.test(value)) {
    setOnce(attributes, "deliveryScope", "karachi_only", "Delivery Scope");
  } else if (/^nationwide$/i.test(value)) {
    setOnce(attributes, "deliveryScope", "nationwide", "Delivery Scope");
  } else {
    const price = parsePriceText(value);
    if (price.ambiguous) {
      attributes.notes.push(value);
      attributes.reviewReasons.push(AMBIGUOUS_PRICE);
      return true;
    }
    if (price.priceMinor === null) return false;
    setOnce(attributes, "priceMinor", price.priceMinor, "Price");
    if (price.leftover) {
      attributes.notes.push(price.leftover);
      attributes.reviewReasons.push(`Unrecognised value: ${price.leftover}`);
    }
  }
  return true;
}

const NO_WARRANTY = "No Warranty";
const OFFICIAL_WARRANTY = "Official Warranty";
const EXTENDED_RAM = "RAM uses extended/virtual notation — verify physical RAM";
const AMBIGUOUS_PRICE ="Multiple/ambiguous prices detected; review price-to-color mapping.";
const SUSPICIOUS_PRICE = "Price appears unusually high — verify.";
// Broad ceiling for any single catalog item (Rs 1,500,000); higher prices need review.
const MAX_PLAUSIBLE_PRICE_MINOR = 150_000_000;
// Batch sanity: a price this many times the median of its RAM/Storage peers needs review.
const PEER_PRICE_OUTLIER_FACTOR = 4;
const PEER_PRICE_MIN_PEERS = 4;

// A trailing price written without a ";" or "@" separator: "A07 4/64 Black 35800",
// "... Rs 35800", "... 35800/-". Bare numbers need 5+ digits so model numbers
// ("Nokia 3310") and storage sizes are never taken as prices.
const TRAILING_PRICE = /\s((?:rs\.?|pkr)\s*\d[\d,]*(?:\.\d+)?k?|\d[\d,]*\s*\/\s*[-=]|\d{2}[\d,]{3,})$/i;

/** Section context set by heading and note lines; a new heading resets all of it. */
type SectionContext = {
  brand: string | null;
  /** Product type named by the heading ("Samsung Tab" -> Tablet, "... Watch" -> Gadget). */
  productType: CatalogProductType | null;
  /** Heading word prefixed to models that lack it ("Tab" + "A11 WiFi" -> "Tab A11 WiFi"). */
  qualifier: string | null;
  /** A plain brand heading: storage-less rows (feature phones) are Mobile Phones. */
  phoneSection: boolean;
  warranty: string | null;
};

const LAPTOP_WORDS = /\b(?:macbook|laptop|notebook)\b/i;
const TABLET_WORDS = /\b(?:ipad|tab|tablet|pad)\b/i;
const WATCH_WORDS = /\b(?:watch|smartwatch)\b/i;
const GIFT_BOX_WORDS = /\bgift\s*box\b/i;
// Storage-less accessories are never inferred as feature phones from a brand section.
const ACCESSORY_WORDS =
  /\b(?:buds|earbuds|airpods|charger|cable|adapter|power\s*bank|powerbank|case|cover|protector|speaker|headphones?|earphones?|handsfree|band|strap|gift)\b/i;

function normalizeLine(line: string, lineNumber: number, brands: BrandReference[], context: SectionContext): CatalogSheetRow[] {
  let [first, ...rest] = stripEmoji(line).split(/\s*[;@]\s*/);
  const attributes: Attributes = {
    ptaStatus: null, condition: null, conditionGrade: null, batteryHealth: null, cycleCount: null,
    warranty: null, deliveryScope: null, priceMinor: null, stock: null, gradeExplicit: false, notes: [], reviewReasons: [],
  };
  if (!rest.length) {
    // No separator: accept a clearly price-shaped trailing value ("... Black 35800", "... Rs 35800").
    const trailing = first.match(TRAILING_PRICE);
    if (trailing) {
      rest = [trailing[1]];
      first = first.slice(0, trailing.index);
    }
  }
  // PTA / Used words written inside the identity segment are unambiguous; lift them out.
  let identityText = first;
  for (const [pattern, token] of [
    [/\bnon[\s-]?pta\b/i, "Non-PTA"],
    [/\bpta\s+approved\b/i, "PTA Approved"],
    [/\bused\b/i, "Used"],
  ] as const) {
    if (pattern.test(identityText)) {
      identityText = identityText.replace(pattern, " ");
      applyToken(attributes, token);
    }
  }
  if (!rest.length) attributes.reviewReasons.push("Missing ';' separator before price");
  for (const token of rest) {
    if (!token.trim()) continue;
    if (!applyToken(attributes, token)) {
      attributes.notes.push(collapse(token));
      attributes.reviewReasons.push(`Unrecognised value: ${collapse(token)}`);
    }
  }
  if (attributes.priceMinor === null) {
    if (!attributes.reviewReasons.includes(AMBIGUOUS_PRICE)) attributes.reviewReasons.push("Price missing");
  } else if (attributes.priceMinor < MIN_PLAUSIBLE_PRICE_MINOR) attributes.reviewReasons.push("Price looks too low (below Rs 100)");
  else if (attributes.priceMinor > MAX_PLAUSIBLE_PRICE_MINOR) attributes.reviewReasons.push(SUSPICIOUS_PRICE);
  // Section note ("Non Warranty") applies only when the row does not state its own warranty.
  const warrantyInherited = attributes.warranty === null && context.warranty !== null;
  if (warrantyInherited) attributes.warranty = context.warranty;

  const identity = splitIdentity(identityText);
  if (identity.ramExpression) attributes.reviewReasons.push(EXTENDED_RAM);
  // Colour issues belong to that colour's variant only (see colorReasons below), never
  // to sibling colours expanded from the same line.
  const colorReasons = (color: string | null) => {
    const reasons: string[] = [];
    if (color === null) return reasons;
    if (identity.unknownColors.includes(color)) reasons.push(`Colour "${color}" not recognised — verify`);
    if (identity.multiWordColors.includes(color)) reasons.push(`Multi-word colour value "${color}" — verify`);
    return reasons;
  };
  for (const size of identity.screenSizes) attributes.notes.push(`Screen size as listed: ${size}`);
  const match = matchBrand(identity.titleText, brands);
  let brand: string | null = null;
  let brandStatus: FieldStatus = "needs_review";
  let model = identity.titleText;
  if (match && "ambiguous" in match) {
    attributes.reviewReasons.push(`Ambiguous brand: ${match.ambiguous.join(" / ")}`);
  } else if (match) {
    brand = match.brand;
    brandStatus = match.status;
    model = match.rest;
  } else if (context.brand) {
    brand = context.brand;
    brandStatus = "explicit";
  } else {
    attributes.reviewReasons.push("Brand not recognised");
  }
  model = canonicalModel(model);
  if (!model) attributes.reviewReasons.push("Model missing");

  // The row's own words decide first (laptops before tablets: a MacBook line also carries
  // a storage size), then the section heading, then a RAM/Storage configuration.
  let productType: CatalogProductType | null = null;
  if (LAPTOP_WORDS.test(model)) productType = "Laptop";
  else if (TABLET_WORDS.test(model)) productType = "Tablet";
  else if (WATCH_WORDS.test(model)) productType = "Gadget";
  else if (GIFT_BOX_WORDS.test(model))
    attributes.reviewReasons.push("Gift Box: no Product Type rule — set Product Type manually");
  else if (ACCESSORY_WORDS.test(model)) productType = null;
  else if (context.productType) {
    productType = context.productType;
    if (model && context.qualifier) model = `${context.qualifier} ${model}`;
  } else if (identity.storage || context.phoneSection) productType = "Mobile Phone";
  let deliveryScope = attributes.deliveryScope;
  let deliveryStatus: FieldStatus = deliveryScope ? "explicit" : "blank";
  if (productType === "Mobile Phone") {
    // Locked business rule: mobile phones deliver in Karachi only.
    if (deliveryScope === "nationwide") {
      attributes.reviewReasons.push("Mobile phones are Karachi-only; Nationwide conflicts");
      deliveryStatus = "needs_review";
    } else if (!deliveryScope) {
      deliveryScope = "karachi_only";
      deliveryStatus = "inferred";
    }
  }

  const productTitle = model ? (brand ? `${brand} ${model}` : model) : null;
  const slug = productTitle ? catalogSlug(productTitle) || null : null;
  const colors = identity.colors.length ? identity.colors : [null];
  const reviewReasons = [...new Set(attributes.reviewReasons)];
  return colors.map((color) => {
    const variantReasons = [...reviewReasons, ...colorReasons(color)];
    const fieldStatus = emptyStatus();
    const explicitIf = (value: unknown): FieldStatus => (value === null ? "blank" : "explicit");
    fieldStatus.productType = productType ? "inferred" : "blank";
    fieldStatus.brand = brandStatus;
    fieldStatus.model = model ? "explicit" : "needs_review";
    fieldStatus.productTitle = brand && model ? "inferred" : "needs_review";
    fieldStatus.slug = brand && model ? "inferred" : "needs_review";
    fieldStatus.ram = identity.ramExpression ? "needs_review" : explicitIf(identity.ram);
    fieldStatus.storage = explicitIf(identity.storage);
    fieldStatus.color = colorReasons(color).length ? "needs_review" : explicitIf(color);
    fieldStatus.ptaStatus = explicitIf(attributes.ptaStatus);
    fieldStatus.condition = explicitIf(attributes.condition);
    fieldStatus.conditionGrade = !attributes.conditionGrade ? "blank" : attributes.gradeExplicit ? "explicit" : "default";
    fieldStatus.batteryHealth = explicitIf(attributes.batteryHealth);
    fieldStatus.cycleCount = explicitIf(attributes.cycleCount);
    fieldStatus.warranty = warrantyInherited ? "inferred" : explicitIf(attributes.warranty);
    fieldStatus.deliveryScope = deliveryStatus;
    fieldStatus.priceMinor =
      attributes.priceMinor === null || reviewReasons.includes(SUSPICIOUS_PRICE) ? "needs_review" : "explicit";
    fieldStatus.stock = attributes.stock === null ? "default" : "explicit";
    fieldStatus.notes = attributes.notes.length || identity.ramExpression ? "needs_review" : "blank";
    const row: CatalogSheetRow = {
      lineNumber,
      sourceLine: line,
      action: null,
      productType,
      brand,
      model: model || null,
      productTitle,
      ram: identity.ram,
      storage: identity.storage,
      color,
      ptaStatus: attributes.ptaStatus,
      condition: attributes.condition,
      conditionGrade: attributes.conditionGrade,
      batteryHealth: attributes.batteryHealth,
      cycleCount: attributes.cycleCount,
      warranty: attributes.warranty,
      deliveryScope,
      priceMinor: attributes.priceMinor,
      compareAtPriceMinor: null,
      stock: attributes.stock ?? DEFAULT_IMPORT_STOCK,
      sku: null,
      category: null,
      slug,
      notes: identity.ramExpression ? [...attributes.notes, `RAM as listed: ${identity.ramExpression}`] : [...attributes.notes],
      fieldStatus,
      needsReview: variantReasons.length > 0,
      reviewReasons: variantReasons,
    };
    return row;
  });
}

/** Variant identity within one product: the same fields that distinguish catalog variants. */
export function catalogVariantKey(row: CatalogSheetRow) {
  return [row.slug, row.ram, row.storage, row.color, row.ptaStatus, row.condition, row.conditionGrade, row.batteryHealth, row.cycleCount]
    .map((value) => (value === null ? "" : String(value).toLowerCase()))
    .join("|");
}

// Heading brand aliases for wholesale list headings ("Mi Xiaomi" -> Xiaomi).
const HEADING_BRAND_ALIASES: Record<string, string> = {
  "mi xiaomi": "Xiaomi",
  "xiaomi mi": "Xiaomi",
  mi: "Xiaomi",
};

// Heading words that describe the section, not the brand.
const HEADING_QUALIFIERS: Record<string, { productType: CatalogProductType | null; qualifier: string | null }> = {
  tab: { productType: "Tablet", qualifier: "Tab" },
  tabs: { productType: "Tablet", qualifier: "Tab" },
  tablet: { productType: "Tablet", qualifier: "Tab" },
  tablets: { productType: "Tablet", qualifier: "Tab" },
  pad: { productType: "Tablet", qualifier: "Pad" },
  pads: { productType: "Tablet", qualifier: "Pad" },
  watch: { productType: "Gadget", qualifier: "Watch" },
  watches: { productType: "Gadget", qualifier: "Watch" },
  flagship: { productType: null, qualifier: null },
  flagships: { productType: null, qualifier: null },
  series: { productType: null, qualifier: null },
};

type Heading = { context: SectionContext; knownBrand: boolean };

// "🔵 ✨ Samsung ✨" / "Samsung Tab" / "MI Xiaomi Pad" -> section context. Brands are
// matched against the supplied active brands only; an unknown heading brand is kept as
// written so validation flags it (brands are never created).
function parseHeading(text: string, brands: BrandReference[]): Heading {
  let productType: CatalogProductType | null = null;
  let qualifier: string | null = null;
  const brandWords: string[] = [];
  for (const word of text.split(" ")) {
    const known = HEADING_QUALIFIERS[word.toLowerCase()];
    if (known) {
      productType = known.productType ?? productType;
      qualifier = known.qualifier ?? qualifier;
    } else brandWords.push(word);
  }
  const brandText = brandWords.join(" ");
  const alias = HEADING_BRAND_ALIASES[lower(brandText)] ?? brandText;
  const active = brands.find((brand) =>
    [brand.name, ...(brand.aliases ?? [])].some((label) => lower(label) === lower(alias)),
  );
  return {
    knownBrand: Boolean(active),
    context: {
      brand: active?.name ?? (alias ? titleCase(alias) : null),
      productType,
      qualifier,
      phoneSection: Boolean(alias) && productType === null,
      warranty: null,
    },
  };
}

const WARRANTY_NOTES: Array<[RegExp, string]> = [
  [/^(?:non|no|without)[\s-]?warranty$/i, NO_WARRANTY],
  // Includes the common supplier typo "officail warranty".
  [/^(?:official|officail)\s*warranty$/i, OFFICIAL_WARRANTY],
];

export type NormalizeStockSummary = {
  nonEmptyLines: number;
  headings: number;
  decorativeLines: number;
  contextLines: number;
  productLines: number;
};

/**
 * Normalizes rough stock lines ("Title RAM/Storage Color; Price; Used; Non-PTA; BH 89%; Cycles 312",
 * or WhatsApp wholesale lists: "🔵 ✨ Samsung ✨" / "A07 4/64 black/volt/green @ 𝟑𝟓𝟖𝟎𝟎/-")
 * into fixed catalog sheet rows. SKUs stay blank: new variants get theirs on import.
 * Heading lines set the brand/section for the lines that follow and never become products;
 * separator lines are skipped; "Non Warranty" / "Official Warranty" notes set the section's
 * warranty. Deterministic and side-effect free.
 */
export function normalizeStockLines(text: string, options: NormalizeStockOptions): NormalizeStockResult {
  const rows: CatalogSheetRow[] = [];
  const summary: NormalizeStockSummary = { nonEmptyLines: 0, headings: 0, decorativeLines: 0, contextLines: 0, productLines: 0 };
  let context: SectionContext = { brand: null, productType: null, qualifier: null, phoneSection: false, warranty: null };
  const lines = normalizeText(text).replace(/\r\n?/g, "\n").split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = collapse(raw);
    if (!line) continue;
    summary.nonEmptyLines += 1;
    const stripped = stripHeadingDecoration(line);
    if (!stripped || !/[\p{L}\d]/u.test(stripped)) {
      summary.decorativeLines += 1;
      continue;
    }
    const warranty = WARRANTY_NOTES.find(([pattern]) => pattern.test(stripped));
    if (warranty) {
      context = { ...context, warranty: warranty[1] };
      summary.contextLines += 1;
      continue;
    }
    if (!/[;@\d]/.test(stripped)) {
      const decorated = stripped !== line;
      const heading = parseHeading(stripped, options.brands);
      // Decorated lines are headings; a plain line only when it is exactly a known brand (+ section words).
      if (decorated || heading.knownBrand) {
        context = heading.context;
        summary.headings += 1;
        continue;
      }
    }
    summary.productLines += 1;
    rows.push(...normalizeLine(line, index + 1, options.brands, context));
  }
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = catalogVariantKey(row);
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      row.needsReview = true;
      row.reviewReasons.push(`Duplicate variant (same as line ${firstLine})`);
    } else seen.set(key, row.lineNumber);
  }
  flagPeerPriceOutliers(rows);
  return { rows, summary };
}

// A price far above the batch median for the same RAM/Storage configuration is flagged
// (never corrected), e.g. an extra zero typed into a wholesale list.
function flagPeerPriceOutliers(rows: CatalogSheetRow[]) {
  const groups = new Map<string, number[]>();
  const configKey = (row: CatalogSheetRow) => (row.storage ? `${row.ram ?? ""}|${row.storage}` : null);
  for (const row of rows) {
    const key = configKey(row);
    if (key && row.priceMinor !== null) groups.set(key, [...(groups.get(key) ?? []), row.priceMinor]);
  }
  for (const row of rows) {
    const key = configKey(row);
    const prices = key ? groups.get(key) ?? [] : [];
    if (row.priceMinor === null || prices.length < PEER_PRICE_MIN_PEERS) continue;
    const sorted = [...prices].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (row.priceMinor > median * PEER_PRICE_OUTLIER_FACTOR && !row.reviewReasons.includes(SUSPICIOUS_PRICE)) {
      row.reviewReasons.push(SUSPICIOUS_PRICE);
      row.fieldStatus.priceMinor = "needs_review";
      row.needsReview = true;
    }
  }
}

export type StagingProfileId = "none" | "android_box_pack_pta";

/** Optional, per-batch staging profiles. They only fill blank values and never override a row. */
export const STAGING_PROFILES: Record<Exclude<StagingProfileId, "none">, { label: string; supplies: string[] }> = {
  android_box_pack_pta: {
    label: "Android Box Pack / PTA Approved",
    supplies: ["Product Type: Mobile Phone", "Condition: Brand New", "PTA Status: PTA Approved", "Delivery Scope: Karachi Only"],
  },
};

/**
 * Applies a staging profile to blank fields only; explicit row values always win.
 * Profile-supplied values are marked "default" so they stay visible for review.
 */
export function applyStagingProfile(rows: CatalogSheetRow[], profile: StagingProfileId): CatalogSheetRow[] {
  if (profile === "none") return rows;
  return rows.map((source) => {
    const row: CatalogSheetRow = { ...source, fieldStatus: { ...source.fieldStatus }, reviewReasons: [...source.reviewReasons] };
    const supply = <K extends "productType" | "condition" | "ptaStatus" | "deliveryScope">(field: K, value: CatalogSheetRow[K]) => {
      if (row[field] !== null) return;
      row[field] = value;
      row.fieldStatus[field] = "default";
    };
    supply("productType", "Mobile Phone");
    supply("condition", "brand_new");
    supply("ptaStatus", "approved");
    supply("deliveryScope", "karachi_only");
    return row;
  });
}
