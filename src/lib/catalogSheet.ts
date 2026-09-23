import { normalizeCapacity } from "./bulkCatalog.ts";
import { parsePkrMajorToMinor } from "./money.ts";

// Bulk Upload v2 — Phase 1A. The fixed catalog sheet row contract shared by the
// rough-stock normalizer and (later) the Excel writer/reader. Pure functions only:
// nothing here reads from or writes to the database.

export type FieldStatus =
  | "explicit" // supplied in the source line
  | "inferred" // derived deterministically (brand family, product type, title, slug, SKU)
  | "default" // an Owner-locked default (Stock = 10, Used => A++)
  | "blank" // not supplied; stays blank, never guessed
  | "needs_review"; // unknown, ambiguous or conflicting

export type CatalogAction = "Create" | "Replace Existing";
export type CatalogProductType = "Mobile Phone" | "Tablet" | "Accessory" | "Gadget";
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

export type NormalizeStockResult = { rows: CatalogSheetRow[] };

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
};

// Display casing only; identity (slug/SKU) is always derived case-insensitively.
// Known words use their canonical form, letter-led model codes (a16, s25, x7) are
// upper-cased, plain all-lower/all-upper words get an initial capital, and any
// other deliberate mixed casing (e.g. "OnePlus") is kept as written.
function canonicalModel(model: string) {
  return collapse(model)
    .split(" ")
    .map((word) => {
      const known = CANONICAL_MODEL_WORDS[word.toLowerCase()];
      if (known) return known;
      if (/^[a-z]+\d+[a-z]*$/i.test(word)) return word.toUpperCase();
      if (/^[a-z]+$/i.test(word) && (word === word.toLowerCase() || word === word.toUpperCase()))
        return word[0].toUpperCase() + word.slice(1).toLowerCase();
      return word;
    })
    .join(" ");
}

// Storage sizes accepted for a bare number (e.g. "iPhone 15 Pro 256 Natural").
const BARE_STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512]);

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");
const lower = (value: string) => collapse(value).toLowerCase();
export const catalogSlug = (value: string) =>
  lower(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (value: string) =>
  collapse(value).replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
const normalizeText = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\uff0f\u2044]/g, "/")
    .replace(/[\u2013\u2014]/g, "-");

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

type BrandMatch = { brand: string; rest: string; status: "explicit" | "inferred" } | { ambiguous: string[] } | null;

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
  storage: string | null;
  colors: string[];
};

// Splits "Samsung A16 6/128 Black" or "iPhone 15 Pro 256 Natural" into title text,
// RAM/storage and colours. Without a RAM/storage anchor the whole segment is title text.
function splitIdentity(segment: string): Identity {
  const text = collapse(segment);
  const ramStorage = text.match(/(?:^|\s)(\d+)\s*(?:GB)?\s*\/\s*(\d+)\s*(GB|TB)?(?=\s|$)/i);
  if (ramStorage) {
    const start = (ramStorage.index ?? 0) + (ramStorage[0].startsWith(" ") ? 1 : 0);
    return {
      titleText: text.slice(0, start).trim(),
      ram: normalizeCapacity(`${ramStorage[1]} GB`),
      storage: normalizeCapacity(`${ramStorage[2]} ${ramStorage[3] ?? "GB"}`),
      colors: splitColors(text.slice((ramStorage.index ?? 0) + ramStorage[0].length)),
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
        storage: normalizeCapacity(`${storage[1]} ${storage[2] ?? "GB"}`),
        colors: splitColors(tokens.slice(index + 1).join(" ")),
      };
    }
  }
  return { titleText: text, ram: null, storage: null, colors: [] };
}

function splitColors(value: string) {
  return value
    .split(/\s*[/,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(titleCase);
}

/** Deterministic SKU from slug + variant identity (PTA/condition/BH/CC included). */
export function catalogSkuFor(row: Pick<CatalogSheetRow, "slug" | "ram" | "storage" | "color" | "ptaStatus" | "condition" | "batteryHealth" | "cycleCount">) {
  const capacity = (value: string | null) => {
    const match = value?.match(/^(\d+) (GB|TB)$/);
    if (!match) return null;
    return match[2] === "TB" ? `${match[1]}-TB` : match[1];
  };
  return [
    row.slug,
    capacity(row.ram),
    capacity(row.storage),
    row.color ? catalogSlug(row.color) : null,
    row.ptaStatus === "approved" ? "PTA" : row.ptaStatus === "not_approved" ? "NONPTA" : row.ptaStatus === "not_applicable" ? "NA" : null,
    row.condition === "used" ? "USED" : row.condition === "open_box" ? "OPENBOX" : row.condition === "refurbished" ? "REFURB" : null,
    row.batteryHealth !== null ? `BH${row.batteryHealth}` : null,
    row.cycleCount !== null ? `C${row.cycleCount}` : null,
  ]
    .filter(Boolean)
    .join("-")
    .toUpperCase();
}

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
  } else if (/^(?:\d+\s*(?:years?|yrs?|months?)\s*(?:official\s*)?warranty|non[\s-]?warranty|no\s*warranty)$/i.test(value)) {
    setOnce(attributes, "warranty", titleCase(value), "Warranty");
  } else if (/^karachi(?:\s*only)?$/i.test(value)) {
    setOnce(attributes, "deliveryScope", "karachi_only", "Delivery Scope");
  } else if (/^nationwide$/i.test(value)) {
    setOnce(attributes, "deliveryScope", "nationwide", "Delivery Scope");
  } else {
    const price = parseCatalogPrice(value);
    if (price === null) return false;
    setOnce(attributes, "priceMinor", price, "Price");
  }
  return true;
}

function normalizeLine(line: string, lineNumber: number, brands: BrandReference[], contextBrand: string | null): CatalogSheetRow[] {
  const [first, ...rest] = line.split(/\s*[;@]\s*/);
  const attributes: Attributes = {
    ptaStatus: null, condition: null, conditionGrade: null, batteryHealth: null, cycleCount: null,
    warranty: null, deliveryScope: null, priceMinor: null, stock: null, gradeExplicit: false, notes: [], reviewReasons: [],
  };
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
  if (attributes.priceMinor === null) attributes.reviewReasons.push("Price missing");
  else if (attributes.priceMinor < MIN_PLAUSIBLE_PRICE_MINOR) attributes.reviewReasons.push("Price looks too low (below Rs 100)");

  const identity = splitIdentity(identityText);
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
  } else if (contextBrand) {
    brand = contextBrand;
    brandStatus = "explicit";
  } else {
    attributes.reviewReasons.push("Brand not recognised");
  }
  model = canonicalModel(model);
  if (!model) attributes.reviewReasons.push("Model missing");

  const productType: CatalogProductType | null = /\b(?:ipad|tab|tablet|pad)\b/i.test(model)
    ? "Tablet"
    : identity.storage
      ? "Mobile Phone"
      : null;
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
    const fieldStatus = emptyStatus();
    const explicitIf = (value: unknown): FieldStatus => (value === null ? "blank" : "explicit");
    fieldStatus.productType = productType ? "inferred" : "blank";
    fieldStatus.brand = brandStatus;
    fieldStatus.model = model ? "explicit" : "needs_review";
    fieldStatus.productTitle = brand && model ? "inferred" : "needs_review";
    fieldStatus.slug = brand && model ? "inferred" : "needs_review";
    fieldStatus.ram = explicitIf(identity.ram);
    fieldStatus.storage = explicitIf(identity.storage);
    fieldStatus.color = explicitIf(color);
    fieldStatus.ptaStatus = explicitIf(attributes.ptaStatus);
    fieldStatus.condition = explicitIf(attributes.condition);
    fieldStatus.conditionGrade = !attributes.conditionGrade ? "blank" : attributes.gradeExplicit ? "explicit" : "default";
    fieldStatus.batteryHealth = explicitIf(attributes.batteryHealth);
    fieldStatus.cycleCount = explicitIf(attributes.cycleCount);
    fieldStatus.warranty = explicitIf(attributes.warranty);
    fieldStatus.deliveryScope = deliveryStatus;
    fieldStatus.priceMinor = attributes.priceMinor === null ? "needs_review" : "explicit";
    fieldStatus.stock = attributes.stock === null ? "default" : "explicit";
    fieldStatus.notes = attributes.notes.length ? "needs_review" : "blank";
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
      notes: attributes.notes,
      fieldStatus,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    };
    if (slug) {
      row.sku = catalogSkuFor(row);
      fieldStatus.sku = brand ? "inferred" : "needs_review";
    }
    return row;
  });
}

/** Variant identity within one product: the same fields that distinguish catalog variants. */
export function catalogVariantKey(row: CatalogSheetRow) {
  return [row.slug, row.ram, row.storage, row.color, row.ptaStatus, row.condition, row.conditionGrade, row.batteryHealth, row.cycleCount]
    .map((value) => (value === null ? "" : String(value).toLowerCase()))
    .join("|");
}

/**
 * Normalizes rough stock lines ("Title RAM/Storage Color; Price; Used; Non-PTA; BH 89%; Cycles 312")
 * into fixed catalog sheet rows. A line that is exactly a known brand name sets the brand for the
 * lines that follow it. Deterministic and side-effect free.
 */
export function normalizeStockLines(text: string, options: NormalizeStockOptions): NormalizeStockResult {
  const rows: CatalogSheetRow[] = [];
  let contextBrand: string | null = null;
  const lines = normalizeText(text).replace(/\r\n?/g, "\n").split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = collapse(raw);
    if (!line) continue;
    const heading = !/[;@\d]/.test(line) ? options.brands.find((brand) => lower(brand.name) === lower(line)) : undefined;
    if (heading) {
      contextBrand = heading.name;
      continue;
    }
    rows.push(...normalizeLine(line, index + 1, options.brands, contextBrand));
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
  const skuOwners = new Map<string, string>();
  for (const row of rows) {
    if (!row.sku) continue;
    const owner = skuOwners.get(row.sku);
    const key = catalogVariantKey(row);
    if (owner !== undefined && owner !== key) {
      row.needsReview = true;
      row.reviewReasons.push(`Duplicate SKU ${row.sku}`);
    } else skuOwners.set(row.sku, key);
  }
  return { rows };
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
    // PTA/condition are part of the generated SKU; regenerate only SKUs the Owner did not supply.
    if (row.fieldStatus.sku === "inferred" && row.slug) row.sku = catalogSkuFor(row);
    return row;
  });
}
