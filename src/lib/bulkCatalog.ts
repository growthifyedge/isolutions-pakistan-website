import { parsePkrMajorToMinor, pkrMajorInputFromMinor } from "./money.ts";

export type PtaStatus =
  "approved" | "not_approved" | "not_applicable" | "unknown";
export type ProductCondition =
  "brand_new" | "used" | "open_box" | "refurbished" | "unknown";
export type DeliveryScope = "karachi_only" | "nationwide" | null;
export type ValueSource =
  "explicit variant override" | "inherited by variant" | "unresolved";

export type BulkDiagnostic = {
  line: string;
  reason: string;
  classification:
    "preserved Owner note" | "unresolved field" | "Owner Review Required";
  blocksApply: boolean;
};

export type BulkSpecification = {
  source: string;
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
  defaultCondition: ProductCondition | null;
  defaultWarranty: string | null;
  defaultDeliveryScope: DeliveryScope;
  notes: string[];
  specifications: BulkSpecification[];
  diagnostics: BulkDiagnostic[];
  variants: BulkVariant[];
  warnings: string[];
};

export type BulkParseResult = {
  format: "rough_text" | "csv";
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
    brand: title.split(/\s+/)[0] ?? "",
    brandExplicit: false,
    category: null,
    categoryExplicit: false,
    slug: null,
    shortDescription: null,
    seoTitle: null,
    seoDescription: null,
    defaultPtaStatus: null,
    defaultCondition: null,
    defaultWarranty: null,
    defaultDeliveryScope: null,
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
    if (!title || !brand) {
      errors.push(
        `CSV row ${rowIndex + 2}: product_title and brand are required; blocks apply.`,
      );
      continue;
    }
    const key = `${normalizedName(brand)}|${normalizedName(title)}|${clean(record.slug) ?? ""}`;
    let product = products.get(key);
    if (!product) {
      product = makeProduct(title);
      product.source = `CSV row ${rowIndex + 2}`;
      product.brand = brand;
      product.brandExplicit = true;
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
  /^(Brand|Category|Slug|SKU|Price|Compare at|RAM|Storage|Color|PTA|Condition|Warranty|Delivery|Inventory|Stock|Note|Specification|SEO Title|SEO Description|Description)\s*:\s*(.*)$/i;

function parseRough(text: string): BulkParseResult {
  const normalized = normalizeInput(text).replace(/\r\n?/g, "\n").trim();
  const blocks = normalized.split(/\n\s*\n+/).filter((block) => block.trim());
  const products: BulkProduct[] = [];
  const errors: string[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const heading = lines.shift();
    if (!heading) continue;
    if (labelPattern.test(heading)) {
      errors.push(
        `Block ${blockIndex + 1}: missing product title before "${heading}"; blocks apply.`,
      );
      continue;
    }
    const product = makeProduct(heading);
    const labeledDraft: VariantDraft = { source: `${heading} labeled fields` };
    const commercialLines: string[] = [];
    let hasLabeledVariant = false;
    for (const sourceLine of lines) {
      const pair = sourceLine.match(labelPattern);
      if (pair) {
        const label = normalizedName(pair[1]);
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
        if (label === "brand") {
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
            "compare at",
            "ram",
            "storage",
            "color",
            "inventory",
            "stock",
          ].includes(label)
        ) {
          hasLabeledVariant = true;
          if (label === "sku") labeledDraft.sku = value;
          else if (label === "price") labeledDraft.pricePkr = value;
          else if (label === "compare at")
            labeledDraft.compareAtPricePkr = value;
          else if (label === "ram") labeledDraft.ram = value;
          else if (label === "storage") labeledDraft.storage = value;
          else if (label === "color") labeledDraft.color = value;
          else {
            const parsed = inventory(value);
            labeledDraft.inventory = parsed;
            if (parsed === null)
              (labeledDraft.warnings ??= []).push(
                "Inventory must be a non-negative whole number",
              );
          }
        } else if (label === "pta") {
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
        } else if (label === "delivery") {
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
    if (!product.variants.length)
      addDiagnostic(
        product,
        heading,
        "No explicit priced variant parsed",
        "unresolved field",
        true,
      );
    products.push(product);
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

export function generatedVariantSku(productSlug: string, variant: BulkVariant) {
  return [productSlug, variant.sku, variant.ram, variant.storage, variant.color]
    .filter(Boolean)
    .map((part) => slugify(String(part)).toUpperCase())
    .join("-");
}

export function normalizedPriceDisplay(variant: BulkVariant) {
  return variant.priceMinor === null
    ? "Unresolved"
    : `PKR ${pkrMajorInputFromMinor(variant.priceMinor)}`;
}
