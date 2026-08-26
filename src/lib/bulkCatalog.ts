import { parsePkrMajorToMinor, pkrMajorInputFromMinor } from "./money.ts";

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
  ptaStatus: "approved" | "not_approved" | "not_applicable" | "unknown";
  condition: "brand_new" | "used" | "open_box" | "refurbished" | "unknown";
  warranty: string | null;
  deliveryScope: "karachi_only" | "nationwide" | null;
  inventory: number | null;
  warnings: string[];
};

export type BulkProduct = {
  source: string;
  title: string;
  brand: string;
  category: string | null;
  slug: string | null;
  shortDescription: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  variants: BulkVariant[];
  warnings: string[];
};

export type BulkParseResult = {
  format: "rough_text" | "csv";
  products: BulkProduct[];
  errors: string[];
};

const clean = (value?: string) => value?.trim() || null;
const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function normalizeCapacity(value?: string | null) {
  const match = value
    ?.trim()
    .toUpperCase()
    .match(/^(\d+)\s*(GB|TB)?$/);
  return match ? `${match[1]} ${match[2] ?? "GB"}` : null;
}

function price(value?: string | null) {
  if (!value) return { entered: null, minor: null };
  const normalized = value.trim().toLowerCase().replaceAll(",", "");
  const expanded = normalized.endsWith("k")
    ? `${normalized.slice(0, -1)}000`
    : normalized;
  try {
    const minor = parsePkrMajorToMinor(expanded);
    return { entered: expanded, minor };
  } catch {
    return { entered: value, minor: null };
  }
}

function pta(value?: string | null): BulkVariant["ptaStatus"] {
  const normalized = value?.trim().toLowerCase().replaceAll(" ", "_");
  if (normalized === "pta_approved" || normalized === "official_approved")
    return "approved";
  if (normalized === "non_pta" || normalized === "not_approved")
    return "not_approved";
  if (normalized === "not_applicable") return "not_applicable";
  return "unknown";
}

function condition(value?: string | null): BulkVariant["condition"] {
  const normalized = value?.trim().toLowerCase().replaceAll(" ", "_");
  if (
    normalized &&
    ["brand_new", "used", "open_box", "refurbished"].includes(normalized)
  )
    return normalized as BulkVariant["condition"];
  return "unknown";
}

function delivery(value?: string | null): BulkVariant["deliveryScope"] {
  const normalized = value?.trim().toLowerCase().replaceAll(" ", "_");
  if (normalized && ["karachi_only", "karachi"].includes(normalized))
    return "karachi_only";
  if (normalized === "nationwide") return "nationwide";
  return null;
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
  const rows = csvRows(text);
  const headers = (rows.shift() ?? []).map((header) =>
    header.trim().toLowerCase(),
  );
  const products = new Map<string, BulkProduct>();
  const errors: string[] = [];
  for (const [rowIndex, cells] of rows.entries()) {
    const record = Object.fromEntries(
      headers.map((header, index) => [header, cells[index]?.trim() ?? ""]),
    );
    const title = record.product_title;
    const brand = record.brand;
    if (!title || !brand) {
      errors.push(
        `CSV row ${rowIndex + 2}: product_title and brand are required.`,
      );
      continue;
    }
    const key = `${brand.toLowerCase()}|${title.toLowerCase()}|${record.slug}`;
    let product = products.get(key);
    if (!product) {
      product = {
        source: `CSV row ${rowIndex + 2}`,
        title,
        brand,
        category: clean(record.category),
        slug: clean(record.slug),
        shortDescription: clean(record.short_description),
        seoTitle: clean(record.seo_title),
        seoDescription: clean(record.seo_description),
        variants: [],
        warnings: [],
      };
      products.set(key, product);
    }
    const parsedPrice = price(record.price_pkr);
    const parsedCompare = price(record.compare_at_price_pkr);
    const inventory = clean(record.inventory);
    const quantity =
      inventory !== null && /^-?\d+$/.test(inventory)
        ? Number(inventory)
        : null;
    const warnings: string[] = [];
    if (!parsedPrice.minor) warnings.push("Price missing or invalid");
    if (inventory !== null && quantity === null)
      warnings.push("Inventory must be a whole number");
    product.variants.push({
      source: `CSV row ${rowIndex + 2}`,
      sku: clean(record.sku),
      ram: normalizeCapacity(record.ram),
      storage: normalizeCapacity(record.storage),
      color: clean(record.color),
      pricePkr: parsedPrice.entered,
      priceMinor: parsedPrice.minor,
      compareAtPricePkr: parsedCompare.entered,
      compareAtPriceMinor: parsedCompare.minor,
      ptaStatus: pta(record.pta_status),
      condition: condition(record.condition),
      warranty: clean(record.warranty),
      deliveryScope: delivery(record.delivery_scope),
      inventory: quantity,
      warnings,
    });
  }
  return { format: "csv", products: [...products.values()], errors };
}

function parseRough(text: string): BulkParseResult {
  const blocks = text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean);
  const products: BulkProduct[] = [];
  const errors: string[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const heading = lines.shift();
    if (!heading || !heading.includes(" ")) {
      errors.push(
        `Block ${blockIndex + 1}: expected Brand + Product Title heading.`,
      );
      continue;
    }
    const brand = heading.split(/\s+/)[0];
    const product: BulkProduct = {
      source: heading,
      title: heading,
      brand,
      category: null,
      slug: null,
      shortDescription: null,
      seoTitle: null,
      seoDescription: null,
      variants: [],
      warnings: [],
    };
    let defaultPta: BulkVariant["ptaStatus"] = "unknown";
    let defaultCondition: BulkVariant["condition"] = "unknown";
    let defaultDelivery: BulkVariant["deliveryScope"] = null;
    let defaultWarranty: string | null = null;
    const variantLines: string[] = [];
    for (const line of lines) {
      const pair = line.match(/^(Category|Slug|Warranty)\s*:\s*(.+)$/i);
      if (pair?.[1].toLowerCase() === "category")
        product.category = pair[2].trim();
      else if (pair?.[1].toLowerCase() === "slug")
        product.slug = slugify(pair[2]);
      else if (pair?.[1].toLowerCase() === "warranty")
        defaultWarranty = pair[2].trim();
      else if (/^(PTA Approved|Official Approved)$/i.test(line))
        defaultPta = "approved";
      else if (/^Brand New$/i.test(line)) defaultCondition = "brand_new";
      else if (/^Karachi only$/i.test(line)) defaultDelivery = "karachi_only";
      else if (/^Nationwide$/i.test(line)) defaultDelivery = "nationwide";
      else if (/\d[\d,]*k?$/i.test(line)) variantLines.push(line);
      else product.warnings.push(`Needs Owner Review: ${line}`);
    }
    for (const line of variantLines) {
      const match = line.match(
        /^(?:(\d+)\s*\/\s*)?(\d+)\s*(GB|TB)?\s+(.+?)\s+([\d,]+k?)$/i,
      );
      if (!match) {
        product.warnings.push(`Needs Owner Review: ${line}`);
        continue;
      }
      const parsed = price(match[5]);
      const colors = match[4]
        .split("/")
        .map((color) => color.trim())
        .filter(Boolean);
      for (const color of colors) {
        product.variants.push({
          source: line,
          sku: null,
          ram: normalizeCapacity(match[1]),
          storage: normalizeCapacity(`${match[2]} ${match[3] ?? "GB"}`),
          color,
          pricePkr: parsed.entered,
          priceMinor: parsed.minor,
          compareAtPricePkr: null,
          compareAtPriceMinor: null,
          ptaStatus: defaultPta,
          condition: defaultCondition,
          warranty: defaultWarranty,
          deliveryScope: defaultDelivery,
          inventory: null,
          warnings: parsed.minor ? [] : ["Price missing or invalid"],
        });
      }
    }
    if (!product.variants.length)
      product.warnings.push("No explicit variants parsed");
    products.push(product);
  }
  return { format: "rough_text", products, errors };
}

export function parseBulkCatalog(text: string): BulkParseResult {
  const first = text.trimStart().split(/\r?\n/, 1)[0].toLowerCase();
  return first.split(",").includes("product_title")
    ? parseCsv(text)
    : parseRough(text);
}

export function generatedVariantSku(productSlug: string, variant: BulkVariant) {
  return [productSlug, variant.ram, variant.storage, variant.color]
    .filter(Boolean)
    .map((part) => slugify(String(part)).toUpperCase())
    .join("-");
}

export function normalizedPriceDisplay(variant: BulkVariant) {
  return variant.priceMinor === null
    ? "Unresolved"
    : `PKR ${pkrMajorInputFromMinor(variant.priceMinor)}`;
}
