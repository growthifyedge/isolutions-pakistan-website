import type { CatalogFilters, CatalogVariant } from "./catalog";

export type PublicTaxonomy = {
  brands: { id: string; name: string; slug: string }[];
  categories: { id: string; name: string; slug: string }[];
};

export const collectionNavigation = [
  { label: "Shop all", href: "/shop" },
  { label: "MacBook", href: "/collections/macbook" },
  { label: "iPad", href: "/collections/ipad" },
  { label: "Mobile Phones", href: "/collections/mobile-phones" },
  { label: "Mobile Accessories", href: "/collections/mobile-accessories" },
  { label: "Home Gadgets", href: "/collections/home-gadgets" },
] as const;

/**
 * The 14 configured Mobile Phones brands (Owner decision: Option B — every brand stays visible,
 * with or without published products). Shared by the desktop dropdown and the mobile drawer.
 * iPhone uses the canonical brand slug `apple`.
 */
export const mobilePhoneBrands = [
  { label: "Samsung", slug: "samsung" },
  { label: "Infinix", slug: "infinix" },
  { label: "Oppo", slug: "oppo" },
  { label: "Vivo", slug: "vivo" },
  { label: "Tecno", slug: "tecno" },
  { label: "iPhone", name: "Apple", slug: "apple" },
  { label: "Xiaomi", slug: "xiaomi" },
  { label: "Motorola", slug: "motorola" },
  { label: "Honor", slug: "honor" },
  { label: "Nothing", slug: "nothing" },
  { label: "Google", slug: "google" },
  { label: "Realme", slug: "realme" },
  { label: "itel", slug: "itel" },
  { label: "OnePlus", slug: "oneplus" },
] as const;

/** The Mobile Phones category slug used by search_public_catalog's p_category_slugs (via /shop?category=). */
export const MOBILE_PHONES_CATEGORY_SLUG = "mobile-phones";

/**
 * Existing /shop workflow: brand + Mobile Phones category, so only phones of that brand are returned.
 * iPhone (apple) keeps its existing collection with the New / Used tabs (Owner decision).
 */
export const mobilePhoneBrandHref = (slug: string) =>
  slug === "apple"
    ? "/collections/mobile-phones/iphone"
    : `/shop?brand=${encodeURIComponent(slug)}&category=${MOBILE_PHONES_CATEGORY_SLUG}`;

/**
 * Readable brand name for a /shop brand slug: the published taxonomy name first, then the configured
 * Mobile Phones brand name (brands with no published products are not in the taxonomy), else the slug as given.
 */
export function brandDisplayName(slug: string, brands: PublicTaxonomy["brands"]) {
  const published = brands.find((brand) => brand.slug === slug);
  if (published) return published.name;
  const configured = mobilePhoneBrands.find((brand) => brand.slug === slug);
  if (configured) return "name" in configured ? configured.name : configured.label;
  return slug;
}

/**
 * Owner decision 2026-11-06: these 16 PROD watches / bands stay in the Gadgets category (database unchanged) and are
 * ALSO shown in the Mobile Accessories collection and the homepage Accessories section. Matched by product ID only
 * (never by title or SKU). They stay in Home Gadgets too. On DEV these IDs do not exist, so nothing extra is shown.
 */
export const ACCESSORIES_EXTRA_PRODUCT_IDS: readonly string[] = [
  "e245d592-6097-44e2-86a3-e1f7afb9b055", // GD010 Samsung Watch 7 44mm
  "6beb8e57-46af-4bc0-bca2-5293bfdf144f", // GD011, GD012 Samsung Watch 8 40mm
  "1f3b18d9-3064-4457-b712-79c9e4aa203b", // GD013 Samsung Watch 8 44mm
  "c8483496-686f-445d-ac4c-e7d2814704c5", // GD014, GD015 Samsung Watch 8 Classic 46mm
  "4b8e430b-8043-489a-a11c-cacbc31a2950", // GD016 Samsung Watch 9 40mm
  "1b81a159-b2a7-4695-9a80-b85435640b59", // GD017 Samsung Watch 9 44mm
  "b5dfa4b2-4c45-4197-8b2e-7f18051e864d", // GD018, GD019 Huawei Band 11 Pro
  "0a662a77-fdb0-4b1e-bfa6-4232b68664af", // GD020 Huawei Watch Fit 5
  "ab3dabed-9603-4eb4-8b12-e949f50cea91", // GD021 Huawei Watch Gt6 Pro
  "f383964b-5883-4603-b367-59dce354b6a9", // GD022 Kieslect Ks Mini Calling Watch
  "957734b6-1b8c-48fa-8547-6d87e981794f", // GD023, GD024 Amazfit Bip 6
  "6634a65b-e7cd-4e95-961f-fa219bd4001e", // GD025 Redmi Band 11 Active
  "e2dba72b-c9f3-41b6-bd2a-cffc537798a4", // GD026 Mi Band 10 Pro
  "c8fbdb14-3326-45dd-83e4-225c23af8ad9", // GD027, GD028, GD029 Redmi Watch 6
  "60c95b02-1f78-41b6-95a7-f30078d7db9a", // GD030 Mi Watch S5
  "f9337ea1-360b-446c-9046-867ec0df6186", // GD031 Cmf By Nothing Watch Pro 3
];

/**
 * Owner decision 2026-11-06: the approved Mi / Redmi Official products among the extras have no brand in the database
 * (left unchanged); for the homepage Accessories brand tabs only, they count as Xiaomi. Matched by product ID only.
 */
export const ACCESSORIES_EXTRA_DISPLAY_BRAND: Readonly<Record<string, string>> = {
  "6634a65b-e7cd-4e95-961f-fa219bd4001e": "xiaomi", // GD025 Redmi Band 11 Active
  "e2dba72b-c9f3-41b6-bd2a-cffc537798a4": "xiaomi", // GD026 Mi Band 10 Pro
  "c8fbdb14-3326-45dd-83e4-225c23af8ad9": "xiaomi", // GD027-GD029 Redmi Watch 6
  "60c95b02-1f78-41b6-95a7-f30078d7db9a": "xiaomi", // GD030 Mi Watch S5
};

/** Label shown on product cards for the extras inside the Mobile Accessories collection (Home Gadgets keeps Gadgets). */
export const ACCESSORIES_EXTRA_CARD_CATEGORY = "Accessories";

/** Homepage Accessories brand tab: the product's own brand, or (extras only) its Owner-approved display brand. */
export function accessoryMatchesBrandTab(product: { id: string; brand: { slug: string } | null }, brandSlug: string) {
  return product.brand?.slug === brandSlug || ACCESSORIES_EXTRA_DISPLAY_BRAND[product.id] === brandSlug;
}

/**
 * Extra products a collection also shows: fetched from `categories`, kept only when their ID is listed.
 * `baseCategory` false = the collection's own category is not published yet, so its own list must NOT be fetched
 * (its category filter would be empty, which means every product). `cardCategory` = card label for the extras.
 */
export type CollectionExtraProducts = { categories: string[]; productIds: readonly string[]; baseCategory: boolean; cardCategory: string };

/** The collection's own list is fetched only when it has its own category or is not an extras-only collection. */
export const shouldFetchCollectionBase = (collection: Pick<ResolvedCollection, "extraProducts">) =>
  !collection.extraProducts || collection.extraProducts.baseCategory;

export type ResolvedCollection = {
  slug: string;
  title: string;
  description: string;
  breadcrumbs: { label: string; href?: string }[];
  filters: CatalogFilters & Required<Pick<CatalogFilters, "categories" | "brands">>;
  condition?: CatalogVariant["condition"];
  available: boolean;
  mobilePhones: boolean;
  activeBrand?: string;
  excludeBrands?: string[];
  deals?: boolean;
  bestSellers?: boolean;
  bundleTerms?: string[];
  extraProducts?: CollectionExtraProducts;
  /** Products this collection never shows (by product ID), even though its filters return them. */
  excludeProductIds?: readonly string[];
};

/**
 * The collection's own products first (their order kept), then the listed extra products in their fetched order.
 * An extra is kept only if its ID is listed; a product already in the base list is never repeated.
 */
export function mergeCollectionExtras<T extends { id: string }>(base: readonly T[], extras: readonly T[], productIds: readonly string[]): T[] {
  const allowed = new Set(productIds);
  const seen = new Set(base.map((product) => product.id));
  const merged = [...base];
  for (const product of extras) {
    if (!allowed.has(product.id) || seen.has(product.id)) continue;
    seen.add(product.id);
    merged.push(product);
  }
  return merged;
}

const comparable = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function taxonomySlug(
  items: { name: string; slug: string }[],
  aliases: string[],
) {
  const wanted = new Set(aliases.map(comparable));
  return items.find(
    (item) => wanted.has(comparable(item.slug)) || wanted.has(comparable(item.name)),
  )?.slug;
}

function mobileCategory(taxonomy: PublicTaxonomy) {
  return taxonomySlug(taxonomy.categories, [
    "mobile-phones",
    "mobile phones",
    "smartphones",
    "smartphone",
    "phones",
  ]);
}

function appleBrand(taxonomy: PublicTaxonomy) {
  return taxonomySlug(taxonomy.brands, ["apple", "iphone"]);
}

function topLevelCollection(
  slug: string,
  taxonomy: PublicTaxonomy,
): ResolvedCollection | null {
  const base = {
    slug,
    breadcrumbs: [{ label: "Home", href: "/" }],
    condition: undefined,
    mobilePhones: false,
    activeBrand: undefined,
  };

  if (slug === "mobile-phones") {
    const category = mobileCategory(taxonomy);
    return {
      ...base,
      title: "Mobile Phones",
      description: "Explore mobile phones from leading brands.",
      breadcrumbs: [...base.breadcrumbs, { label: "Mobile Phones" }],
      filters: { categories: category ? [category] : [], brands: [] },
      available: Boolean(category),
      mobilePhones: true,
    };
  }

  if (slug === "macbook") {
    const exactCategory = taxonomySlug(taxonomy.categories, ["macbook", "macbooks"]);
    const category =
      exactCategory ?? taxonomySlug(taxonomy.categories, ["laptops", "laptop"]);
    const brand = appleBrand(taxonomy);
    return {
      ...base,
      title: "MacBook",
      description: "Explore published MacBook models selected for work and everyday use.",
      breadcrumbs: [...base.breadcrumbs, { label: "MacBook" }],
      filters: {
        categories: category ? [category] : [],
        brands: brand ? [brand] : [],
      },
      available: Boolean(category && brand),
    };
  }

  if (slug === "ipad") {
    const category = taxonomySlug(taxonomy.categories, [
      "ipad",
      "ipads",
      "tablets",
      "tablet",
    ]);
    const brand = appleBrand(taxonomy);
    return {
      ...base,
      title: "iPad",
      description: "Explore published iPad models.",
      breadcrumbs: [...base.breadcrumbs, { label: "iPad" }],
      filters: {
        categories: category ? [category] : [],
        brands: brand ? [brand] : [],
      },
      available: Boolean(category && brand),
    };
  }

  const simpleCollections = {
    "mobile-accessories": {
      title: "Mobile Accessories",
      description: "Explore accessories for your everyday devices.",
      aliases: ["mobile-accessories", "mobile accessories", "phone-accessories"],
    },
    "home-gadgets": {
      title: "Home Gadgets",
      description: "Explore practical technology for modern homes.",
      aliases: ["home-gadgets", "home gadgets", "smart-home", "home-technology", "gadgets"],
    },
  } as const;
  const definition =
    simpleCollections[slug as keyof typeof simpleCollections];
  if (!definition) return null;
  const category = taxonomySlug(taxonomy.categories, [...definition.aliases]);
  return {
    ...base,
    title: definition.title,
    description: definition.description,
    breadcrumbs: [...base.breadcrumbs, { label: definition.title }],
    filters: { categories: category ? [category] : [], brands: [] },
    available: Boolean(category),
    // Owner decision 2026-11-06: the 16 watches / bands are shown only in Mobile Accessories, not in Home Gadgets
    // (main page and its type pages). Their database category stays Gadgets; product pages are unaffected.
    ...(slug === "home-gadgets" ? { excludeProductIds: ACCESSORIES_EXTRA_PRODUCT_IDS } : {}),
  };
}

/** The collection's products without the IDs it hides (order kept). */
export function withoutExcludedProducts<T extends { id: string }>(products: readonly T[], excludeProductIds: readonly string[] | undefined): T[] {
  if (!excludeProductIds?.length) return [...products];
  const hidden = new Set(excludeProductIds);
  return products.filter((product) => !hidden.has(product.id));
}

export function resolveCollection(
  pathname: string,
  taxonomy: PublicTaxonomy,
  search = "",
): ResolvedCollection | null {
  const parts = pathname
    .replace(/^\/collections\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (!parts.length) return null;

  const [collectionSlug, requestedBrand, requestedCondition] = parts;
  if (collectionSlug === "best-sellers" && !requestedBrand) {
    return {
      slug: collectionSlug,
      title: "Best Seller",
      description: "Don’t miss out on these customer favorites.",
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Best Seller" }],
      filters: { categories: [], brands: [], limit: 4 },
      available: true,
      mobilePhones: false,
      bestSellers: true,
    };
  }
  if (collectionSlug === "bundle-offers" && !requestedBrand) {
    const bundle = new URLSearchParams(search).get("bundle");
    const configurations: Record<string, { title: string; terms: string[] }> = {
      "phone-essentials": {
        title: "Phone Essentials Bundle",
        terms: ["phone", "smartphone", "charger", "cable"],
      },
      "power-on-go": {
        title: "Power On-the-Go Bundle",
        terms: ["phone", "smartphone", "power bank", "case"],
      },
      "macbook-essentials": {
        title: "MacBook Essentials Bundle",
        terms: ["macbook", "laptop", "charger", "cable"],
      },
      "everyday-essentials": {
        title: "Everyday Essentials Bundle",
        terms: ["phone", "smartphone", "charger", "cable", "power bank", "case", "accessor"],
      },
    };
    const configuration = bundle ? configurations[bundle] : undefined;
    if (bundle && !configuration) return null;
    const title = configuration?.title ?? "Bundle Offers";
    return {
      slug: collectionSlug,
      title,
      description: "Explore published products selected for practical bundle combinations.",
      breadcrumbs: [
        { label: "Home", href: "/" },
        ...(configuration
          ? [{ label: "Bundle Offers", href: "/collections/bundle-offers" }, { label: title }]
          : [{ label: "Bundle Offers" }]),
      ],
      filters: { categories: [], brands: [], limit: 100 },
      available: true,
      mobilePhones: false,
      bundleTerms: configuration?.terms,
    };
  }
  if (collectionSlug === "deals" && !requestedBrand) {
    return {
      slug: collectionSlug,
      title: "Deals",
      description: "Special offers from our current collection.",
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Deals" }],
      filters: { categories: [], brands: [], limit: 100 },
      available: true,
      mobilePhones: false,
      deals: true,
    };
  }
  if (collectionSlug === "laptops-tablets" && !requestedBrand) {
    const params = new URLSearchParams(search);
    const type = params.get("type");
    const brandParam = params.get("brand");
    const tabletCategory = taxonomySlug(taxonomy.categories, ["tablets", "tablet"])
      ?? taxonomySlug(taxonomy.categories, ["ipad", "ipads"]);
    const laptopCategory = taxonomySlug(taxonomy.categories, ["laptops", "laptop"])
      ?? taxonomySlug(taxonomy.categories, ["macbook", "macbooks"]);
    const brand = brandParam === "apple"
      ? appleBrand(taxonomy)
      : brandParam ? taxonomySlug(taxonomy.brands, [brandParam]) : undefined;
    const apple = appleBrand(taxonomy);
    const common = {
      slug: collectionSlug,
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Tablets & MacBooks" }],
      condition: undefined,
      mobilePhones: false,
      activeBrand: undefined,
    };
    if (!type) {
      const categories = [tabletCategory, laptopCategory].filter((value): value is string => Boolean(value));
      return {
        ...common,
        title: "Tablets & MacBooks",
        description: "Explore published iPads, tablets and Apple MacBooks.",
        filters: { categories, brands: [] },
        available: categories.length > 0,
      };
    }
    if (type === "ipad") {
      return {
        ...common,
        title: "iPad",
        description: "Explore published iPad models.",
        filters: { categories: tabletCategory ? [tabletCategory] : [], brands: apple ? [apple] : [] },
        available: Boolean(tabletCategory && apple && (!brandParam || brand)),
      };
    }
    if (type === "android-tablets") {
      return {
        ...common,
        title: "Android Tablets",
        description: "Explore published non-iPad tablet models.",
        filters: { categories: tabletCategory ? [tabletCategory] : [], brands: brand ? [brand] : [] },
        excludeBrands: brand ? [] : apple ? [apple] : [],
        available: Boolean(tabletCategory && (!brandParam || brand)),
      };
    }
    // MacBooks are the only laptops sold (Apple only). The older "?type=laptops" link shows the same MacBooks.
    if (type === "macbooks" || type === "laptops") {
      return {
        ...common,
        title: "MacBooks",
        description: "Explore published Apple MacBook models.",
        filters: { categories: laptopCategory ? [laptopCategory] : [], brands: apple ? [apple] : [] },
        available: Boolean(laptopCategory && apple && (!brandParam || brand === apple)),
      };
    }
    return null;
  }
  if (collectionSlug === "macbook" && !requestedBrand) {
    const collection = topLevelCollection(collectionSlug, taxonomy);
    if (!collection) return null;
    const family = new URLSearchParams(search).get("family");
    if (!family) return collection;
    const families: Record<string, string> = {
      air: "MacBook Air",
      pro: "MacBook Pro",
      neo: "MacBook Neo",
    };
    const familyLabel = families[family];
    if (!familyLabel) return null;
    return {
      ...collection,
      title: familyLabel,
      description: `Explore published ${familyLabel} models.`,
      filters: { ...collection.filters, search: familyLabel },
    };
  }
  if (collectionSlug === "home-gadgets" && !requestedBrand) {
    const collection = topLevelCollection(collectionSlug, taxonomy);
    if (!collection) return null;
    const params = new URLSearchParams(search);
    const type = params.get("type");
    const brandParam = params.get("brand");
    const homeTypes: Record<string, string> = {
      "smart-home": "Smart Home",
      routers: "Routers",
      cameras: "Cameras",
      "home-appliances": "Home Appliances",
      "personal-care": "Personal Care",
      "smart-tvs": "Smart TVs",
      "smart-watches-bands": "Smart Watches & Bands",
    };
    if (!type) return collection;
    const typeLabel = homeTypes[type];
    if (!typeLabel) return null;
    const brand = brandParam ? taxonomySlug(taxonomy.brands, [brandParam]) : undefined;
    return {
      ...collection,
      title: typeLabel,
      description: `Explore published ${typeLabel.toLowerCase()}.`,
      filters: {
        ...collection.filters,
        search: type === "smart-watches-bands" ? "Watch" : typeLabel,
        brands: brand ? [brand] : [],
      },
      available: collection.available && (!brandParam || Boolean(brand)),
    };
  }
  if (collectionSlug === "mobile-accessories" && !requestedBrand) {
    const collection = topLevelCollection(collectionSlug, taxonomy);
    if (!collection) return null;
    const params = new URLSearchParams(search);
    const type = params.get("type");
    const brandParam = params.get("brand");
    const accessoryTypes: Record<string, string> = {
      "mobile-cases": "Mobile Cases",
      chargers: "Chargers",
      cables: "Cables",
      "power-banks": "Power Banks",
      "car-chargers": "Car Chargers",
      audio: "Audio",
      "pc-gadgets": "PC Gadgets",
    };
    if (!type) {
      // Only the main Mobile Accessories page (not the type pages, which search by type name).
      // When no accessory is published yet the Accessories category is not in the public taxonomy: the page then shows
      // only the listed extras (baseCategory false = never fetch the empty, i.e. unfiltered, base list).
      const gadgets = taxonomySlug(taxonomy.categories, ["gadgets"]);
      if (!gadgets || !ACCESSORIES_EXTRA_PRODUCT_IDS.length) return collection;
      return {
        ...collection,
        available: true,
        extraProducts: {
          categories: [gadgets],
          productIds: ACCESSORIES_EXTRA_PRODUCT_IDS,
          baseCategory: collection.available,
          cardCategory: ACCESSORIES_EXTRA_CARD_CATEGORY,
        },
      };
    }
    const typeLabel = accessoryTypes[type];
    if (!typeLabel) return null;
    const brand = brandParam
      ? taxonomySlug(taxonomy.brands, [brandParam])
      : undefined;
    return {
      ...collection,
      title: brandParam ? `${typeLabel} — ${brandParam}` : typeLabel,
      description: `Explore published ${typeLabel.toLowerCase()}${brandParam ? ` by ${brandParam}` : ""}.`,
      filters: {
        ...collection.filters,
        search: typeLabel,
        brands: brand ? [brand] : [],
      },
      available: collection.available && (!brandParam || Boolean(brand)),
    };
  }
  if (collectionSlug !== "mobile-phones" || !requestedBrand) {
    return topLevelCollection(collectionSlug, taxonomy);
  }

  if (requestedBrand === "android" && !requestedCondition) {
    const category = mobileCategory(taxonomy);
    const apple = appleBrand(taxonomy);
    return {
      slug: parts.join("/"),
      title: "Android Phones",
      description: "Explore published non-iPhone mobile phones.",
      breadcrumbs: [
        { label: "Home", href: "/" },
        { label: "Mobile Phones", href: "/collections/mobile-phones" },
        { label: "Android Phones" },
      ],
      filters: { categories: category ? [category] : [], brands: [] },
      excludeBrands: apple ? [apple] : [],
      available: Boolean(category),
      mobilePhones: true,
      activeBrand: undefined,
    };
  }
  if (requestedCondition && !["new", "used"].includes(requestedCondition)) {
    return null;
  }
  if (requestedCondition && requestedBrand !== "iphone") return null;

  const category = mobileCategory(taxonomy);
  const aliases =
    requestedBrand === "iphone" ? ["apple", "iphone"] : [requestedBrand];
  const brand = taxonomySlug(taxonomy.brands, aliases);
  const brandRecord = taxonomy.brands.find((item) => item.slug === brand);
  const brandLabel =
    requestedBrand === "iphone"
      ? "iPhone"
      : brandRecord?.name ??
        requestedBrand.replace(/(^|-)([a-z])/g, (_, prefix, letter) =>
          `${prefix ? " " : ""}${letter.toUpperCase()}`,
        );
  const condition =
    requestedCondition === "new"
      ? "brand_new"
      : requestedCondition === "used"
        ? "used"
        : undefined;
  const title = requestedCondition
    ? `${brandLabel} ${requestedCondition === "new" ? "New" : "Used"}`
    : brandLabel;

  return {
    slug: parts.join("/"),
    title,
    description: `Explore published ${brandLabel} mobile phones.`,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Mobile Phones", href: "/collections/mobile-phones" },
      ...(requestedCondition
        ? [
            {
              label: brandLabel,
              href: `/collections/mobile-phones/${requestedBrand}`,
            },
          ]
        : []),
      { label: title },
    ],
    filters: {
      categories: category ? [category] : [],
      brands: brand ? [brand] : [],
    },
    condition,
    available: Boolean(category && brand),
    mobilePhones: true,
    activeBrand: requestedBrand,
  };
}