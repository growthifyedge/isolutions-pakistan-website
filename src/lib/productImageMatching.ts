/**
 * Bulk Product Images — matching and review (pure; no network, no database).
 *
 * Image sources (local files or Shopify export products) are matched to existing
 * catalog products by Brand + Model/title. Only an identical normalized key is an
 * automatic "matched"; anything that needs noise words removed is "review", and
 * nothing is ever prefix- or fuzzy-matched (X5c vs X5c+, Note 15 Pro vs Pro+,
 * Phone 3A vs 3A Lite are different products).
 */
import { MAX_SOURCE_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES } from "./cloudinary.ts";
import { canonicalModel, catalogSlug } from "./catalogSheet.ts";

export type CatalogImageProduct = {
  id: string;
  title: string;
  brand: string | null;
  hasPrimary: boolean;
};

export type ImageSource = {
  id: string;
  /** Filename or Shopify title/handle shown in the review table. */
  label: string;
  /** Texts that may produce an automatic match when their key is identical to a product key. */
  texts: string[];
  /** Inferred texts (e.g. brand guessed from a model family); can only ever produce "review". */
  reviewTexts?: string[];
  invalidReason?: string | null;
};

export type ImageMatchStatus = "matched" | "review" | "multiple" | "conflict" | "unmatched" | "invalid";

export type ImageMatchRow = {
  sourceId: string;
  label: string;
  status: ImageMatchStatus;
  detectedBrand: string | null;
  detectedModel: string;
  /** The matched or suggested product (null when unmatched / multiple / invalid). */
  productId: string | null;
  candidateProductIds: string[];
  productHasPrimary: boolean;
  /** Only clean, unique matches for products without a primary image start selected. */
  defaultSelected: boolean;
  reason: string;
};

// Words removed (on both sides) only for the "review" tier. Deliberately narrow:
// model words such as Lite / Pro / Plus / New / Onyx / Edge are never noise.
const FAMILY_WORDS = ["galaxy", "redmi", "poco"];
const NETWORK_WORDS = ["4g", "5g"];
const COMMERCIAL_WORDS = ["pta", "approved", "non", "official", "warranty", "box", "pack", "packed", "sealed", "dual", "sim"];
const COLOR_WORDS = [
  "black", "white", "silver", "grey", "gray", "green", "blue", "purple", "pink", "orange", "gold",
  "red", "yellow", "titanium", "graphite", "midnight", "starlight", "cream", "mint", "lavender", "violet",
];
const NOISE_WORDS = new Set([...FAMILY_WORDS, ...NETWORK_WORDS, ...COMMERCIAL_WORDS, ...COLOR_WORDS]);

// Model families that name a brand without the brand being written (mirrors the
// importer's MODEL_FAMILY_BRANDS). Used only to build review-tier texts.
const FAMILY_BRANDS: Record<string, string> = {
  galaxy: "Samsung",
  redmi: "Xiaomi",
  poco: "Xiaomi",
  iphone: "Apple",
  ipad: "Apple",
  macbook: "Apple",
  airpods: "Apple",
  pixel: "Google",
};

const collapse = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

/** Filename without extension and without browser/OS copy markers ("(1)", " - Copy"). */
export function imageFileStem(fileName: string) {
  return collapse(fileName)
    .replace(/\.(?:jpe?g|png|webp|avif|gif|heic|heif|bmp|tiff?)$/i, "")
    .replace(/(?:\s*-\s*copy|\s+copy)?(?:\s*\(\d+\))?$/i, "")
    .trim();
}

/** Exact identity key: case-insensitive; spaces, hyphens, underscores and dots are equivalent; "+" = "plus". */
export function imageMatchKey(text: string) {
  return catalogSlug(collapse(text).replace(/_/g, " "));
}

/** Review-tier key: also drops bracketed specs, RAM/storage, 4G/5G, PTA/warranty, colour and family words. */
export function imageReviewKey(text: string) {
  const stripped = collapse(text)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    // RAM/storage: "8GB/256GB", "8/256", "8/256GB", "4+8GB" (no spaces around "+", so a
    // model's own "+" as in "Phone 3+ 128GB" survives), then any lone "128GB".
    .replace(/\b\d+\s*(?:gb|tb)\s*[/+]\s*\d+\s*(?:gb|tb)\b/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\s*(?:gb|tb)?\b/g, " ")
    .replace(/\b\d+\+\d+\s*(?:gb|tb)?\b/g, " ")
    .replace(/\b\d+\s*(?:gb|tb)\b/g, " ");
  const tokens = catalogSlug(stripped).split("-").flatMap(splitGluedToken);
  return tokens
    // Samsung's "Z" family marker ("Samsung Galaxy Z Fold 6") is dropped like "Galaxy",
    // but only right after Samsung / Galaxy, never as a general noise word.
    .filter((token, index) => !(token === "z" && (tokens[index - 1] === "samsung" || tokens[index - 1] === "galaxy")))
    .filter((token) => token && !NOISE_WORDS.has(token))
    .join("-");
}

// Joined model tokens, split for the review tier only: "2pro" → 2 pro, "17tpro" → 17t pro
// (same suffix words as the importer's canonicalModel), "flip5" → flip 5, "fold6" → fold 6.
const GLUED_SUFFIX = /^([a-z]*\d+[a-z]?)(pro|max|plus|ultra|lite|mini|neo|prime|fe)$/;
const GLUED_FAMILY = /^(flip|fold|note|reno|camon|spark|phone)(\d+[a-z]?)$/;
function splitGluedToken(token: string): string[] {
  const family = GLUED_FAMILY.exec(token);
  if (family) return [family[1], ...splitGluedToken(family[2])];
  const suffix = GLUED_SUFFIX.exec(token);
  return suffix ? [suffix[1], suffix[2]] : [token];
}

/** Validates a local image's declared type and size (contents are checked again before upload). */
export function imageFileProblem(file: { name: string; type: string; size: number }) {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number]))
    return "Use a JPEG, PNG, WebP, or AVIF image.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_SOURCE_IMAGE_BYTES) return "The source image must be 25 MB or smaller.";
  return null;
}

export function localImageSources(files: { name: string; type: string; size: number }[]): ImageSource[] {
  return files.map((file, index) => ({
    id: `file:${index}:${file.name}`,
    label: file.name,
    texts: [imageFileStem(file.name)],
    invalidReason: imageFileProblem(file),
  }));
}

/** Review-only text that prefixes a brand implied by a model family word ("Galaxy A07" → "Samsung Galaxy A07"). */
export function familyBrandText(text: string, brands: string[]) {
  const first = imageMatchKey(text).split("-")[0];
  const brand = FAMILY_BRANDS[first];
  if (!brand) return null;
  const catalogBrand = brands.find((candidate) => candidate.toLowerCase() === brand.toLowerCase());
  return catalogBrand ? `${catalogBrand} ${text}` : null;
}

export function detectBrandAndModel(text: string, brands: string[]) {
  const display = collapse(text.replace(/[_-]+/g, " "));
  const key = imageMatchKey(display);
  const brand = [...brands]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => {
      const brandKey = imageMatchKey(candidate);
      return brandKey && (key === brandKey || key.startsWith(`${brandKey}-`));
    });
  if (!brand) return { brand: null, model: canonicalModel(display) };
  const brandWords = collapse(brand).split(" ").length;
  return { brand, model: canonicalModel(display.split(" ").slice(brandWords).join(" ")) };
}

function productKeys(product: CatalogImageProduct) {
  const texts = [product.title];
  if (product.brand && !imageMatchKey(product.title).startsWith(`${imageMatchKey(product.brand)}-`))
    texts.push(`${product.brand} ${product.title}`);
  return {
    exact: texts.map(imageMatchKey).filter(Boolean),
    review: texts.map(imageReviewKey).filter(Boolean),
  };
}

function addToIndex(index: Map<string, Set<string>>, key: string, productId: string) {
  index.set(key, (index.get(key) ?? new Set()).add(productId));
}

function lookup(index: Map<string, Set<string>>, keys: string[]) {
  const ids = new Set<string>();
  for (const key of keys) for (const id of index.get(key) ?? []) ids.add(id);
  return [...ids];
}

/** Matches every source to at most one product. Reads nothing and writes nothing. */
export function matchImageSources(sources: ImageSource[], products: CatalogImageProduct[]): ImageMatchRow[] {
  const exactIndex = new Map<string, Set<string>>();
  const reviewIndex = new Map<string, Set<string>>();
  for (const product of products) {
    const keys = productKeys(product);
    keys.exact.forEach((key) => addToIndex(exactIndex, key, product.id));
    keys.review.forEach((key) => addToIndex(reviewIndex, key, product.id));
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  const brands = [...new Set(products.map((product) => product.brand).filter((brand): brand is string => Boolean(brand)))];

  const rows: ImageMatchRow[] = sources.map((source) => {
    const detected = detectBrandAndModel(source.texts[0] ?? source.label, brands);
    const base = {
      sourceId: source.id,
      label: source.label,
      detectedBrand: detected.brand,
      detectedModel: detected.model,
      productId: null,
      candidateProductIds: [] as string[],
      productHasPrimary: false,
      defaultSelected: false,
    };
    if (source.invalidReason) return { ...base, status: "invalid", reason: source.invalidReason };

    const exactIds = lookup(exactIndex, source.texts.map(imageMatchKey).filter(Boolean));
    if (exactIds.length === 1)
      return { ...base, status: "matched", productId: exactIds[0], candidateProductIds: exactIds, reason: "Brand and model match exactly." };
    if (exactIds.length > 1)
      return { ...base, status: "multiple", candidateProductIds: exactIds, reason: "More than one product has this exact name." };

    const reviewKeys = [...source.texts, ...(source.reviewTexts ?? [])].map(imageReviewKey).filter(Boolean);
    const reviewIds = lookup(reviewIndex, reviewKeys);
    if (reviewIds.length === 1)
      return {
        ...base,
        status: "review",
        productId: reviewIds[0],
        candidateProductIds: reviewIds,
        reason: "Suggested match after ignoring storage, colour, network, PTA or family words — confirm before upload.",
      };
    if (reviewIds.length > 1)
      return { ...base, status: "multiple", candidateProductIds: reviewIds, reason: "Several products could match — choose one." };
    return { ...base, status: "unmatched", reason: "No product with this brand and model." };
  }) as ImageMatchRow[];

  // Two or more sources pointing at one product: none is chosen automatically.
  const targets = new Map<string, ImageMatchRow[]>();
  for (const row of rows)
    if (row.productId && (row.status === "matched" || row.status === "review"))
      targets.set(row.productId, [...(targets.get(row.productId) ?? []), row]);
  for (const group of targets.values())
    if (group.length > 1)
      for (const row of group) {
        row.status = "conflict";
        row.reason = `${group.length} images target this product — choose one.`;
      }

  for (const row of rows) {
    row.productHasPrimary = Boolean(row.productId && byId.get(row.productId)?.hasPrimary);
    row.defaultSelected = row.status === "matched" && !row.productHasPrimary;
  }
  return rows;
}

export function summarizeImageMatches(rows: ImageMatchRow[], selectedSourceIds?: Iterable<string>) {
  const selected = new Set(selectedSourceIds ?? rows.filter((row) => row.defaultSelected).map((row) => row.sourceId));
  return {
    total: rows.length,
    matched: rows.filter((row) => row.status === "matched").length,
    needsReview: rows.filter((row) => row.status === "review" || row.status === "multiple" || row.status === "conflict").length,
    unmatched: rows.filter((row) => row.status === "unmatched").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    readyToUpload: rows.filter((row) => selected.has(row.sourceId) && row.status !== "invalid").length,
  };
}

export type ImageAssignmentChoice = {
  /** Product the Owner confirmed for this source (may differ from the suggestion). */
  productId: string;
  /** Explicit Owner choice for a product that already has a primary image. */
  addAndMakePrimary?: boolean;
};

export type ImageAssignmentItem = {
  sourceId: string;
  productId: string;
  /** "primary": product has no primary → new image becomes primary. "make_primary": explicit Owner replace. */
  primaryMode: "primary" | "make_primary";
};

/**
 * Turns the Owner's selections into an upload plan. Validates only; performs no I/O.
 * Products that already have a primary image are skipped unless explicitly chosen.
 */
export function buildImageAssignmentPlan(
  rows: ImageMatchRow[],
  choices: Record<string, ImageAssignmentChoice>,
  products: CatalogImageProduct[],
) {
  const rowById = new Map(rows.map((row) => [row.sourceId, row]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const items: ImageAssignmentItem[] = [];
  const skipped: { sourceId: string; productId: string; reason: string }[] = [];
  const problems: string[] = [];
  const claimed = new Map<string, string>();

  for (const [sourceId, choice] of Object.entries(choices)) {
    const row = rowById.get(sourceId);
    const product = productById.get(choice.productId);
    if (!row) {
      problems.push(`Unknown image ${sourceId}.`);
      continue;
    }
    if (row.status === "invalid") {
      problems.push(`${row.label}: ${row.reason}`);
      continue;
    }
    if (!product) {
      problems.push(`${row.label}: choose an existing product.`);
      continue;
    }
    const other = claimed.get(product.id);
    if (other) {
      problems.push(`${product.title}: more than one image selected (${rowById.get(other)?.label} and ${row.label}). Keep only one.`);
      continue;
    }
    claimed.set(product.id, sourceId);
    if (product.hasPrimary && !choice.addAndMakePrimary) {
      skipped.push({ sourceId, productId: product.id, reason: "Product already has a primary image." });
      continue;
    }
    items.push({ sourceId, productId: product.id, primaryMode: product.hasPrimary ? "make_primary" : "primary" });
  }
  return { items, skipped, problems };
}
