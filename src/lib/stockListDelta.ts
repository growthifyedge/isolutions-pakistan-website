import {
  DEFAULT_IMPORT_STOCK,
  normalizeStockLines,
  type BrandReference,
  type CatalogSheetRow,
} from "./catalogSheet.ts";
import { normalizeCapacity } from "./bulkCatalog.ts";
import { normalizeColor } from "./catalogColors.ts";
import { CATEGORY_LABEL } from "./stockUpdateWording.ts";

// Admin "Android Stock Update": parse the latest Android stock list, compare it with the CURRENT Android
// phones on the website and produce a review + an update PLAN. Pure functions only. Nothing here reads or
// writes the database; the final "Update Website" write is a separate, explicitly approved step.
// Parsing is delegated to the existing stock-line normalizer (normalizeStockLines): one parser, not two.
//
// The latest list is the truth for Android availability:
//   in the list -> keep / update price / add variant / add phone;  absent -> hide (never delete);
//   hidden but back in the list -> show again. Images, specifications, URLs, SKUs, PTA, condition and
//   publication data of every existing phone are never touched by this tool.

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
};

const GIFT_BOX_LINE = /^gift\s*box\b/i;

const stripLeadingDecoration = (line: string) => line.replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** Raw WhatsApp-style text -> structured variant rows (one row per colour). Lines the normalizer deliberately skips are listed. */
export function parseStockList(text: string, brands: BrandReference[]): ParsedStockList {
  const { rows, summary } = normalizeStockLines(text, { brands });
  const excluded: ExcludedLine[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (GIFT_BOX_LINE.test(stripLeadingDecoration(line))) {
        excluded.push({ lineNumber: index + 1, line: line.trim(), reason: `${CATEGORY_LABEL.accessory} — not part of this Android update` });
      }
    });
  return { rows, excluded, summary };
}

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
  selectable: boolean;
  defaultSelected: boolean;
  /** New phones only: what is still needed before the phone can go live. */
  requirements: string[];
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
  selectable: boolean;
  defaultSelected: boolean;
  mediaCount: number;
  specCount: number;
};

export type StockDelta = {
  entries: DeltaEntry[];
  missing: MissingEntry[];
  excluded: ExcludedLine[];
  counts: DeltaCounts;
};

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

function newProductRequirements(row: CatalogSheetRow, complete: boolean) {
  const requirements = [
    "SKU: given automatically (MB###)",
    "Image: add one before the phone can go live",
    "PTA status and condition: set from the usual defaults (not in the list)",
    `Stock: starts at ${DEFAULT_IMPORT_STOCK} (not in the list)`,
    "Specifications: optional, can be added later",
    "Goes live only after it has an image and is published",
  ];
  if (!complete) requirements.unshift("Add the missing RAM / storage / color / price before this phone can be created");
  return requirements;
}

const isPublished = (product: CatalogDeltaProduct) => product.publicationStatus === "published";

export function buildStockDelta(parsed: ParsedStockList, fullCatalog: CatalogDeltaProduct[]): StockDelta {
  // Only Android phones take part. iPhones, tablets, accessories and feature phones on the website are never matched or hidden.
  const catalog = fullCatalog.filter(isAndroidCatalogProduct);
  const byKey = new Map<string, CatalogDeltaProduct[]>();
  const bySlug = new Map<string, CatalogDeltaProduct[]>();
  for (const product of catalog) {
    byKey.set(identityKey(product.title), [...(byKey.get(identityKey(product.title)) ?? []), product]);
    bySlug.set(product.slug, [...(bySlug.get(product.slug) ?? []), product]);
  }

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
      selectable: false,
      defaultSelected: false,
      requirements: [],
    };

    // Not an Android phone: listed for information only, never compared or applied.
    if (category !== "smartphone") {
      entries.push({ ...base, reasons: [`${CATEGORY_LABEL[category]} — not part of this Android update`] });
      return;
    }
    // An Android line we cannot read fully needs the Owner's attention (it can be skipped).
    if (row.priceMinor === null || !title) {
      entries.push({ ...base, kind: "ambiguous", reasons: [...row.reviewReasons, "Price or model missing — cannot compare"] });
      return;
    }

    const keyMatches = byKey.get(identityKey(title)) ?? [];
    const slugMatches = row.slug ? bySlug.get(row.slug) ?? [] : [];
    const candidates = [...new Set([...keyMatches, ...slugMatches])];
    const reasons = [...row.reviewReasons];
    const notes: string[] = [];

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

    if (candidates.length === 0) {
      const complete = Boolean(row.ram && row.storage && row.color && row.priceMinor !== null);
      if (similar.length) notes.push(`Different from the existing: ${similar.map((product) => product.title).join(", ")}`);
      const held = reasons.length > 0;
      entries.push({
        ...base,
        kind: held ? "ambiguous" : "new_product",
        provisionalKind: held ? "new_product" : null,
        reasons,
        notes,
        selectable: !held,
        defaultSelected: !held && complete,
        requirements: newProductRequirements(row, complete),
      });
      return;
    }

    const product = candidates[0];
    touchedProducts.add(product.id);
    if (product.slug !== row.slug || product.title !== title) notes.push(`Matched to “${product.title}” on the website`);
    if (similar.length) notes.push(`Not the same as: ${similar.map((other) => other.title).join(", ")}`);
    const common = { productId: product.id, productTitle: product.title, productSlug: product.slug, mediaCount: product.mediaCount, specCount: product.specCount, publicationStatus: product.publicationStatus };

    const configMatches = product.variants.filter((variant) => sameConfiguration(row, variant));
    const variantMatches = configMatches.filter((variant) => factsCompatible(row, variant));

    if (variantMatches.length > 1) {
      attentionProducts.add(product.id);
      entries.push({ ...base, ...common, kind: "ambiguous", reasons: [...reasons, `Matches ${variantMatches.length} existing variants (${variantMatches.map((variant) => variant.sku).join(", ")}); add PTA / Condition / Battery Health to tell them apart`], notes });
      return;
    }

    if (variantMatches.length === 0) {
      if (configMatches.length) reasons.push("Same RAM/Storage/Color exists with different PTA/Condition facts — review");
      const held = reasons.length > 0;
      if (held) attentionProducts.add(product.id);
      entries.push({
        ...base,
        ...common,
        kind: held ? "ambiguous" : "new_variant",
        provisionalKind: held ? "new_variant" : null,
        reasons,
        notes,
        stock: DEFAULT_IMPORT_STOCK,
        selectable: !held,
        defaultSelected: !held,
        requirements: ["SKU: given automatically (MB###)", `Stock: starts at ${DEFAULT_IMPORT_STOCK} (not in the list)`, "PTA / condition / warranty: same as the existing phone"],
      });
      return;
    }

    const variant = variantMatches[0];
    matchedVariantIds.add(variant.id);
    claimedVariants.set(variant.id, (claimedVariants.get(variant.id) ?? 0) + 1);
    const diff = row.priceMinor - variant.priceMinor;
    const kind: "unchanged" | "price_change" = diff === 0 ? "unchanged" : "price_change";
    const showAgain = !variant.isActive;
    if (showAgain) notes.push("Currently hidden on the website — it will be shown again");
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
      variantId: variant.id,
      sku: variant.sku,
      currentPriceMinor: variant.priceMinor,
      diffMinor: diff,
      stock: variant.stock,
      showAgain,
      reasons,
      notes,
      selectable: !held && (kind === "price_change" || showAgain),
      defaultSelected: !held && (kind === "price_change" || showAgain),
    });
  });

  // The same existing variant claimed by two list rows is a conflict (e.g. the same colour listed twice at different prices).
  for (const entry of entries) {
    if (entry.variantId && (claimedVariants.get(entry.variantId) ?? 0) > 1 && entry.kind !== "ambiguous") {
      entry.provisionalKind = entry.kind as DeltaEntry["provisionalKind"];
      entry.kind = "ambiguous";
      entry.reasons.push("The same existing variant is listed more than once");
      entry.selectable = false;
      entry.defaultSelected = false;
      if (entry.productId) attentionProducts.add(entry.productId);
    }
  }

  // Android phones / variants absent from the latest list: hidden (is_active = false), never deleted.
  // A phone with an unresolved row keeps everything visible until the Owner fixes that row.
  const missing: MissingEntry[] = [];
  const decide = (productId: string, visible: boolean): Pick<MissingEntry, "action" | "reason" | "selectable" | "defaultSelected"> => {
    if (attentionProducts.has(productId)) return { action: "held", reason: "Fix the rows that need attention for this phone first", selectable: false, defaultSelected: false };
    if (!visible) return { action: "already_hidden", reason: "Already hidden — stays hidden", selectable: false, defaultSelected: false };
    return { action: "hide", reason: "Not in the latest list — will be hidden from the website (not deleted)", selectable: true, defaultSelected: true };
  };
  for (const product of catalog) {
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
    blocked,
    excluded: parsed.excluded.length,
    notAndroid: blocked + parsed.excluded.length,
  };
  return { entries, missing, excluded: parsed.excluded, counts };
}

// ---------------------------------------------------------------------------
// Selection + update plan (a PLAN only: nothing is written)
// ---------------------------------------------------------------------------

export const isSelectable = (entry: DeltaEntry) =>
  entry.selectable && (["price_change", "new_variant", "new_product"].includes(entry.kind) || (entry.showAgain && entry.kind === "unchanged"));

export const isHideSelectable = (entry: MissingEntry) => entry.selectable && entry.action === "hide";

/** Safe price changes, safe new variants, returning variants and hides of visible items; new phones only when complete. Never attention / non-Android / held. */
export function defaultSelection(delta: StockDelta): Set<string> {
  return new Set([
    ...delta.entries.filter((entry) => isSelectable(entry) && entry.defaultSelected).map((entry) => entry.id),
    ...delta.missing.filter((entry) => isHideSelectable(entry) && entry.defaultSelected).map((entry) => entry.id),
  ]);
}

export type PlannedVariant = { entryId: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number };

export type ApplyAction =
  | { op: "update_price"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; fromMinor: number; toMinor: number; diffMinor: number; writes: string[] }
  | { op: "create_variant"; entryId: string; productId: string; productTitle: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number; sku: string; inherits: string[]; writes: string[] }
  | { op: "create_product"; productTitle: string; slug: string; brand: string | null; category: string; status: string; variants: PlannedVariant[]; requirements: string[]; writes: string[] }
  | { op: "show_variant"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; writes: string[] }
  | { op: "hide_variant"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; writes: string[] }
  | { op: "hide_product"; entryId: string; productId: string; productTitle: string; variantIds: string[]; writes: string[] };

/** Every operation the plan can contain. There is no delete, no media, no specification and no publication operation. */
export const PLAN_OPERATIONS = ["update_price", "create_variant", "create_product", "show_variant", "hide_variant", "hide_product"] as const;

export type ApplyPlan = {
  actions: ApplyAction[];
  counts: { priceUpdates: number; newVariants: number; newProducts: number; newProductVariants: number; showAgain: number; hideVariants: number; hideProducts: number };
  ignoredSelections: { entryId: string; reason: string }[];
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
  "Existing stock quantities (a price update or hide never changes stock)",
  "Nothing is ever deleted: hidden phones and variants keep their records and come back when they are in a later list",
];

const HIDE_WRITE = "product_variants.is_active = false (hidden from the store, not deleted)";
const SHOW_WRITE = "product_variants.is_active = true (shown again)";

export function buildApplyPlan(delta: StockDelta, selected: ReadonlySet<string>): ApplyPlan {
  const actions: ApplyAction[] = [];
  const ignored: ApplyPlan["ignoredSelections"] = [];
  const newProducts = new Map<string, Extract<ApplyAction, { op: "create_product" }>>();
  for (const entry of delta.entries) {
    if (!selected.has(entry.id)) continue;
    if (!isSelectable(entry)) {
      ignored.push({ entryId: entry.id, reason: `${entry.kind} rows cannot be applied` });
      continue;
    }
    if (entry.kind === "price_change" && entry.productId && entry.variantId && entry.currentPriceMinor !== null && entry.newPriceMinor !== null) {
      actions.push({ op: "update_price", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantId: entry.variantId, sku: entry.sku ?? "", label: entry.label, fromMinor: entry.currentPriceMinor, toMinor: entry.newPriceMinor, diffMinor: entry.newPriceMinor - entry.currentPriceMinor, writes: ["product_variants.price_minor (price only)"] });
    } else if (entry.kind === "new_variant" && entry.productId && entry.newPriceMinor !== null) {
      actions.push({ op: "create_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: DEFAULT_IMPORT_STOCK, sku: "given automatically (MB###)", inherits: ["PTA status", "Condition", "Warranty", "Delivery scope"], writes: ["product_variants (new row)", "inventory_movements (opening stock)"] });
    } else if (entry.kind === "new_product" && entry.newPriceMinor !== null) {
      const key = entry.productSlug || identityKey(entry.productTitle);
      const existing = newProducts.get(key) ?? { op: "create_product" as const, productTitle: entry.productTitle, slug: entry.productSlug, brand: entry.row.brand, category: "Mobile Phones", status: "Draft — hidden until it has an image and is published", variants: [], requirements: entry.requirements, writes: ["products (new row, draft)", "product_variants (new rows)", "inventory_movements (opening stock)"] };
      existing.variants.push({ entryId: entry.id, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: DEFAULT_IMPORT_STOCK });
      newProducts.set(key, existing);
    }
    if (entry.showAgain && entry.productId && entry.variantId) {
      actions.push({ op: "show_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantId: entry.variantId, sku: entry.sku ?? "", label: entry.label, writes: [SHOW_WRITE] });
    }
  }
  actions.push(...newProducts.values());
  for (const entry of delta.missing) {
    if (!selected.has(entry.id)) continue;
    if (!isHideSelectable(entry)) {
      ignored.push({ entryId: entry.id, reason: entry.action === "held" ? "held until the phone's attention rows are fixed" : "already hidden" });
      continue;
    }
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
      newVariants: tally("create_variant"),
      newProducts: newProducts.size,
      newProductVariants: [...newProducts.values()].reduce((sum, product) => sum + product.variants.length, 0),
      showAgain: tally("show_variant"),
      hideVariants: tally("hide_variant"),
      hideProducts: tally("hide_product"),
    },
    ignoredSelections: ignored,
    preserved: PRESERVED_GUARANTEES,
    writesPerformed: false,
  };
}

export const formatMinor = (minor: number | null) => (minor === null ? "—" : `Rs ${(minor / 100).toLocaleString("en-PK")}`);
export const formatDiff = (minor: number | null) => (minor === null ? "—" : `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${Math.abs(minor / 100).toLocaleString("en-PK")}`);
