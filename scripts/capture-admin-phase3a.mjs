import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index).trim(),
        line
          .slice(index + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ];
    }),
);
const projectRef = new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0];
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const visualQaToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expiresAt, sub: "visual-qa-owner" })}.visual-qa`;
const visualQaSession = {
  access_token: visualQaToken,
  refresh_token: "visual-qa-only",
  expires_at: expiresAt,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "visual-qa-owner", aud: "authenticated", role: "authenticated" },
};

const out = "artifacts/screenshots/admin";
const baseUrl = process.env.PHASE3B_QA_BASE_URL ?? "http://127.0.0.1:4176";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const checks = [
  ["desktop-login", "/admin/login", 1440, 1000],
  ["desktop-dashboard", "/admin", 1440, 1000],
  ["desktop-products", "/admin/products", 1440, 1000],
  ["desktop-product-editor", "/admin/products/new", 1440, 1000],
  ["desktop-variant-editor", "/admin/products/new?tab=variants", 1440, 1000],
  ["desktop-media-preconnection", "/admin/products/new?tab=media", 1440, 1000],
  ["mobile-dashboard", "/admin", 390, 844],
  ["mobile-product-editor", "/admin/products/new", 390, 844],
  ["mobile-media-preconnection", "/admin/products/new?tab=media", 390, 844],
];
const report = [];
for (const [name, path, width, height] of checks) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (path !== "/admin/login") {
    await context.addInitScript(
      ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
      { key: `sb-${projectRef}-auth-token`, session: visualQaSession },
    );
    await context.route("**/rest/v1/rpc/is_catalog_admin", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "true",
      }),
    );
  }
  const page = await context.newPage();
  const issues = [];
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(message.text());
  });
  page.on("pageerror", (error) => issues.push(error.message));
  await page.goto(`${baseUrl}${path}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const audit = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    brokenImages: [...document.images].filter(
      (image) => !image.complete || image.naturalWidth === 0,
    ).length,
  }));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  report.push({
    name,
    path,
    width,
    height,
    authorization:
      path === "/admin/login" ? "public-login" : "simulated-visual-qa-owner",
    ...audit,
    issues,
  });
  await context.close();
}
await browser.close();
await writeFile(`${out}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (
  report.some(
    (item) => item.overflow || item.brokenImages || item.issues.length,
  )
)
  process.exitCode = 1;
