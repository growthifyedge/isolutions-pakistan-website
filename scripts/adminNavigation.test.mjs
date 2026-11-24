// Admin menu simplification (Owner-approved 2026-11-23): 10 sidebar options, the tools grouped under them, every old
// address still opens its own page. Navigation only — this test reads the source; nothing touches a database.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../src/admin/admin.css", import.meta.url), "utf8");
const block = (start, end) => {
  const from = app.indexOf(start);
  assert.ok(from >= 0, start);
  return app.slice(from, app.indexOf(end, from) + end.length);
};
const tuples = (text) => [...text.matchAll(/\["([^"]+)", "([^"]*)", [A-Za-z]+\]/g)].map((match) => [match[1], match[2]]);
const nav = tuples(block("const nav: ReadonlyArray<NavItem> = [", "\n];"));
const children = block("const navChildren:", "\n};");
const productTools = tuples(children.slice(children.indexOf('"Products & Inventory"'), children.indexOf("\n  ],", children.indexOf('"Products & Inventory"'))));

test("sidebar: exactly the 10 approved options, in the approved order", () => {
  assert.deepEqual(nav.map(([label]) => label), ["Dashboard", "Products & Inventory", "Add Product", "Orders", "Media", "Promotions", "Promotional Popup", "Homepage", "Enquiries", "Settings"]);
  assert.equal(nav.find(([label]) => label === "Products & Inventory")[1], "/admin/products", "opens the Catalog");
});

test("Products & Inventory: all 10 tools, each one click away, on their existing addresses", () => {
  assert.deepEqual(productTools, [
    ["Catalog", "/admin/products"],
    ["Readiness", "/admin/catalog-readiness"],
    ["Bulk Import", "/admin/bulk-import"],
    ["Stock Update", "/admin/stock-update"],
    ["iPhone Stock", "/admin/iphone-stock-update"],
    ["Gadgets Stock", "/admin/gadget-stock-update"],
    ["Tablets & MacBooks", "/admin/tablet-stock-update"],
    ["Spec Upload", "/admin/spec-upload"],
    ["Descriptions", "/admin/description-upload"],
    ["Subcategories", "/admin/subcategory-upload"],
  ]);
  assert.match(app, /const navDisplayName[^\n]*\{ "Stock Update": "Android Stock Update" \}/);
  // Owner decision: the tools are shown only as the tab bar above the page — never as a nested sidebar sub-menu.
  const sidebar = app.slice(app.indexOf('<nav aria-label="Admin Studio navigation">'), app.indexOf("</nav>", app.indexOf('<nav aria-label="Admin Studio navigation">')));
  assert.doesNotMatch(sidebar, /navChildren|NavLinks|admin-nav-children/);
  assert.match(sidebar, /className=\{group === label \? "active" : ""\}/, "the main option stays highlighted on its tools' pages");
  assert.doesNotMatch(css, /admin-nav-children/);
  assert.match(app, /\{group && tools && \(\s*<nav className="admin-subnav" aria-label=\{`\$\{group\} tools`\} ref=\{subnavRef\}>/);
  assert.match(css, /\.admin-subnav \{[^}]*overflow-x: auto/);
});

test("every old address still opens the same page, and each page highlights its menu option", () => {
  const routes = ["/admin/products", "/admin/bulk-import", "/admin/stock-update", "/admin/iphone-stock-update", "/admin/tablet-stock-update", "/admin/gadget-stock-update", "/admin/description-upload", "/admin/subcategory-upload", "/admin/spec-upload", "/admin/iphone-model-specs", "/admin/catalog-readiness", "/admin/contact-enquiries", "/admin/taxonomy", "/admin/products/add", "/admin/media", "/admin/homepage", "/admin/orders", "/admin/promotions", "/admin/promotional-popup", "/admin/settings"];
  for (const route of routes) assert.ok(app.includes(`path === "${route}"`), route);
  assert.match(app, /path\.startsWith\("\/admin\/products\/"\)\) page = <ProductEditor \/>/);
  const grouped = new Set([...nav.map(([label]) => label), ...tuples(children).map(([label]) => label)]);
  for (const [, section] of app.matchAll(/<AdminLayout section="([^"]+)">/g)) assert.ok(grouped.has(section), `section "${section}" belongs to a menu option`);
});

test("navigation only: no page component, permission check or data call was changed", () => {
  for (const page of ["<BulkImport />", "<StockListUpdate />", "<IphoneStockUpdate />", "<TabletStockUpdate />", "<GadgetStockUpdate />", "<DescriptionBulkUpload />", "<SubcategoryAssignment />", "<CatalogReadiness />", "<ContactEnquiries />", "<TaxonomyManager />", "<AddProduct />", "<AdminOrders />", "<AdminPromotions />", "<PromoPopupSetting />", "<BundleManager />"])
    assert.ok(app.includes(page), page);
  assert.match(app, /if \(path === "\/admin\/login"\) return <Login \/>;/);
  const menu = app.slice(app.indexOf("type NavItem"), app.indexOf("function EnvironmentBadge"));
  assert.doesNotMatch(menu, /supabase|\.rpc\(|\.from\(/);
});
