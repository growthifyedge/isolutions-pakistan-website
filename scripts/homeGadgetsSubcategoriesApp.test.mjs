// Home Gadgets subcategories — storefront collection resolution, navigation wiring, Admin editor helpers and the bulk
// SKU → subcategory planner / saver. Pure functions and source checks only; no database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCESSORIES_EXTRA_PRODUCT_IDS, resolveCollection, withoutExcludedProducts } from "../src/lib/collections.ts";
import { HOME_GADGET_SUBCATEGORIES, matchHomeGadgetSubcategory } from "../src/lib/homeGadgetSubcategories.ts";
import { subcategoryEditBlocker, subcategoryOptionsFor, subcategoryPatch } from "../src/lib/productSubcategoryEdit.ts";
import {
  planSubcategoryUpload,
  runSubcategoryUpload,
  selectSubcategoryWrites,
  subcategoryConfirmationPhrase,
  subcategoryRowsFromCsv,
  subcategoryRpcPayload,
} from "../src/lib/subcategoryAssignment.ts";

const taxonomy = {
  brands: [{ id: "b1", name: "Apple", slug: "apple" }],
  categories: [
    { id: "c1", name: "Gadgets", slug: "gadgets" },
    { id: "c4", name: "Mobile Accessories", slug: "mobile-accessories" },
    { id: "c5", name: "Mobile Phones", slug: "mobile-phones" },
  ],
};
const storefront = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");

// ---------------- storefront ----------------

test("the 10 Owner-approved subcategories, in order, with the mapping file's slugs", () => {
  assert.deepEqual(HOME_GADGET_SUBCATEGORIES.map((s) => s.name), [
    "Kitchen & Dining", "Storage & Organizers", "Home & Living", "Bathroom Essentials", "Health & Beauty",
    "Gadgets & Accessories", "Bags & Travel", "Laundry & Cleaning", "Sports & Outdoors", "Kids & Toys",
  ]);
  assert.deepEqual(HOME_GADGET_SUBCATEGORIES.map((s) => s.slug), [
    "kitchen-dining", "storage-organizers", "home-living", "bathroom-essentials", "health-beauty",
    "gadgets-accessories", "bags-travel", "laundry-cleaning", "sports-outdoors", "kids-toys",
  ]);
});

test("each subcategory page filters gadgets by the stored subcategory (no title search) and keeps the Watches/Bands exclusion", () => {
  for (const subcategory of HOME_GADGET_SUBCATEGORIES) {
    const collection = resolveCollection("/collections/home-gadgets", taxonomy, `?type=${subcategory.slug}`);
    assert.equal(collection?.available, true);
    assert.equal(collection?.title, subcategory.name);
    assert.deepEqual(collection?.filters.categories, ["gadgets"]);
    assert.deepEqual(collection?.filters.subcategories, [subcategory.slug]);
    assert.equal(collection?.filters.search, undefined);
    assert.equal(collection?.homeGadgetSubcategory, subcategory.slug);
    assert.deepEqual(collection?.excludeProductIds, ACCESSORIES_EXTRA_PRODUCT_IDS);
    assert.deepEqual(collection?.breadcrumbs.map((b) => b.label), ["Home", "Home Gadgets", subcategory.name]);
  }
  // A watch that somehow carried a subcategory is still hidden from Home Gadgets.
  const watch = { id: ACCESSORIES_EXTRA_PRODUCT_IDS[0] };
  const collection = resolveCollection("/collections/home-gadgets", taxonomy, "?type=kitchen-dining");
  assert.deepEqual(withoutExcludedProducts([watch, { id: "other" }], collection?.excludeProductIds), [{ id: "other" }]);
});

test("the main page shows the chips (All active); the existing six type pages are unchanged", () => {
  const main = resolveCollection("/collections/home-gadgets", taxonomy);
  assert.equal(main?.homeGadgetSubcategory, "");
  assert.deepEqual(main?.filters, { categories: ["gadgets"], brands: [] });
  const existing = { "smart-home": "Smart Home", routers: "Routers", cameras: "Cameras", "home-appliances": "Home Appliances", "personal-care": "Personal Care", "smart-tvs": "Smart TVs" };
  for (const [type, label] of Object.entries(existing)) {
    const collection = resolveCollection("/collections/home-gadgets", taxonomy, `?type=${type}`);
    assert.equal(collection?.title, label);
    assert.equal(collection?.filters.search, label);
    assert.equal(collection?.filters.subcategories, undefined);
    assert.equal(collection?.homeGadgetSubcategory, undefined);
    assert.deepEqual(collection?.excludeProductIds, ACCESSORIES_EXTRA_PRODUCT_IDS);
  }
  assert.equal(resolveCollection("/collections/home-gadgets", taxonomy, "?type=garden"), null);
  assert.equal(resolveCollection("/collections/home-gadgets", taxonomy, "?type=kitchen-dining&brand=apple"), null);
  // Mobile Accessories still shows the 16 extras; no subcategory there.
  const accessories = resolveCollection("/collections/mobile-accessories", taxonomy);
  assert.deepEqual(accessories?.extraProducts?.productIds, ACCESSORIES_EXTRA_PRODUCT_IDS);
  assert.equal(accessories?.homeGadgetSubcategory, undefined);
});

test("no Gadgets category published → subcategory pages are unavailable, never an unfiltered list", () => {
  const collection = resolveCollection("/collections/home-gadgets", { brands: [], categories: [] }, "?type=kitchen-dining");
  assert.equal(collection?.available, false);
});

test("desktop mega menu and mobile drawer keep the existing six links and add the 10 subcategories", () => {
  for (const type of ["smart-home", "routers", "cameras", "home-appliances", "personal-care", "smart-tvs"]) {
    assert.equal((storefront.match(new RegExp(`/collections/home-gadgets\\?type=${type}"`, "g")) ?? []).length, 2, type);
  }
  assert.match(storefront, /\.\.\.HOME_GADGET_SUBCATEGORIES\.map\(\(subcategory\) => \(\{ heading: subcategory\.name, href: homeGadgetSubcategoryHref\(subcategory\.slug\), links: \[\] \}\)\)/);
  assert.match(storefront, /<a href=\{homeGadgetSubcategoryHref\(subcategory\.slug\)\} key=\{subcategory\.slug\}>\{subcategory\.name\}<\/a>/);
  assert.match(storefront, /aria-label="Home Gadgets subcategories"/);
  // The collection page refetches when the subcategory changes.
  assert.match(storefront, /\.\.\.\(collection\.filters\.subcategories \?\? \[\]\)\.map\(\(slug\) => `sub:\$\{slug\}`\)/);
});

// ---------------- Admin editor ----------------

const SUBS = HOME_GADGET_SUBCATEGORIES.map((s, index) => ({ id: `s${index + 1}`, name: s.name, slug: s.slug, category_id: "c1", is_active: true, sort_order: index + 1 }));

test("editor: only Gadgets products, never the Watches/Bands, and only once the migration exists", () => {
  assert.equal(subcategoryEditBlocker({ productId: "p1", categorySlug: "gadgets", subcategoriesAvailable: true }), null);
  assert.match(subcategoryEditBlocker({ productId: "p1", categorySlug: "gadgets", subcategoriesAvailable: false }), /not applied/);
  assert.match(subcategoryEditBlocker({ productId: "p1", categorySlug: "mobile-accessories", subcategoriesAvailable: true }), /Only Home Gadgets/);
  assert.match(subcategoryEditBlocker({ productId: ACCESSORIES_EXTRA_PRODUCT_IDS[3], categorySlug: "gadgets", subcategoriesAvailable: true }), /Mobile Accessories/);
  assert.match(subcategoryEditBlocker({ productId: null, categorySlug: "gadgets", subcategoriesAvailable: true }), /Save the product first/);
});

test("editor: options are the active subcategories of the product's own category; patch is one column", () => {
  const rows = [...SUBS.slice(0, 3), { ...SUBS[3], is_active: false }, { id: "x", name: "Other", slug: "other", category_id: "c4", is_active: true, sort_order: 1 }];
  assert.deepEqual(subcategoryOptionsFor("c1", rows, null).map((r) => r.id), ["s1", "s2", "s3"]);
  assert.deepEqual(subcategoryOptionsFor("c1", rows, "s4").map((r) => r.id), ["s1", "s2", "s3", "s4"]);
  assert.equal(subcategoryPatch("s1", "s1"), null);
  assert.equal(subcategoryPatch(null, ""), null);
  assert.deepEqual(subcategoryPatch(null, "s2"), { subcategory_id: "s2" });
  assert.deepEqual(subcategoryPatch("s2", ""), { subcategory_id: null });
  const editor = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8");
  const save = editor.slice(editor.indexOf("const saveSubcategory = async"), editor.indexOf("const publish = async"));
  assert.match(save, /window\.confirm\(/);
  assert.match(save, /\.update\(patch\)/);
  assert.equal(/publication_status:\s*"/.test(save), false);
});

// ---------------- bulk assignment ----------------

const SUB_REFS = SUBS.map((s) => ({ id: s.id, name: s.name, slug: s.slug, is_active: s.is_active, categorySlug: "gadgets" }));
const CATALOG = [
  { id: "p32", title: "Magnetic Phone Holder", publication_status: "published", categorySlug: "gadgets", subcategoryId: null, skus: ["GD032"] },
  { id: "p33", title: "Baby Feeding Bottle", publication_status: "published", categorySlug: "gadgets", subcategoryId: null, skus: ["GD033"] },
  { id: "p34", title: "Makeup Bag", publication_status: "published", categorySlug: "gadgets", subcategoryId: "s5", skus: ["GD034"] },
  { id: "p35", title: "Spice Rack", publication_status: "published", categorySlug: "gadgets", subcategoryId: "s1", skus: ["GD035"] },
  { id: "p115", title: "Belt Buckle", publication_status: "draft", categorySlug: "gadgets", subcategoryId: null, skus: ["GD115"] },
  { id: "p2", title: "Two SKU Gadget", publication_status: "published", categorySlug: "gadgets", subcategoryId: null, skus: ["GD040", "GD041"] },
  { id: ACCESSORIES_EXTRA_PRODUCT_IDS[0], title: "Samsung Watch 7 44mm", publication_status: "published", categorySlug: "gadgets", subcategoryId: null, skus: ["GD010"] },
  { id: "pa", title: "Phone Case", publication_status: "published", categorySlug: "mobile-accessories", subcategoryId: null, skus: ["AC001"] },
];
const csv = (lines) => subcategoryRowsFromCsv(["SKU,Subcategory,Product Name (optional check)", ...lines].join("\r\n"));

test("file reading: needs SKU + Subcategory columns; SKUs are normalised", () => {
  assert.match(subcategoryRowsFromCsv("Name,Category\r\nx,y").fileErrors[0], /Missing column\(s\): SKU, Subcategory/);
  assert.match(subcategoryRowsFromCsv("SKU,Subcategory\r\n").fileErrors[0], /no SKU rows/);
  const { rows } = csv([" gd032 ,Kitchen & Dining,"]);
  assert.deepEqual(rows, [{ rowNumber: 2, sku: "GD032", subcategory: "Kitchen & Dining", productName: "" }]);
});

test("names/slugs match exactly (incl. British 'Organisers'); anything else is never guessed", () => {
  assert.equal(matchHomeGadgetSubcategory("kitchen-dining")?.slug, "kitchen-dining");
  assert.equal(matchHomeGadgetSubcategory("Kitchen and Dining")?.slug, "kitchen-dining");
  assert.equal(matchHomeGadgetSubcategory("Storage & Organisers")?.slug, "storage-organizers");
  assert.equal(matchHomeGadgetSubcategory("Kitchen"), undefined);
  assert.equal(matchHomeGadgetSubcategory(""), undefined);
});

test("preview: invalid SKU, missing / unknown subcategory, wrong category, Watches/Bands, name mismatch, change, unchanged", () => {
  const { rows } = csv([
    "GD032,Gadgets & Accessories,Magnetic Phone Holder",
    "GD999,Kitchen & Dining,",
    "GD033,,",
    "GD115,Garden,",
    "AC001,Kitchen & Dining,",
    "GD010,Gadgets & Accessories,",
    "GD034,Bags & Travel,",
    "GD035,kitchen-dining,",
    "GD032X,Kitchen & Dining,",
  ]);
  const plan = planSubcategoryUpload(rows, CATALOG, SUB_REFS);
  assert.deepEqual(plan.rows.map((r) => r.category), [
    "Assign", "SKU Not Found", "Missing Subcategory", "Unknown Subcategory", "Not Allowed", "Not Allowed", "Change", "Unchanged", "SKU Not Found",
  ]);
  const mismatch = planSubcategoryUpload(csv(["GD032,Gadgets & Accessories,Some Other Title"]).rows, CATALOG, SUB_REFS);
  assert.equal(mismatch.rows[0].category, "Not Allowed");
  assert.match(mismatch.rows[0].messages[0], /does not match/);
  // A draft can be assigned (it stays a draft and is never public).
  assert.equal(planSubcategoryUpload(csv(["GD115,Home & Living,"]).rows, CATALOG, SUB_REFS).rows[0].category, "Assign");
  // An inactive subcategory is refused.
  const inactive = SUB_REFS.map((s) => (s.slug === "kids-toys" ? { ...s, is_active: false } : s));
  assert.equal(planSubcategoryUpload(csv(["GD032,Kids & Toys,"]).rows, CATALOG, inactive).rows[0].category, "Unknown Subcategory");
});

test("duplicates: agreeing rows keep the first; disagreeing rows block every row of that SKU / product", () => {
  const same = planSubcategoryUpload(csv(["GD032,Kitchen & Dining,", "gd032,kitchen-dining,"]).rows, CATALOG, SUB_REFS);
  assert.deepEqual(same.rows.map((r) => r.category), ["Assign", "Duplicate"]);
  const conflict = planSubcategoryUpload(csv(["GD032,Kitchen & Dining,", "GD032,Home & Living,"]).rows, CATALOG, SUB_REFS);
  assert.deepEqual(conflict.rows.map((r) => r.category), ["Duplicate", "Duplicate"]);
  const blank = planSubcategoryUpload(csv(["GD032,Kitchen & Dining,", "GD032,,"]).rows, CATALOG, SUB_REFS);
  assert.deepEqual(blank.rows.map((r) => r.category), ["Duplicate", "Duplicate"]);
  const twoSkus = planSubcategoryUpload(csv(["GD040,Kitchen & Dining,", "GD041,Bags & Travel,"]).rows, CATALOG, SUB_REFS);
  assert.deepEqual(twoSkus.rows.map((r) => r.category), ["Duplicate", "Duplicate"]);
  const twoSkusSame = planSubcategoryUpload(csv(["GD040,Kitchen & Dining,", "GD041,Kitchen & Dining,"]).rows, CATALOG, SUB_REFS);
  assert.deepEqual(twoSkusSame.rows.map((r) => r.category), ["Assign", "Duplicate"]);
  assert.equal(selectSubcategoryWrites(conflict, new Set()).length, 0);
});

const goodPlan = () => planSubcategoryUpload(csv(["GD032,Gadgets & Accessories,", "GD033,Kids & Toys,", "GD034,Bags & Travel,"]).rows, CATALOG, SUB_REFS);
const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";

test("save: blocked without the confirmation tick, without the PRODUCTION phrase, or with a mismatched build", async () => {
  const calls = [];
  const deps = (url, mode) => ({
    supabaseUrl: url, buildMode: mode,
    assign: async (payload) => { calls.push(payload); return { total: payload.length, updated: payload.length, unchanged: 0 }; },
    readBack: async () => [],
  });
  assert.equal((await runSubcategoryUpload(goodPlan(), { change: new Set(), confirmed: false, typed: "" }, deps(DEV_URL, "development"))).outcome, "blocked");
  assert.equal((await runSubcategoryUpload(goodPlan(), { change: new Set(), confirmed: true, typed: "" }, deps(PROD_URL, "production"))).outcome, "blocked");
  assert.equal((await runSubcategoryUpload(goodPlan(), { change: new Set(), confirmed: true, typed: "x" }, deps(PROD_URL, "development"))).outcome, "blocked");
  assert.equal(calls.length, 0, "nothing reached the database");
  assert.equal(subcategoryConfirmationPhrase(2), "ASSIGN 2 SUBCATEGORIES");
});

test("save: one RPC call with server-side SKUs and the previewed current value; Change rows only when ticked; read-back verified", async () => {
  const state = new Map(CATALOG.map((p) => [p.id, { id: p.id, subcategoryId: p.subcategoryId, publication_status: p.publication_status }]));
  const calls = [];
  const deps = {
    supabaseUrl: PROD_URL, buildMode: "production",
    assign: async (payload) => {
      calls.push(payload);
      for (const row of payload) {
        const product = CATALOG.find((p) => p.skus.includes(row.sku));
        state.get(product.id).subcategoryId = SUB_REFS.find((s) => s.slug === row.subcategory).id;
      }
      return { total: payload.length, updated: payload.length, unchanged: 0 };
    },
    readBack: async (ids) => ids.map((id) => ({ ...state.get(id) })),
  };
  const plan = goodPlan();
  assert.deepEqual(subcategoryRpcPayload(selectSubcategoryWrites(plan, new Set())), [
    { sku: "GD032", subcategory: "gadgets-accessories", expected_current: null },
    { sku: "GD033", subcategory: "kids-toys", expected_current: null },
  ]);
  const result = await runSubcategoryUpload(plan, { change: new Set([4]), confirmed: true, typed: subcategoryConfirmationPhrase(3) }, deps);
  assert.equal(result.outcome, "verified", result.message);
  assert.equal(result.verified, 3);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2], { sku: "GD034", subcategory: "bags-travel", expected_current: "health-beauty" });
});

test("save: a server refusal is reported and nothing is claimed as saved", async () => {
  const result = await runSubcategoryUpload(goodPlan(), { change: new Set(), confirmed: true, typed: "" }, {
    supabaseUrl: DEV_URL, buildMode: "development",
    assign: async () => { throw new Error("subcategory_assignment_rejected: row 1: SKU GD032 subcategory changed after the preview"); },
    readBack: async () => [],
  });
  assert.equal(result.outcome, "failed");
  assert.match(result.message, /nothing was changed/);
  assert.equal(result.verified, 0);
});

test("Admin route and navigation are registered", () => {
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\["Subcategories", "\/admin\/subcategory-upload", FolderTree\]/);
  assert.match(app, /path === "\/admin\/subcategory-upload"/);
});
