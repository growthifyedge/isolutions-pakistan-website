/**
 * Source-conflict comparator for the Legacy Shopify Specification Migration.
 * Several Shopify Handles can target the same iSolutions product (a "Conflict"). Instead of a flat row per Handle, this groups
 * them per product, compares them side by side, and proposes a deterministic recommendation. It NEVER selects anything:
 * choosing a source stays an Owner action (existing `chooseSourceSet`). Pure and local; no I/O.
 */
import { reviewSetStates, type BulkImageCatalogProduct, type BulkImageReview } from "./bulkProductImagesReview.ts";
import { extractSpecifications, htmlToText, textUnits, type ExtractionResult, type ShopifyDescription } from "./productSpecificationExtraction.ts";

export type KeyFields = { chipset: string | null; displaySize: string | null; battery: string | null; charging: string | null; os: string | null; camera: string | null };

export type ConflictSource = {
  setId: string;
  handle: string;
  shopifyTitle: string;
  shopifyStatus: string | null;
  imageCount: number;
  bodyChars: number;
  preview: string;
  specCount: number;
  high: number;
  review: number;
  conflicts: number;
  key: KeyFields;
  exactTitle: boolean;
  modelTokens: boolean;
};

export type SourceRecommendation = { setId: string; handle: string; reason: string } | null;

export type ConflictGroup = {
  productId: string;
  productTitle: string;
  sources: ConflictSource[];
  /** Best-ranked source (always set when there are sources) with whether the ranking is clear enough to offer one-click use. */
  recommendation: SourceRecommendation;
  safe: boolean;
  /** Shown when no safe recommendation exists. */
  note: string;
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const tokens = (value: string, brand: string | null) => {
  const brandKey = brand ? normalize(brand) : "";
  return value
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token && normalize(token) !== brandKey)
    .sort()
    .join("|");
};

const keyFields = (result: ExtractionResult): KeyFields => {
  const value = (name: string) => result.specs.find((spec) => spec.name === name)?.value ?? null;
  const camera = [value("Main Camera"), value("Ultrawide Camera") && `${value("Ultrawide Camera")} ultrawide`, value("Telephoto Camera") && `${value("Telephoto Camera")} tele`, value("Front Camera") && `${value("Front Camera")} front`].filter(Boolean);
  const charging = [value("Wired Charging"), value("Wireless Charging") && `${value("Wireless Charging")} wireless`].filter(Boolean);
  return {
    chipset: value("Chipset"),
    displaySize: value("Screen Size"),
    battery: value("Battery Capacity"),
    charging: charging.length ? charging.join(", ") : null,
    os: [value("Operating System"), value("UI")].filter(Boolean).join(" · ") || null,
    camera: camera.length ? camera.join(", ") : null,
  };
};

const preview = (html: string) => {
  const first = textUnits(htmlToText(html)).find((unit) => unit.length > 25) ?? "";
  return first.length > 150 ? `${first.slice(0, 147)}…` : first;
};

/** Conflict sets grouped per target product, each source with its extraction counts. */
export function buildConflictGroups(review: BulkImageReview, catalog: BulkImageCatalogProduct[], descriptions: ReadonlyMap<string, ShopifyDescription>): ConflictGroup[] {
  const states = reviewSetStates(review, catalog);
  const byProduct = new Map<string, typeof review.sets>();
  for (const set of review.sets) {
    const state = states.get(set.setId);
    if (state?.status === "conflict" && state.targetId && set.handle) byProduct.set(state.targetId, [...(byProduct.get(state.targetId) ?? []), set]);
  }
  const groups: ConflictGroup[] = [];
  for (const [productId, sets] of byProduct) {
    const product = catalog.find((entry) => entry.id === productId);
    if (!product) continue;
    const sources = sets.map((set): ConflictSource => {
      const description = descriptions.get(set.handle!);
      const shopifyTitle = description?.title || set.title;
      const result = extractSpecifications({ productTitle: product.title, shopifyTitle, bodyHtml: description?.bodyHtml ?? "", metafields: description?.metafields ?? {} });
      const high = result.specs.filter((spec) => spec.confidence === "High").length;
      return {
        setId: set.setId,
        handle: set.handle!,
        shopifyTitle,
        shopifyStatus: set.shopifyStatus,
        imageCount: set.images.length,
        bodyChars: htmlToText(description?.bodyHtml ?? "").length,
        preview: preview(description?.bodyHtml ?? ""),
        specCount: result.specs.length,
        high,
        review: result.specs.length - high,
        conflicts: result.conflicts.length,
        key: keyFields(result),
        exactTitle: normalize(shopifyTitle) === normalize(product.title) || (product.brand ? normalize(`${product.brand} ${shopifyTitle}`) === normalize(product.title) : false),
        modelTokens: tokens(shopifyTitle, product.brand) === tokens(product.title, product.brand),
      };
    });
    groups.push({ productId, productTitle: product.title, sources, ...recommend(sources) });
  }
  return groups.sort((a, b) => a.productTitle.localeCompare(b.productTitle));
}

/** Key facts both sources state but with different values: they may describe different devices, so a count-based pick is not safe. */
export function disagreements(a: ConflictSource, b: ConflictSource): string[] {
  const fields: (keyof KeyFields)[] = ["chipset", "displaySize", "battery", "charging"];
  return fields.filter((field) => a.key[field] && b.key[field] && normalize(a.key[field]!) !== normalize(b.key[field]!));
}

const rankKey = (source: ConflictSource) => [source.exactTitle ? 1 : 0, source.modelTokens ? 1 : 0, source.specCount, -source.conflicts, source.bodyChars, source.imageCount];

function compareRank(a: ConflictSource, b: ConflictSource) {
  const left = rankKey(a);
  const right = rankKey(b);
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return right[index] - left[index];
  return a.handle.localeCompare(b.handle);
}

/**
 * Deterministic recommendation, in order: exact normalised title, exact model-token match, more directly supported specs,
 * fewer internal conflicts, fuller Body HTML, more images. It is SAFE only when it wins at a decisive step: a unique exact
 * title or model-token match, or clearly more extractable specs (margin of at least 5 and 30%) without more internal conflicts
 * AND without contradicting the other sources on chipset, display size, battery or charging (different key facts can mean different
 * devices). Otherwise there is "No safe recommendation" and the Owner decides.
 */
export function recommend(sources: ConflictSource[]): Pick<ConflictGroup, "recommendation" | "safe" | "note"> {
  if (sources.length === 0) return { recommendation: null, safe: false, note: "No sources." };
  const ranked = [...sources].sort(compareRank);
  const best = ranked[0];
  const rest = ranked.slice(1);
  const detail = `${best.specCount} extractable specs, ${best.conflicts} internal conflicts`;
  const uniqueExact = best.exactTitle && !rest.some((source) => source.exactTitle);
  if (uniqueExact) return { recommendation: { setId: best.setId, handle: best.handle, reason: `exact title match, ${detail}.` }, safe: true, note: "" };
  const uniqueTokens = !best.exactTitle && best.modelTokens && !rest.some((source) => source.modelTokens || source.exactTitle);
  if (uniqueTokens) return { recommendation: { setId: best.setId, handle: best.handle, reason: `exact model-token match, ${detail}.` }, safe: true, note: "" };
  const peers = rest.filter((source) => source.exactTitle === best.exactTitle && source.modelTokens === best.modelTokens);
  const runnerUp = peers[0];
  if (runnerUp) {
    const margin = best.specCount - runnerUp.specCount;
    const contradictions = [...new Set(peers.flatMap((peer) => disagreements(best, peer)))];
    const clear = margin >= 5 && margin >= Math.ceil(best.specCount * 0.3) && best.conflicts <= runnerUp.conflicts && contradictions.length === 0;
    if (clear) return { recommendation: { setId: best.setId, handle: best.handle, reason: `titles tie; ${detail} vs ${runnerUp.specCount} in ${runnerUp.handle}.` }, safe: true, note: "" };
    return {
      recommendation: {
        setId: best.setId,
        handle: best.handle,
        reason: contradictions.length
          ? `best-ranked only (${detail}); the sources state different ${contradictions.join(", ")}, so they may be different devices.`
          : `best-ranked only (${detail}); too close to ${runnerUp.handle} (${runnerUp.specCount} specs, ${runnerUp.conflicts} conflicts) to recommend.`,
      },
      safe: false,
      note: contradictions.length ? "No safe recommendation — the sources contradict each other. Compare them below and choose." : "No safe recommendation — the sources are too similar. Compare them below and choose.",
    };
  }
  return { recommendation: { setId: best.setId, handle: best.handle, reason: `${detail}.` }, safe: false, note: "No safe recommendation." };
}
