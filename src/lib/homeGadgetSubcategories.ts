/**
 * Home Gadgets subcategories (Owner-approved list, PROJECT_HANDOVER.md §5F.4). The database rows are seeded by
 * migration 202611090001 (product_subcategories, parent category `gadgets`) with exactly these names, slugs and order;
 * storefront navigation, collection filter chips and the Admin bulk assignment page share this one list.
 * Products are linked through products.subcategory_id — never by title keywords.
 */
export const HOME_GADGET_SUBCATEGORIES = [
  { name: "Kitchen & Dining", slug: "kitchen-dining" },
  { name: "Storage & Organizers", slug: "storage-organizers" },
  { name: "Home & Living", slug: "home-living" },
  { name: "Bathroom Essentials", slug: "bathroom-essentials" },
  { name: "Health & Beauty", slug: "health-beauty" },
  { name: "Gadgets & Accessories", slug: "gadgets-accessories" },
  { name: "Bags & Travel", slug: "bags-travel" },
  { name: "Laundry & Cleaning", slug: "laundry-cleaning" },
  { name: "Sports & Outdoors", slug: "sports-outdoors" },
  { name: "Kids & Toys", slug: "kids-toys" },
] as const;

export type HomeGadgetSubcategory = (typeof HOME_GADGET_SUBCATEGORIES)[number];
export type HomeGadgetSubcategorySlug = HomeGadgetSubcategory["slug"];

/** The database category the subcategories belong to. */
export const HOME_GADGET_SUBCATEGORY_PARENT = "gadgets";

export const homeGadgetSubcategoryHref = (slug: string) => `/collections/home-gadgets?type=${encodeURIComponent(slug)}`;

export const homeGadgetSubcategoryBySlug = (slug: string | null | undefined): HomeGadgetSubcategory | undefined =>
  HOME_GADGET_SUBCATEGORIES.find((entry) => entry.slug === slug);

const comparable = (value: string) => value.toLowerCase().replace(/&/g, "and").replace(/organisers/g, "organizers").replace(/[^a-z0-9]+/g, "");

/**
 * Exact name or slug (case, spacing, "&"/"and" and the British spelling "Organisers" ignored) → the subcategory.
 * Anything else — including a partial or guessed name — is not matched (never inferred).
 */
export function matchHomeGadgetSubcategory(value: string | null | undefined): HomeGadgetSubcategory | undefined {
  const wanted = comparable(String(value ?? ""));
  if (!wanted) return undefined;
  return HOME_GADGET_SUBCATEGORIES.find((entry) => comparable(entry.name) === wanted || comparable(entry.slug) === wanted);
}
