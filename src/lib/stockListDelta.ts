import {
  DEFAULT_IMPORT_STOCK,
  normalizeStockLines,
  type BrandReference,
  type CatalogSheetRow,
} from "./catalogSheet.ts";
import { normalizeCapacity } from "./bulkCatalog.ts";
import { normalizeColor } from "./catalogColors.ts";

// Admin "Stock List Update": parse a raw supplier stock list, compare it with the CURRENT catalog and
// produce a delta preview + an apply PLAN. Pure functions only. Nothing here reads or writes the database;
// the later Apply phase is a separate, explicitly approved step. Parsing is delegated to the existing
// stock-line normalizer (normalizeStockLines) so there is one parser, not two.

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
  isActive: boolean;
};

export type CatalogDeltaProduct = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  category: string | null;
  publicationStatus: string | null;
  mediaCount: number;
  specCount: number;
  variants: CatalogDeltaVariant[];
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type RowCategory = "smartphone" | "tablet" | "accessory" | "feature_phone" | "other" | "unknown";

export const CATEGORY_LABEL: Record<RowCategory, string> = {
  smartphone: "Smartphone",
  tablet: "Tablet",
  accessory: "Accessory / non-phone",
  feature_phone: "Feature phone (Nokia / HMD)",
  other: "Other product type",
  unknown: "Unknown category",
};

export type ExcludedLine = { lineNumber: number; line: string; reason: string };

export type ParsedStockList = {
  rows: CatalogSheetRow[];
  excluded: ExcludedLine[];
  summary: ReturnType<typeof normalizeStockLines>["summary"];
};

const FEATURE_PHONE_BRANDS = new Set(["nokia", "hmd"]);
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
        excluded.push({ lineNumber: index + 1, line: line.trim(), reason: "Accessory / gift box — not a phone; excluded from the phone delta" });
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
      const brand = (row.brand ?? "").trim().toLowerCase();
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
  /** What the row would be if it were not held back for review (ambiguous rows only). */
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
  reasons: string[];
  notes: string[];
  selectable: boolean;
  defaultSelected: boolean;
  /** New products only: what is still needed before the product can be published. */
  requirements: string[];
};

export type MissingEntry = {
  id: string;
  scope: "product" | "variant";
  productId: string;
  productTitle: string;
  variantId: string | null;
  label: string;
  sku: string | null;
  priceMinor: number | null;
  stock: number | null;
  isActive: boolean | null;
  publicationStatus: string | null;
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
  missingProducts: number;
  missingVariants: number;
  ambiguous: number;
  blocked: number;
  excluded: number;
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
    "SKU — assigned automatically on import (MB###)",
    "Image — none exists; add via Media before publishing",
    "PTA status and Condition defaults — set from the batch defaults (not stated in the list)",
    `Stock — defaults to ${DEFAULT_IMPORT_STOCK} (not stated in the list)`,
    "Specifications — optional; add if available",
    "Publication validation — required before the product goes live",
  ];
  if (!complete) requirements.unshift("Complete the missing RAM / Storage / Color / Price before this can be created");
  return requirements;
}

export function buildStockDelta(parsed: ParsedStockList, catalog: CatalogDeltaProduct[]): StockDelta {
  const byKey = new Map<string, CatalogDeltaProduct[]>();
  const bySlug = new Map<string, CatalogDeltaProduct[]>();
  for (const product of catalog) {
    byKey.set(identityKey(product.title), [...(byKey.get(identityKey(product.title)) ?? []), product]);
    bySlug.set(product.slug, [...(bySlug.get(product.slug) ?? []), product]);
  }

  const entries: DeltaEntry[] = [];
  const touchedProducts = new Set<string>();
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
      reasons: [],
      notes: [],
      selectable: false,
      defaultSelected: false,
      requirements: [],
    };

    // Category exceptions and unusable rows are never compared or applied.
    if (category !== "smartphone") {
      entries.push({ ...base, reasons: [`${CATEGORY_LABEL[category]} — needs an Owner category decision; not part of the smartphone update`] });
      return;
    }
    if (row.priceMinor === null || !title) {
      entries.push({ ...base, reasons: [...row.reviewReasons, "Price or model missing — cannot compare"] });
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
      entries.push({ ...base, kind: "ambiguous", reasons: [...reasons, `Matches ${candidates.length} existing products (${candidates.map((product) => product.title).join(", ")})`] });
      return;
    }

    if (candidates.length === 0) {
      const complete = Boolean(row.ram && row.storage && row.color && row.priceMinor !== null);
      if (similar.length) notes.push(`Different model from existing: ${similar.map((product) => product.title).join(", ")}`);
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
    if (product.slug !== row.slug || product.title !== title) notes.push(`Matched to existing "${product.title}" (${product.slug}) — spelling/spacing normalised, identity proven by the catalog`);
    if (similar.length) notes.push(`Not merged with: ${similar.map((other) => other.title).join(", ")}`);
    const common = { productId: product.id, productTitle: product.title, productSlug: product.slug, mediaCount: product.mediaCount, specCount: product.specCount };

    const configMatches = product.variants.filter((variant) => sameConfiguration(row, variant));
    const variantMatches = configMatches.filter((variant) => factsCompatible(row, variant));

    if (variantMatches.length > 1) {
      entries.push({ ...base, ...common, kind: "ambiguous", reasons: [...reasons, `Matches ${variantMatches.length} existing variants (${variantMatches.map((variant) => variant.sku).join(", ")}); add PTA / Condition / Battery Health to tell them apart`], notes });
      return;
    }

    if (variantMatches.length === 0) {
      if (configMatches.length) reasons.push("Same RAM/Storage/Color exists with different PTA/Condition facts — review");
      const held = reasons.length > 0;
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
        requirements: ["SKU — assigned automatically on import (MB###)", `Stock — defaults to ${DEFAULT_IMPORT_STOCK} (not stated in the list)`, "PTA / Condition / Warranty — inherited from the existing product"],
      });
      return;
    }

    const variant = variantMatches[0];
    matchedVariantIds.add(variant.id);
    claimedVariants.set(variant.id, (claimedVariants.get(variant.id) ?? 0) + 1);
    const diff = row.priceMinor - variant.priceMinor;
    const kind: "unchanged" | "price_change" = diff === 0 ? "unchanged" : "price_change";
    if (!variant.isActive) notes.push("Existing variant is currently hidden — a price update does not reactivate it");
    if (kind === "price_change" && variant.compareAtPriceMinor !== null && row.priceMinor >= variant.compareAtPriceMinor) {
      reasons.push("New price is not below the existing compare-at price — adjust compare-at first (database rule)");
    }
    const held = reasons.length > 0;
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
      reasons,
      notes,
      selectable: !held && kind === "price_change",
      defaultSelected: !held && kind === "price_change",
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
    }
  }

  // Missing from the new list: review only, never selectable, never applied.
  const missing: MissingEntry[] = [];
  for (const product of catalog) {
    if (!touchedProducts.has(product.id)) {
      missing.push({ id: `missing-product-${product.id}`, scope: "product", productId: product.id, productTitle: product.title, variantId: null, label: `${product.variants.length} variant(s)`, sku: null, priceMinor: null, stock: null, isActive: null, publicationStatus: product.publicationStatus });
      continue;
    }
    for (const variant of product.variants) {
      if (matchedVariantIds.has(variant.id)) continue;
      missing.push({ id: `missing-variant-${variant.id}`, scope: "variant", productId: product.id, productTitle: product.title, variantId: variant.id, label: variantLabel(variant), sku: variant.sku, priceMinor: variant.priceMinor, stock: variant.stock, isActive: variant.isActive, publicationStatus: product.publicationStatus });
    }
  }

  const count = (kind: DeltaKind) => entries.filter((entry) => entry.kind === kind).length;
  const newProductEntries = entries.filter((entry) => entry.kind === "new_product");
  const smartphoneRows = entries.filter((entry) => entry.category === "smartphone");
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
    missingProducts: missing.filter((entry) => entry.scope === "product").length,
    missingVariants: missing.filter((entry) => entry.scope === "variant").length,
    ambiguous: count("ambiguous"),
    blocked: count("blocked"),
    excluded: parsed.excluded.length,
  };
  return { entries, missing, excluded: parsed.excluded, counts };
}

// ---------------------------------------------------------------------------
// Selection + apply plan (a PLAN only: nothing is written)
// ---------------------------------------------------------------------------

export const isSelectable = (entry: DeltaEntry) => entry.selectable && ["price_change", "new_variant", "new_product"].includes(entry.kind);

/** Safe price changes and safe new variants; new products only when every required value is present. Never missing / ambiguous / blocked / unchanged. */
export function defaultSelection(delta: StockDelta): Set<string> {
  return new Set(delta.entries.filter((entry) => isSelectable(entry) && entry.defaultSelected).map((entry) => entry.id));
}

export type PlannedVariant = { entryId: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number };

export type ApplyAction =
  | { op: "update_price"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; fromMinor: number; toMinor: number; diffMinor: number; writes: string[] }
  | { op: "create_variant"; entryId: string; productId: string; productTitle: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number; sku: string; inherits: string[]; writes: string[] }
  | { op: "create_product"; productTitle: string; slug: string; brand: string | null; category: string; status: string; variants: PlannedVariant[]; requirements: string[]; writes: string[] };

export type ApplyPlan = {
  actions: ApplyAction[];
  counts: { priceUpdates: number; newVariants: number; newProducts: number; newProductVariants: number };
  ignoredSelections: { entryId: string; reason: string }[];
  /** Existing catalog data that the plan never touches. */
  preserved: string[];
  missingReviewOnly: number;
  writesPerformed: false;
};

export const PRESERVED_GUARANTEES = [
  "Product IDs, slugs and URLs of every matched product",
  "SKUs of every existing variant (price updates keep the same variant row)",
  "Images / media of every matched product",
  "Specification rows of every matched product (none are reset or replaced)",
  "PTA status and Condition of existing variants and products",
  "Publication state of every existing product",
  "Existing stock quantities (a price update never changes stock)",
];

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
      actions.push({ op: "create_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: DEFAULT_IMPORT_STOCK, sku: "assigned on import (MB###)", inherits: ["PTA status", "Condition", "Warranty", "Delivery scope"], writes: ["product_variants (new row)", "inventory_movements (opening stock)"] });
    } else if (entry.kind === "new_product" && entry.newPriceMinor !== null) {
      const key = entry.productSlug || identityKey(entry.productTitle);
      const existing = newProducts.get(key) ?? { op: "create_product" as const, productTitle: entry.productTitle, slug: entry.productSlug, brand: entry.row.brand, category: "Mobile Phones", status: "Draft — hidden until image + validation", variants: [], requirements: entry.requirements, writes: ["products (new row, draft)", "product_variants (new rows)", "inventory_movements (opening stock)"] };
      existing.variants.push({ entryId: entry.id, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: DEFAULT_IMPORT_STOCK });
      newProducts.set(key, existing);
    }
  }
  actions.push(...newProducts.values());
  return {
    actions,
    counts: {
      priceUpdates: actions.filter((action) => action.op === "update_price").length,
      newVariants: actions.filter((action) => action.op === "create_variant").length,
      newProducts: newProducts.size,
      newProductVariants: [...newProducts.values()].reduce((sum, product) => sum + product.variants.length, 0),
    },
    ignoredSelections: ignored,
    preserved: PRESERVED_GUARANTEES,
    missingReviewOnly: delta.missing.length,
    writesPerformed: false,
  };
}

export const formatMinor = (minor: number | null) => (minor === null ? "—" : `Rs ${(minor / 100).toLocaleString("en-PK")}`);
export const formatDiff = (minor: number | null) => (minor === null ? "—" : `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${Math.abs(minor / 100).toLocaleString("en-PK")}`);
