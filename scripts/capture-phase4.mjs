import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const env = Object.fromEntries(
  (await readFile(".env.local", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [
        line.slice(0, i).trim(),
        line
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ];
    }),
);
const projectRef = new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0];
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expiresAt, sub: "visual-qa-owner" })}.visual-qa`;
const session = {
  access_token: token,
  refresh_token: "visual-qa-only",
  expires_at: expiresAt,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "visual-qa-owner", aud: "authenticated", role: "authenticated" },
};
const productId = "11111111-1111-4111-8111-111111111111";
const image =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900'%3E%3Crect width='900' height='900' fill='%23efede7'/%3E%3Crect x='315' y='120' width='270' height='570' rx='35' fill='%23162c24'/%3E%3Ccircle cx='450' cy='210' r='46' fill='%23ef5b3e'/%3E%3C/svg%3E";
const brand = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "OWNER APPROVED QA BRAND",
  slug: "owner-approved-qa-brand",
  data_class: "real",
  is_active: true,
};
const category = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Owner Approved QA Category",
  slug: "owner-approved-qa-category",
  data_class: "real",
  is_active: true,
};
const publicProduct = {
  id: productId,
  slug: "owner-approved-qa-product",
  title: "OWNER APPROVED QA PRODUCT",
  short_description:
    "Clearly labelled visual-QA fixture for Phase 4 presentation verification.",
  content:
    "This fixture validates layout only and is not a real imported catalog record.",
  default_warranty: "Owner-approved QA warranty",
  published_at: new Date().toISOString(),
  brand,
  category,
  variants: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      sku: "QA-PHASE4-001",
      ram: "8 GB",
      storage: "256 GB",
      color: "Graphite",
      priceMinor: 12500000,
      compareAtPriceMinor: null,
      ptaStatus: "approved",
      condition: "brand_new",
      warranty: "Owner-approved QA warranty",
      carrierJv: null,
      deliveryScope: "karachi_only",
      quantity: 3,
    },
  ],
  media: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      variantId: null,
      publicId: "",
      url: image,
      alt: "Phase 4 visual QA product",
      width: 900,
      height: 900,
      format: "webp",
      isPrimary: true,
    },
  ],
  specifications: [
    {
      group: "Core",
      label: "QA field",
      value: "Owner-supplied facts required for real import",
    },
  ],
};
const adminProduct = {
  id: productId,
  title: publicProduct.title,
  slug: publicProduct.slug,
  publication_status: "published",
  data_class: "real",
  brand: { name: brand.name },
  category: { name: category.name },
  product_variants: [{ id: publicProduct.variants[0].id }],
};
const mediaRecord = {
  id: publicProduct.media[0].id,
  product_id: productId,
  variant_id: null,
  secure_url: image,
  alt_text: publicProduct.media[0].alt,
  width: 900,
  height: 900,
  bytes: 4096,
  format: "webp",
  is_primary: true,
  sort_order: 0,
  cloudinary_public_id: "visual-qa/phase4",
  product: {
    id: productId,
    title: publicProduct.title,
    publication_status: "published",
  },
};
const out = "artifacts/screenshots/phase4";
const baseUrl = process.env.PHASE4_QA_BASE_URL ?? "http://127.0.0.1:4184";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const checks = [
  ["desktop-home", "/", 1440, 1000],
  ["desktop-shop", "/shop", 1440, 1000],
  ["desktop-real-pdp", "/product/owner-approved-qa-product", 1440, 1000],
  ["tablet-home", "/", 768, 1024],
  ["tablet-shop", "/shop", 768, 1024],
  ["tablet-real-pdp", "/product/owner-approved-qa-product", 768, 1024],
  ["mobile-home", "/", 390, 844],
  ["mobile-shop", "/shop", 390, 844],
  ["mobile-real-pdp", "/product/owner-approved-qa-product", 390, 844],
  ["desktop-admin-products", "/admin/products", 1440, 1000],
  ["desktop-admin-editor", "/admin/products/new", 1440, 1000],
  ["desktop-admin-media", "/admin/media", 1440, 1000],
  ["mobile-admin-products", "/admin/products", 390, 844],
  ["mobile-admin-editor", "/admin/products/new", 390, 844],
  ["mobile-admin-media", "/admin/media", 390, 844],
];
const report = [];
for (const [name, path, width, height] of checks) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (path.startsWith("/admin")) {
    await context.addInitScript(
      ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
      { key: `sb-${projectRef}-auth-token`, session },
    );
    await context.route("**/rest/v1/rpc/is_catalog_admin", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "true",
      }),
    );
  }
  await context.route("**/rest/v1/rpc/search_public_catalog", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([publicProduct]),
    }),
  );
  await context.route("**/rest/v1/rpc/public_catalog_taxonomy", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ brands: [brand], categories: [category] }),
    }),
  );
  await context.route("**/rest/v1/brands*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([brand]),
    }),
  );
  await context.route("**/rest/v1/categories*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([category]),
    }),
  );
  await context.route("**/rest/v1/products*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([adminProduct]),
    }),
  );
  await context.route("**/rest/v1/product_media*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([mediaRecord]),
    }),
  );
  await context.route("**/rest/v1/product_variants*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: publicProduct.variants[0].id,
          sku: publicProduct.variants[0].sku,
        },
      ]),
    }),
  );
  const page = await context.newPage();
  const issues = [];
  page.on("console", (m) => {
    if (m.type() === "error") issues.push(m.text());
  });
  page.on("pageerror", (e) => issues.push(e.message));
  await page.goto(`${baseUrl}${path}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const audit = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    brokenImages: [...document.images].filter(
      (img) => img.complete && img.naturalWidth === 0,
    ).length,
  }));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  report.push({
    name,
    path,
    width,
    height,
    authorization: path.startsWith("/admin")
      ? "simulated-visual-qa-owner"
      : "simulated-published-real-fixture",
    ...audit,
    issues,
  });
  await context.close();
}
await browser.close();
await writeFile(`${out}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.some((x) => x.overflow || x.brokenImages || x.issues.length))
  process.exitCode = 1;
