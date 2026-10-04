// Admin operations dashboard: figures come only from real rows; development records never count.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LOW_STOCK_MAX_UNITS,
  dashboardGreeting,
  startOfLocalDayIso,
  summarizeDashboard,
} from "../src/lib/adminDashboard.ts";

const image = [{ is_primary: true, cloudinary_public_id: "isolutions-production/products/p/front" }];
const product = (id, overrides = {}) => ({
  id, publication_status: "published", data_class: "real", product_media: image,
  product_variants: [{ id: `${id}-v1`, is_active: true }], ...overrides,
});
const noOrders = { today: 0, open: 0, new: 0 };
const noEnquiries = { open: 0, new: 0 };

test("an empty production catalog reports zeros, no alerts and the setup-ready state", () => {
  const summary = summarizeDashboard({ products: [], inventory: [], orderCounts: noOrders, enquiryCounts: noEnquiries });
  assert.equal(summary.publishedProducts, 0);
  assert.equal(summary.draftProducts, 0);
  assert.equal(summary.lowStockVariants, 0);
  assert.equal(summary.outOfStockVariants, 0);
  assert.equal(summary.catalogEmpty, true);
  assert.deepEqual(summary.attention, []);
});

test("development records never count, even when published", () => {
  const summary = summarizeDashboard({
    products: [product("dev", { data_class: "development" }), product("dev-draft", { data_class: "development", publication_status: "draft", product_media: [] })],
    inventory: [{ variant_id: "dev-v1", quantity_on_hand: 0 }],
    orderCounts: noOrders, enquiryCounts: noEnquiries,
  });
  assert.equal(summary.publishedProducts, 0);
  assert.equal(summary.draftProducts, 0);
  assert.equal(summary.outOfStockVariants, 0);
  assert.equal(summary.productsMissingImages, 0);
  assert.equal(summary.catalogEmpty, true);
});

test("stock alerts cover active variants of published products only, using on-hand totals", () => {
  const summary = summarizeDashboard({
    products: [
      product("a", { product_variants: [{ id: "a1", is_active: true }, { id: "a2", is_active: true }, { id: "a3", is_active: true }, { id: "a4", is_active: false }] }),
      product("draft", { publication_status: "draft", product_variants: [{ id: "d1", is_active: true }] }),
    ],
    inventory: [
      { variant_id: "a1", quantity_on_hand: "0" },          // out of stock (bigint arrives as text)
      { variant_id: "a2", quantity_on_hand: LOW_STOCK_MAX_UNITS }, // low stock
      { variant_id: "a3", quantity_on_hand: LOW_STOCK_MAX_UNITS + 1 }, // healthy
      { variant_id: "a4", quantity_on_hand: 0 },            // inactive variant: ignored
      { variant_id: "d1", quantity_on_hand: 0 },            // draft product: ignored
    ],
    orderCounts: noOrders, enquiryCounts: noEnquiries,
  });
  assert.equal(summary.liveVariants, 3);
  assert.equal(summary.outOfStockVariants, 1);
  assert.equal(summary.lowStockVariants, 1);
  assert.equal(summary.draftProducts, 1);
});

test("a live variant with no inventory row counts as out of stock", () => {
  const summary = summarizeDashboard({ products: [product("x")], inventory: [], orderCounts: noOrders, enquiryCounts: noEnquiries });
  assert.equal(summary.outOfStockVariants, 1);
});

test("missing main image counts non-archived real products without a primary Cloudinary image", () => {
  const summary = summarizeDashboard({
    products: [
      product("ok"),
      product("none", { publication_status: "draft", product_media: [] }),
      product("not-primary", { publication_status: "draft", product_media: [{ is_primary: false, cloudinary_public_id: "x" }] }),
      product("archived", { publication_status: "archived", product_media: [] }),
    ],
    inventory: [{ variant_id: "ok-v1", quantity_on_hand: 9 }],
    orderCounts: noOrders, enquiryCounts: noEnquiries,
  });
  assert.equal(summary.productsMissingImages, 2);
});

test("needs-attention lists only non-zero items, most urgent first, with real destinations", () => {
  const summary = summarizeDashboard({
    products: [product("draft", { publication_status: "draft", product_media: [] })],
    inventory: [],
    orderCounts: { today: 3, open: 4, new: 2 },
    enquiryCounts: { open: 1, new: 1 },
  });
  assert.deepEqual(summary.attention.map((item) => item.key), ["new-orders", "enquiries", "missing-images", "drafts"]);
  assert.equal(summary.attention[0].label, "2 new orders");
  assert.equal(summary.attention[0].href, "/admin/orders");
  assert.equal(summary.attention.find((item) => item.key === "missing-images").href, "/admin/products?missing=images");
  assert.equal(summary.attention.find((item) => item.key === "enquiries").label, "1 open enquiry");
  assert.equal(summary.ordersToday, 3);
  assert.equal(summary.openOrders, 4);
});

test("greeting follows local time and the day starts at local midnight", () => {
  assert.equal(dashboardGreeting(new Date(2026, 9, 4, 9, 30)), "Good morning.");
  assert.equal(dashboardGreeting(new Date(2026, 9, 4, 12, 0)), "Good afternoon.");
  assert.equal(dashboardGreeting(new Date(2026, 9, 4, 17, 0)), "Good evening.");
  const start = new Date(startOfLocalDayIso(new Date(2026, 9, 4, 18, 45)));
  assert.deepEqual([start.getHours(), start.getMinutes(), start.getDate()], [0, 0, 4]);
});

test("the admin dashboard renders no development fixtures or phase wording", () => {
  const dashboard = readFileSync(new URL("../src/admin/AdminDashboard.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dashboard, /adminDevelopment|Development|Phase \d|PHASE \d/);
  const dashboardFn = app.slice(app.indexOf("function Dashboard()"), app.indexOf("function ProductList()"));
  assert.match(dashboardFn, /<AdminDashboard \/>/);
  assert.doesNotMatch(dashboardFn, /adminDevelopmentProducts/);
  assert.doesNotMatch(app, /PHASE 3A|Phase 3A catalog readiness|Development client configured|Development workspace|Development Admin/);
});
