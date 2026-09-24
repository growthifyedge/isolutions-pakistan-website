import { parsePkrMajorToMinor, pkrMajorInputFromMinor } from "./money.ts";

export type PtaStatus =
  "approved" | "not_approved" | "not_applicable" | "unknown";
export type ProductCondition =
  "brand_new" | "used" | "open_box" | "refurbished" | "unknown";
export type DeliveryScope = "karachi_only" | "nationwide" | null;
export type ValueSource =
  | "Owner supplied explicitly"
  | "inherited from product"
  | "inherited from batch default"
  | "explicit variant override"
  | "inherited by variant"
  | "unresolved";

export type BatchDefaults = {
  brand: string | null;
  category: string | null;
  condition: ProductCondition | null;
  deliveryScope: DeliveryScope;
  warranty: string | null;
  ptaStatus: PtaStatus | null;
  inventory: number | null;
};
export type ProductDefaultSource =
  "Owner supplied explicitly" | "batch default" | "unresolved";

export type BulkDiagnostic = {
  line: string;
  reason: string;
  classification:
    "preserved Owner note" | "unresolved field" | "Owner Review Required";
  blocksApply: boolean;
};

export type BulkSpecification = {
  source: string;
  group: string | null;
  label: string;
  value: string;
};

export type BulkVariant = {
  source: string;
  sku: string | null;
  ram: string | null;
  storage: string | null;
  color: string | null;
  pricePkr: string | null;
  priceMinor: number | null;
  compareAtPricePkr: string | null;
  compareAtPriceMinor: number | null;
  ptaStatus: PtaStatus;
  ptaSource: ValueSource;
  condition: ProductCondition;
  conditionSource: ValueSource;
  warranty: string | null;
  warrantySource: ValueSource;
  deliveryScope: DeliveryScope;
  deliverySource: ValueSource;
  inventory: number | null;
  warnings: string[];
  // Catalog sheet (Bulk Upload v2) used-phone facts; preview/display only for now.
  conditionGrade?: string | null;
  batteryHealth?: number | null;
  cycleCount?: number | null;
};

export type BulkProduct = {
  source: string;
  title: string;
  brand: string;
  brandExplicit: boolean;
  category: string | null;
  categoryExplicit: boolean;
  slug: string | null;
  shortDescription: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  defaultPtaStatus: PtaStatus | null;
  defaultPtaSource: ProductDefaultSource;
  defaultCondition: ProductCondition | null;
  defaultConditionSource: ProductDefaultSource;
  defaultWarranty: string | null;
  defaultWarrantySource: ProductDefaultSource;
  defaultDeliveryScope: DeliveryScope;
  defaultDeliverySource: ProductDefaultSource;
  notes: string[];
  specifications: BulkSpecification[];
  diagnostics: BulkDiagnostic[];
  variants: BulkVariant[];
  warnings: string[];
  // Catalog sheet (Bulk Upload v2) Action column: Create / Replace Existing / blank.
  requestedAction?: "Create" | "Replace Existing" | null;
  // Catalog sheet only: Mobile Phone / Accessory / Gadget / Tablet / Laptop.
  productType?: string | null;
};

export type BulkParseResult = {
  format: "rough_text" | "csv" | "catalog_sheet";
  products: BulkProduct[];
  errors: string[];
};

type VariantDraft = Partial<BulkVariant> & { source: string };

const clean = (value?: string | null) => value?.trim() || null;
const normalizeInput = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[／⁄]/g, "/")
    .replace(/[：]/g, ":")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
const normalizedName = (value: string) =>
  normalizeInput(value).trim().replace(/\s+/g, " ").toLowerCase();
const slugify = (value: string) =>
  normalizedName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function matchingActiveRealTaxonomy<
  T extends {
    name: string;
    data_class: "real" | "development";
    is_active: boolean;
  },
>(items: T[], requestedName: string) {
  const requested = normalizedName(requestedName);
  return items.filter(
    (item) =>
      item.data_class === "real" &&
      item.is_active &&
      normalizedName(item.name) === requested,
  );
}

export function matchingActiveRealCategoryTaxonomy<
  T extends {
    name: string;
    slug: string;
    data_class: "real" | "development";
    is_active: boolean;
  },
>(items: T[], requestedCategory: string) {
  const requestedName = normalizedName(requestedCategory);
  const requestedSlug = slugify(requestedCategory);
  // Older category names resolve to the locked structure (Mobile Phones, Accessories,
  // Gadgets > Laptops/Tablets) so the legacy parser never recreates outdated categories.
  const equivalentNames: Record<string, string[]> = {
    smartphones: ["mobile phones"],
    "mobile phones": ["smartphones"],
    "mobile accessories": ["accessories"],
    accessories: ["mobile accessories"],
    tablets: ["ipad & tablets", "android tablets"],
    "power banks": ["power bank", "accessories"],
    "audio & earbuds": ["audio", "earbuds", "accessories"],
  };
  const acceptedNames = new Set([
    requestedName,
    ...(equivalentNames[requestedName] ?? []),
  ]);
  return items.filter(
    (item) =>
      item.data_class === "real" &&
      item.is_active &&
      (acceptedNames.has(normalizedName(item.name)) || item.slug === requestedSlug),
  );
}

export function normalizeCapacity(value?: string | null) {
  const match = normalizeInput(value ?? "")
    .trim()
    .toUpperCase()
    .match(/^(\d+)\s*(GB|TB)?$/);
  return match ? `${match[1]} ${match[2] ?? "GB"}` : null;
}

function price(value?: string | null) {
  if (!value) return { entered: null, minor: null };
  const normalized = normalizeInput(value)
    .trim()
    .toLowerCase()
    .replace(/^(pkr|rs\.?)[\s:]*/i, "")
    .replaceAll(",", "")
    .replaceAll(" ", "");
  const expanded = normalized.endsWith("k")
    ? `${normalized.slice(0, -1)}000`
    : normalized;
  try {
    return { entered: expanded, minor: parsePkrMajorToMinor(expanded) };
  } catch {
    return { entered: value.trim(), minor: null };
  }
}

function pta(value?: string | null): PtaStatus {
  const normalized = normalizedName(value ?? "").replace(/[\s-]+/g, "_");
  if (["approved", "pta_approved", "official_approved"].includes(normalized))
    return "approved";
  if (["non_pta", "not_approved", "unapproved"].includes(normalized))
    return "not_approved";
  if (["not_applicable", "n/a"].includes(normalized)) return "not_applicable";
  return "unknown";
}

function condition(value?: string | null): ProductCondition {
  const normalized = normalizedName(value ?? "").replace(/[\s-]+/g, "_");
  if (["brand_new", "new"].includes(normalized)) return "brand_new";
  if (["used", "open_box", "refurbished"].includes(normalized))
    return normalized as ProductCondition;
  return "unknown";
}

function delivery(value?: string | null): DeliveryScope {
  const normalized = normalizedName(value ?? "").replace(/[\s-]+/g, "_");
  if (["karachi", "karachi_only"].includes(normalized)) return "karachi_only";
  if (["nationwide", "all_pakistan", "pakistan_wide"].includes(normalized))
    return "nationwide";
  return null;
}

function inventory(value?: string | null) {
  const normalized = clean(value)?.replaceAll(",", "");
  return normalized && /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function makeProduct(title: string): BulkProduct {
  return {
    source: title,
    title,
    brand: "",
    brandExplicit: false,
    category: null,
    categoryExplicit: false,
    slug: null,
    shortDescription: null,
    seoTitle: null,
    seoDescription: null,
    defaultPtaStatus: null,
    defaultPtaSource: "unresolved",
    defaultCondition: null,
    defaultConditionSource: "unresolved",
    defaultWarranty: null,
    defaultWarrantySource: "unresolved",
    defaultDeliveryScope: null,
    defaultDeliverySource: "unresolved",
    notes: [],
    specifications: [],
    diagnostics: [],
    variants: [],
    warnings: [],
  };
}

function addDiagnostic(
  product: BulkProduct,
  line: string,
  reason: string,
  classification: BulkDiagnostic["classification"],
  blocksApply: boolean,
) {
  product.diagnostics.push({ line, reason, classification, blocksApply });
  if (blocksApply) product.warnings.push(`${reason}: ${line}`);
}

function sourceFor(value: unknown, inherited: unknown): ValueSource {
  return value != null
    ? "explicit variant override"
    : inherited != null
      ? "inherited by variant"
      : "unresolved";
}

function materializeVariant(product: BulkProduct, draft: VariantDraft) {
  const parsedPrice = price(draft.pricePkr);
  const parsedCompare = price(draft.compareAtPricePkr);
  const explicitPta =
    draft.ptaStatus && draft.ptaStatus !== "unknown" ? draft.ptaStatus : null;
  const explicitCondition =
    draft.condition && draft.condition !== "unknown" ? draft.condition : null;
  const explicitDelivery = draft.deliveryScope ?? null;
  const explicitWarranty = clean(draft.warranty);
  const warnings = [...(draft.warnings ?? [])];
  if (parsedPrice.minor === null) warnings.push("Price missing or invalid");
  if (
    parsedCompare.minor !== null &&
    parsedPrice.minor !== null &&
    parsedCompare.minor <= parsedPrice.minor
  )
    warnings.push("Compare-at price must exceed price");
  return {
    source: draft.source,
    sku: clean(draft.sku),
    ram: normalizeCapacity(draft.ram),
    storage: normalizeCapacity(draft.storage),
    color: clean(draft.color),
    pricePkr: parsedPrice.entered,
    priceMinor: parsedPrice.minor,
    compareAtPricePkr: parsedCompare.entered,
    compareAtPriceMinor: parsedCompare.minor,
    ptaStatus: explicitPta ?? product.defaultPtaStatus ?? "unknown",
    ptaSource: sourceFor(explicitPta, product.defaultPtaStatus),
    condition: explicitCondition ?? product.defaultCondition ?? "unknown",
    conditionSource: sourceFor(explicitCondition, product.defaultCondition),
    warranty: explicitWarranty ?? product.defaultWarranty,
    warrantySource: sourceFor(explicitWarranty, product.defaultWarranty),
    deliveryScope: explicitDelivery ?? product.defaultDeliveryScope,
    deliverySource: sourceFor(explicitDelivery, product.defaultDeliveryScope),
    inventory: draft.inventory ?? null,
    warnings,
  } satisfies BulkVariant;
}

function parseCommercialLine(product: BulkProduct, sourceLine: string) {
  const line = normalizeInput(sourceLine).trim().replace(/\s+/g, " ");
  const priceMatch = line.match(
    /(?:^|[\s/])((?:PKR|Rs\.?)?\s*\d[\d,]*(?:k)?)$/i,
  );
  if (!priceMatch) return false;
  const priceText = priceMatch[1];
  let attributes = line
    .slice(0, priceMatch.index)
    .trim()
    .replace(/[\s/]+$/, "");
  let explicitPta: PtaStatus | null = null;
  const ptaMatch = attributes.match(
    /(?:^|[\s/])(PTA Approved|Official Approved|Non-PTA|Not Approved)$/i,
  );
  if (ptaMatch) {
    explicitPta = pta(ptaMatch[1]);
    attributes = attributes
      .slice(0, ptaMatch.index)
      .trim()
      .replace(/[\s/]+$/, "");
  }
  let ram: string | null = null;
  let storage: string | null = null;
  let colorsSource = "";
  const ramStorage = attributes.match(
    /^(\d+)\s*(?:GB)?\s*\/\s*(\d+)\s*(GB|TB)?(?:\s*\/\s*|\s+)?(.*)$/i,
  );
  const storageOnly = attributes.match(
    /^(\d+)\s*(GB|TB)(?:\s*\/\s*|\s+)?(.*)$/i,
  );
  if (ramStorage) {
    ram = normalizeCapacity(`${ramStorage[1]} GB`);
    storage = normalizeCapacity(`${ramStorage[2]} ${ramStorage[3] ?? "GB"}`);
    colorsSource = ramStorage[4].trim();
  } else if (storageOnly) {
    storage = normalizeCapacity(`${storageOnly[1]} ${storageOnly[2]}`);
    colorsSource = storageOnly[3].trim();
  } else if (attributes) {
    return false;
  }
  if (/^\d+\s*(?:GB|TB)?\b/i.test(colorsSource)) return false;
  const colors = colorsSource
    ? colorsSource
        .split(/\s*\/\s*/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [null];
  for (const color of colors) {
    product.variants.push(
      materializeVariant(product, {
        source: sourceLine,
        ram,
        storage,
        color,
        pricePkr: priceText,
        ptaStatus: explicitPta ?? undefined,
      }),
    );
  }
  return true;
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function parseCsv(text: string): BulkParseResult {
  const rows = csvRows(normalizeInput(text));
  const headers = (rows.shift() ?? []).map((header) =>
    normalizedName(header).replace(/[\s-]+/g, "_"),
  );
  const products = new Map<string, BulkProduct>();
  const errors: string[] = [];
  for (const [rowIndex, cells] of rows.entries()) {
    const record = Object.fromEntries(
      headers.map((header, index) => [header, cells[index]?.trim() ?? ""]),
    );
    const title = clean(record.product_title ?? record.title);
    const brand = clean(record.brand);
    if (!title) {
      errors.push(`CSV row ${rowIndex + 2}: product_title is required; blocks apply.`);
      continue;
    }
    const key = `${normalizedName(brand ?? "")}|${normalizedName(title)}|${clean(record.slug) ?? ""}`;
    let product = products.get(key);
    if (!product) {
      product = makeProduct(title);
      product.source = `CSV row ${rowIndex + 2}`;
      product.brand = brand ?? "";
      product.brandExplicit = Boolean(brand);
      product.category = clean(record.category);
      product.categoryExplicit = Boolean(product.category);
      product.slug = clean(record.slug) ? slugify(record.slug) : null;
      product.shortDescription = clean(
        record.short_description ?? record.description,
      );
      product.seoTitle = clean(record.seo_title);
      product.seoDescription = clean(record.seo_description);
      product.defaultPtaStatus = clean(record.default_pta_status)
        ? pta(record.default_pta_status)
        : null;
      product.defaultCondition = clean(record.default_condition)
        ? condition(record.default_condition)
        : null;
      product.defaultWarranty = clean(record.default_warranty);
      product.defaultDeliveryScope = delivery(record.default_delivery_scope);
      const note = clean(record.note ?? record.notes);
      if (note) product.notes.push(note);
      const specification = clean(record.specification);
      if (specification)
        product.specifications.push({
          source: `CSV row ${rowIndex + 2}`,
          group: null,
          label: clean(record.specification_label) ?? "Owner specification",
          value: specification,
        });
      products.set(key, product);
    }
    const inventoryText = clean(record.inventory ?? record.stock);
    const parsedInventory = inventory(inventoryText);
    const variant = materializeVariant(product, {
      source: `CSV row ${rowIndex + 2}`,
      sku: clean(record.sku),
      ram: clean(record.ram),
      storage: clean(record.storage),
      color: clean(record.color),
      pricePkr: clean(record.price_pkr ?? record.price),
      compareAtPricePkr: clean(
        record.compare_at_price_pkr ?? record.compare_at,
      ),
      ptaStatus: clean(record.pta_status) ? pta(record.pta_status) : undefined,
      condition: clean(record.condition)
        ? condition(record.condition)
        : undefined,
      warranty: clean(record.warranty),
      deliveryScope: delivery(record.delivery_scope ?? record.delivery),
      inventory: parsedInventory,
      warnings:
        inventoryText !== null && parsedInventory === null
          ? ["Inventory must be a non-negative whole number"]
          : [],
    });
    product.variants.push(variant);
  }
  return { format: "csv", products: [...products.values()], errors };
}

const labelPattern =
  /^(Product Title|Brand|Category|Slug|SKU|Price(?: PKR)?|Compare[- ]?at(?: Price)?(?: PKR)?|RAM|Storage|Color(?:\s*\/\s*Finish)?|PTA(?: Status)?|Condition|Warranty|Delivery(?: Scope)?|Inventory|Stock|Note|Specification|SEO Title|SEO Description|Description)\s*:\s*(.*)$/i;
const canonicalLabel = (value: string) =>
  normalizedName(value).replace(/[-_]+/g, " ").replace(/\s+/g, " ");

function parseRough(text: string): BulkParseResult {
  const normalized = normalizeInput(text).replace(/\r\n?/g, "\n").trim();
  const blocks = normalized.split(/\n\s*\n+/).filter((block) => block.trim());
  const products: BulkProduct[] = [];
  const errors: string[] = [];
  let lastStructuredProduct: BulkProduct | null = null;
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const headingLine = lines.shift();
    if (!headingLine) continue;
    const headingPair = headingLine.match(labelPattern);
    const ordinalVariantHeading = /^(?:variant\s*)?#?\d+[.)]?$/i.test(
      headingLine,
    );
    const heading =
      headingPair && canonicalLabel(headingPair[1]) === "product title"
        ? clean(headingPair[2])
        : ordinalVariantHeading && lastStructuredProduct
          ? lastStructuredProduct.title
        : headingLine;
    if (!heading) {
      errors.push(`Block ${blockIndex + 1}: Product Title is required; blocks apply.`);
      continue;
    }
    if (headingPair && canonicalLabel(headingPair[1]) !== "product title") {
      errors.push(
        `Block ${blockIndex + 1}: missing product title before "${headingLine}"; blocks apply.`,
      );
      continue;
    }
    const product = makeProduct(heading);
    if (ordinalVariantHeading && lastStructuredProduct) {
      product.brand = lastStructuredProduct.brand;
      product.brandExplicit = lastStructuredProduct.brandExplicit;
      product.category = lastStructuredProduct.category;
      product.categoryExplicit = lastStructuredProduct.categoryExplicit;
      product.slug = lastStructuredProduct.slug;
      product.defaultPtaStatus = lastStructuredProduct.defaultPtaStatus;
      product.defaultCondition = lastStructuredProduct.defaultCondition;
      product.defaultWarranty = lastStructuredProduct.defaultWarranty;
      product.defaultDeliveryScope = lastStructuredProduct.defaultDeliveryScope;
    }
    const labeledDraft: VariantDraft = { source: `${heading} labeled fields` };
    const commercialLines: string[] = [];
    let hasLabeledVariant = false;
    for (const sourceLine of lines) {
      if (/^variants?\s*:?$/i.test(sourceLine)) continue;
      const pair = sourceLine.match(labelPattern);
      if (pair) {
        const label = canonicalLabel(pair[1]);
        const value = pair[2].trim();
        if (!value) {
          addDiagnostic(
            product,
            sourceLine,
            `${pair[1]} is empty`,
            "unresolved field",
            true,
          );
          continue;
        }
        if (label === "product title") {
          if (normalizedName(value) !== normalizedName(product.title))
            addDiagnostic(product, sourceLine, "Conflicting Product Title", "Owner Review Required", true);
        } else if (label === "brand") {
          product.brand = value;
          product.brandExplicit = true;
        } else if (label === "category") {
          product.category = value;
          product.categoryExplicit = true;
        } else if (label === "slug") product.slug = slugify(value);
        else if (label === "description") product.shortDescription = value;
        else if (label === "seo title") product.seoTitle = value;
        else if (label === "seo description") product.seoDescription = value;
        else if (label === "note") {
          product.notes.push(value);
          addDiagnostic(
            product,
            sourceLine,
            "Owner note preserved verbatim",
            "preserved Owner note",
            false,
          );
        } else if (label === "specification") {
          const parts = value.split(/\s*(?:=|:)\s*/, 2);
          product.specifications.push({
            source: sourceLine,
            group: null,
            label:
              parts.length === 2
                ? parts[0]
                : `Owner specification ${product.specifications.length + 1}`,
            value: parts.length === 2 ? parts[1] : value,
          });
        } else if (
          [
            "sku",
            "price",
            "price pkr",
            "compare at",
            "compare at price",
            "compare at price pkr",
            "ram",
            "storage",
            "color",
            "color / finish",
            "inventory",
            "stock",
          ].includes(label)
        ) {
          hasLabeledVariant = true;
          if (label === "sku") labeledDraft.sku = value;
          else if (label === "price" || label === "price pkr") labeledDraft.pricePkr = value;
          else if (label.startsWith("compare at"))
            labeledDraft.compareAtPricePkr = value;
          else if (label === "ram") labeledDraft.ram = value;
          else if (label === "storage") labeledDraft.storage = value;
          else if (label === "color" || label === "color / finish") labeledDraft.color = value;
          else {
            const parsed = inventory(value);
            labeledDraft.inventory = parsed;
            if (parsed === null)
              (labeledDraft.warnings ??= []).push(
                "Inventory must be a non-negative whole number",
              );
          }
        } else if (label === "pta" || label === "pta status") {
          const parsed = pta(value);
          if (hasLabeledVariant) labeledDraft.ptaStatus = parsed;
          else product.defaultPtaStatus = parsed === "unknown" ? null : parsed;
        } else if (label === "condition") {
          const parsed = condition(value);
          if (hasLabeledVariant) labeledDraft.condition = parsed;
          else product.defaultCondition = parsed === "unknown" ? null : parsed;
        } else if (label === "warranty") {
          if (hasLabeledVariant) labeledDraft.warranty = value;
          else product.defaultWarranty = value;
        } else if (label === "delivery" || label === "delivery scope") {
          const parsed = delivery(value);
          if (hasLabeledVariant) labeledDraft.deliveryScope = parsed;
          else product.defaultDeliveryScope = parsed;
        }
        continue;
      }
      if (/^(PTA Approved|Official Approved)$/i.test(sourceLine))
        product.defaultPtaStatus = "approved";
      else if (/^(Non-PTA|Not Approved)$/i.test(sourceLine))
        product.defaultPtaStatus = "not_approved";
      else if (/^(Brand New|Used|Open Box|Refurbished)$/i.test(sourceLine))
        product.defaultCondition = condition(sourceLine);
      else if (/^(Karachi only|Nationwide)$/i.test(sourceLine))
        product.defaultDeliveryScope = delivery(sourceLine);
      else if (/\d[\d,]*k?$/i.test(sourceLine))
        commercialLines.push(sourceLine);
      else
        addDiagnostic(
          product,
          sourceLine,
          "Owner Review Required — unrecognized line",
          "Owner Review Required",
          true,
        );
    }
    for (const commercialLine of commercialLines) {
      if (!parseCommercialLine(product, commercialLine))
        addDiagnostic(
          product,
          commercialLine,
          "Owner Review Required — ambiguous commercial line",
          "Owner Review Required",
          true,
        );
    }
    if (hasLabeledVariant)
      product.variants.push(materializeVariant(product, labeledDraft));
    products.push(product);
    if (!ordinalVariantHeading) lastStructuredProduct = product;
  }
  const grouped = new Map<string, BulkProduct>();
  for (const product of products) {
    const key = product.slug
      ? `slug:${product.slug}`
      : `identity:${normalizedName(product.brand)}|${normalizedName(product.title)}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, product);
      continue;
    }
    const conflicts = [
      ["Brand", current.brand, product.brand],
      ["Category", current.category, product.category],
      ["Slug", current.slug, product.slug],
    ].filter(([, left, right]) => left && right && normalizedName(String(left)) !== normalizedName(String(right)));
    for (const [field] of conflicts)
      addDiagnostic(current, product.source, `Conflicting ${field} across variant rows`, "Owner Review Required", true);
    current.brand ||= product.brand;
    current.brandExplicit ||= product.brandExplicit;
    current.category ||= product.category;
    current.categoryExplicit ||= product.categoryExplicit;
    current.slug ||= product.slug;
    current.shortDescription ||= product.shortDescription;
    current.seoTitle ||= product.seoTitle;
    current.seoDescription ||= product.seoDescription;
    current.defaultPtaStatus ||= product.defaultPtaStatus;
    current.defaultCondition ||= product.defaultCondition;
    current.defaultWarranty ||= product.defaultWarranty;
    current.defaultDeliveryScope ||= product.defaultDeliveryScope;
    current.notes.push(...product.notes);
    current.specifications.push(...product.specifications);
    current.diagnostics.push(...product.diagnostics);
    current.variants.push(...product.variants);
    current.warnings.push(...product.warnings);
  }
  return { format: "rough_text", products: [...grouped.values()], errors };
}

type RawContext = Pick<
  BulkProduct,
  | "brand"
  | "brandExplicit"
  | "category"
  | "categoryExplicit"
  | "defaultPtaStatus"
  | "defaultPtaSource"
  | "defaultCondition"
  | "defaultConditionSource"
  | "defaultWarranty"
  | "defaultWarrantySource"
  | "defaultDeliveryScope"
  | "defaultDeliverySource"
>;

const rawBrands: Record<string, { brand: string; category?: string }> = {
  samsung: { brand: "Samsung" }, vivo: { brand: "Vivo" },
  "mi xiaomi": { brand: "Xiaomi" }, xiaomi: { brand: "Xiaomi" },
  realme: { brand: "Realme" }, oppo: { brand: "Oppo" },
  infinix: { brand: "Infinix" }, tecno: { brand: "Tecno" },
  honor: { brand: "Honor" }, nokia: { brand: "Nokia" }, itel: { brand: "Itel" },
  nothing: { brand: "Nothing" }, zte: { brand: "ZTE" },
  "samsung tab": { brand: "Samsung", category: "Tablets" },
};

const rawColors = (value: string) => value.trim().replace(/^[,/\s]+|[,/\s]+$/g, "")
  .split(/\s*\/\s*|\s*,\s*/).map((item) => item.trim()).filter(Boolean);

function rawCategoryFor(title: string, contextCategory: string | null) {
  if (contextCategory) return contextCategory;
  const value = normalizedName(title);
  if (/power\s*bank/.test(value)) return "Accessories";
  if (/buds?|earbuds?|headphones?/.test(value)) return "Accessories";
  if (/\b(macbook|laptop|notebook)\b/.test(value)) return "Laptops";
  if (/\b(tab|tablet|ipad)\b/.test(value)) return "Tablets";
  return "Mobile Phones";
}

function applyRawFact(product: BulkProduct, line: string) {
  if (/^PTA Approved$/i.test(line)) {
    product.defaultPtaStatus = "approved";
    product.defaultPtaSource = "Owner supplied explicitly";
  } else if (/^(Non[- ]?PTA|Not Approved)$/i.test(line)) {
    product.defaultPtaStatus = "not_approved";
    product.defaultPtaSource = "Owner supplied explicitly";
  } else if (/^(Brand New|Used|Open Box|Refurbished)$/i.test(line)) {
    product.defaultCondition = condition(line);
    product.defaultConditionSource = "Owner supplied explicitly";
  } else if (/^(Karachi Only|Nationwide)$/i.test(line)) {
    product.defaultDeliveryScope = delivery(line);
    product.defaultDeliverySource = "Owner supplied explicitly";
  } else if (/^Non[- ]?Warranty$/i.test(line)) {
    product.defaultWarranty = "Non Warranty";
    product.defaultWarrantySource = "Owner supplied explicitly";
  } else if (/^\d+\s*Year Warranty$/i.test(line)) {
    product.defaultWarranty = line;
    product.defaultWarrantySource = "Owner supplied explicitly";
  } else return false;
  return true;
}

function rawSpecification(line: string): Omit<BulkSpecification, "source"> | null {
  const battery = line.match(/^(\d+(?:\.\d+)?\s*mAh)\s+Battery$/i);
  if (battery) return { group: "Battery", label: "Capacity", value: battery[1] };
  const display = line.match(/^(\d+(?:\.\d+)?)\s+(.+?)\s+Display$/i);
  if (display) return { group: "Display", label: "Display", value: `${display[1]} ${display[2]}` };
  const camera = line.match(/^(\d+(?:\.\d+)?\s*MP)\s+Camera$/i);
  if (camera) return { group: "Camera", label: "Main Camera", value: camera[1] };
  return null;
}

/** Deterministic stock-list normalizer. Its result is intentionally consumed by the existing preview/apply pipeline. */
export function normalizeRawCatalog(text: string): BulkParseResult {
  const products: BulkProduct[] = [];
  const errors: string[] = [];
  const context: RawContext = {
    brand: "", brandExplicit: false, category: null, categoryExplicit: false,
    defaultPtaStatus: null, defaultPtaSource: "unresolved",
    defaultCondition: null, defaultConditionSource: "unresolved",
    defaultWarranty: null, defaultWarrantySource: "unresolved",
    defaultDeliveryScope: null, defaultDeliverySource: "unresolved",
  };
  let current: BulkProduct | null = null;
  for (const raw of normalizeInput(text).replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = rawBrands[normalizedName(line)];
    if (heading) {
      context.brand = heading.brand; context.brandExplicit = true;
      context.category = heading.category ?? null; context.categoryExplicit = Boolean(heading.category);
      current = null;
      continue;
    }
    const factTarget = current ?? makeProduct("raw context");
    Object.assign(factTarget, context);
    if (applyRawFact(factTarget, line)) {
      context.defaultPtaStatus = factTarget.defaultPtaStatus;
      context.defaultPtaSource = factTarget.defaultPtaSource;
      context.defaultCondition = factTarget.defaultCondition;
      context.defaultConditionSource = factTarget.defaultConditionSource;
      context.defaultWarranty = factTarget.defaultWarranty;
      context.defaultWarrantySource = factTarget.defaultWarrantySource;
      context.defaultDeliveryScope = factTarget.defaultDeliveryScope;
      context.defaultDeliverySource = factTarget.defaultDeliverySource;
      if (current) Object.assign(current, factTarget);
      continue;
    }
    const specification = rawSpecification(line);
    if (current && specification) {
      current.specifications.push({ source: line, ...specification });
      continue;
    }
    if (current && /\b(?:with|without)\s+buds?\s+gift\b/i.test(line)) {
      current.notes.push(line);
      addDiagnostic(current, line, "Owner note preserved verbatim", "preserved Owner note", false);
      continue;
    }
    const at = line.indexOf("@");
    if (at < 0) {
      if (current) addDiagnostic(current, line, "Owner Review Required — unrecognized raw line", "Owner Review Required", true);
      else errors.push(`Unrecognized raw line: ${line}`);
      continue;
    }
    let before = line.slice(0, at).trim();
    let after = line.slice(at + 1).trim();
    let explicitPta: PtaStatus | undefined;
    if (/\bNon[- ]?PTA\b/i.test(line)) {
      explicitPta = "not_approved";
      before = before.replace(/\bNon[- ]?PTA\b/gi, "").trim();
      after = after.replace(/\bNon[- ]?PTA\b/gi, "").trim();
    }
    const configuration = before.match(/(\d+)\s*(?:GB)?\s*\/\s*(\d+)\s*(GB|TB)?\b/i);
    const title = configuration ? before.slice(0, configuration.index).trim() : before;
    if (!title) { errors.push(`Raw line has no product title: ${line}`); continue; }
    const product = makeProduct(title);
    Object.assign(product, context, {
      source: line, slug: slugify(title), seoTitle: title, shortDescription: title, seoDescription: title,
      category: rawCategoryFor(title, context.category), categoryExplicit: true,
    });
    const prefixColors = configuration ? rawColors(before.slice((configuration.index ?? 0) + configuration[0].length)) : [];
    const priced = after.match(/^([\d,]+(?:\s*\/\s*[\d,]+)*)(?:\s+(.+))?$/);
    const prices = priced ? priced[1].split("/").map((item) => item.trim()) : [];
    const suffixColors = priced?.[2] ? rawColors(priced[2]) : [];
    const ram = configuration ? `${configuration[1]} GB` : null;
    const storage = configuration ? `${configuration[2]} ${configuration[3] ?? "GB"}` : null;
    const add = (color: string | null, pricePkr: string | null, warning?: string) => product.variants.push(materializeVariant(product, {
      source: line, ram, storage, color, pricePkr, ptaStatus: explicitPta, warnings: warning ? [warning] : [],
    }));
    if (!prices.length) (prefixColors.length ? prefixColors : [null]).forEach((color) => add(color, null));
    else if (prices.length === 1) {
      const colors = [...prefixColors, ...suffixColors];
      if (colors.length) colors.forEach((color) => add(color, prices[0]));
      else add(null, prices[0]);
    }
    else if (prices.length === 2 && prefixColors.length && suffixColors.length) {
      prefixColors.forEach((color) => add(color, prices[0]));
      suffixColors.forEach((color) => add(color, prices[1]));
    } else {
      add(null, null, "Ambiguous color-price mapping; needs Owner Review");
      product.warnings.push("Ambiguous color-price mapping; needs Owner Review");
    }
    products.push(product);
    current = product;
  }
  return { format: "rough_text", products, errors };
}

export function parseBulkCatalog(text: string): BulkParseResult {
  const normalized = normalizeInput(text);
  const first = normalized.trimStart().split(/\r?\n/, 1)[0].toLowerCase();
  return first
    .split(",")
    .map((item) => item.trim())
    .includes("product_title") ||
    first
      .split(",")
      .map((item) => item.trim())
      .includes("title")
    ? parseCsv(normalized)
    : parseRough(normalized);
}

export function requiresExplicitPricedVariant(
  existingProduct: boolean,
  variants: BulkVariant[],
) {
  return (
    !existingProduct && !variants.some((variant) => variant.priceMinor !== null)
  );
}
export function applyBatchDefaults(
  products: BulkProduct[],
  defaults: BatchDefaults,
) {
  return products.map((product): BulkProduct => {
    const explicitPtaStatuses = new Set(
      product.variants
        .filter((variant) => variant.ptaSource === "explicit variant override")
        .map((variant) => variant.ptaStatus),
    );
    const mixedPta = explicitPtaStatuses.size > 1;
    const effectivePta =
      product.defaultPtaStatus ?? (!mixedPta ? defaults.ptaStatus : null);
    const effectiveCondition = product.defaultCondition ?? defaults.condition;
    const effectiveWarranty = product.defaultWarranty ?? defaults.warranty;
    const effectiveDelivery =
      product.defaultDeliveryScope ?? defaults.deliveryScope;
    return {
      ...product,
      brand: product.brand || defaults.brand || "",
      brandExplicit: product.brandExplicit || Boolean(defaults.brand),
      category: product.category || defaults.category,
      categoryExplicit: product.categoryExplicit || Boolean(defaults.category),
      defaultPtaStatus: effectivePta,
      defaultPtaSource:
        product.defaultPtaStatus !== null
          ? "Owner supplied explicitly"
          : effectivePta !== null
            ? "batch default"
            : "unresolved",
      defaultCondition: effectiveCondition,
      defaultConditionSource:
        product.defaultCondition !== null
          ? "Owner supplied explicitly"
          : effectiveCondition !== null
            ? "batch default"
            : "unresolved",
      defaultWarranty: effectiveWarranty,
      defaultWarrantySource:
        product.defaultWarranty !== null
          ? "Owner supplied explicitly"
          : effectiveWarranty !== null
            ? "batch default"
            : "unresolved",
      defaultDeliveryScope: effectiveDelivery,
      defaultDeliverySource:
        product.defaultDeliveryScope !== null
          ? "Owner supplied explicitly"
          : effectiveDelivery !== null
            ? "batch default"
            : "unresolved",
      variants: product.variants.map((variant) => {
        const resolve = <T>(
          value: T,
          source: ValueSource,
          productDefault: unknown,
          batchDefault: T | null,
        ) => ({
          value:
            source === "unresolved" && batchDefault != null
              ? batchDefault
              : value,
          source:
            source === "explicit variant override"
              ? ("Owner supplied explicitly" as const)
              : productDefault != null
                ? ("inherited from product" as const)
                : source === "unresolved" && batchDefault != null
                  ? ("inherited from batch default" as const)
                  : ("unresolved" as const),
        });
        const pta = resolve(
          variant.ptaStatus,
          variant.ptaSource,
          product.defaultPtaStatus,
          defaults.ptaStatus,
        );
        const condition = resolve(
          variant.condition,
          variant.conditionSource,
          product.defaultCondition,
          defaults.condition,
        );
        const warranty = resolve(
          variant.warranty,
          variant.warrantySource,
          product.defaultWarranty,
          defaults.warranty,
        );
        const delivery = resolve(
          variant.deliveryScope,
          variant.deliverySource,
          product.defaultDeliveryScope,
          defaults.deliveryScope,
        );
        return {
          ...variant,
          ptaStatus: pta.value,
          ptaSource: pta.source,
          condition: condition.value,
          conditionSource: condition.source,
          warranty: warranty.value,
          warrantySource: warranty.source,
          deliveryScope: delivery.value,
          deliverySource: delivery.source,
          inventory: variant.inventory ?? defaults.inventory,
        };
      }),
    };
  });
}

export function bulkInventoryPreview(
  ownerQuantity: number | null,
  existingVariant: boolean,
) {
  if (ownerQuantity !== null)
    return {
      label: `Inventory: ${ownerQuantity} (Owner supplied)`,
      mode: "owner_supplied" as const,
    };
  if (existingVariant)
    return {
      label: "Inventory: preserve existing",
      mode: "preserve_existing" as const,
    };
  return { label: "Inventory: unresolved", mode: "unresolved" as const };
}

// SKU is not a required fact: new variants get a database-assigned SKU on import and
// existing variants keep theirs.
export function unresolvedVariantFacts(
  variant: BulkVariant,
  options: { existingVariant: boolean },
) {
  const missing: string[] = [];
  if (variant.priceMinor === null || variant.priceMinor <= 0) missing.push("Price");
  if (variant.ptaStatus === "unknown") missing.push("PTA Status");
  if (variant.condition === "unknown") missing.push("Condition");
  if (!variant.warranty?.trim()) missing.push("Warranty");
  if (!variant.deliveryScope) missing.push("Delivery");
  if (
    !options.existingVariant &&
    (variant.inventory === null ||
      !Number.isInteger(variant.inventory) ||
      variant.inventory < 0)
  )
    missing.push("Inventory");
  return missing;
}
export function normalizedPriceDisplay(variant: BulkVariant) {
  return variant.priceMinor === null
    ? "Unresolved"
    : `PKR ${pkrMajorInputFromMinor(variant.priceMinor)}`;
}
