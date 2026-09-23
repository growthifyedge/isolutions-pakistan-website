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

export const primaryMobileBrands = [
  { label: "Samsung", slug: "samsung" },
  { label: "Infinix", slug: "infinix" },
  { label: "Oppo", slug: "oppo" },
  { label: "Vivo", slug: "vivo" },
  { label: "Tecno", slug: "tecno" },
  { label: "iPhone", slug: "iphone" },
] as const;

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
};

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
      aliases: ["home-gadgets", "home gadgets", "smart-home", "home-technology"],
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
  };
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
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Laptops & Tablets" }],
      condition: undefined,
      mobilePhones: false,
      activeBrand: undefined,
    };
    if (!type) {
      const categories = [tabletCategory, laptopCategory].filter((value): value is string => Boolean(value));
      return {
        ...common,
        title: "Laptops & Tablets",
        description: "Explore published laptops and tablets.",
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
    if (type === "laptops") {
      return {
        ...common,
        title: "Laptops",
        description: "Explore published laptop models.",
        filters: { categories: laptopCategory ? [laptopCategory] : [], brands: brand ? [brand] : [] },
        available: Boolean(laptopCategory && (!brandParam || brand)),
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
    if (!type) return collection;
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