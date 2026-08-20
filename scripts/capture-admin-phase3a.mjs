import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const out = "artifacts/screenshots/admin";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const checks = [
  ["desktop-login", "/admin/login", 1440, 1000],
  ["desktop-dashboard", "/admin", 1440, 1000],
  ["desktop-products", "/admin/products", 1440, 1000],
  ["desktop-product-editor", "/admin/products/new", 1440, 1000],
  ["desktop-variant-editor", "/admin/products/new?tab=variants", 1440, 1000],
  ["mobile-dashboard", "/admin", 390, 844],
  ["mobile-product-editor", "/admin/products/new", 390, 844],
];
const report = [];
for (const [name, path, width, height] of checks) {
  const page = await browser.newPage({ viewport: { width, height } });
  const issues = [];
  page.on("console", (message) => { if (message.type() === "error") issues.push(message.text()); });
  page.on("pageerror", (error) => issues.push(error.message));
  await page.goto(`http://127.0.0.1:4176${path}`, { waitUntil: "networkidle", timeout: 60000 });
  const audit = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length }));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  report.push({ name, path, width, height, ...audit, issues });
  await page.close();
}
await browser.close();
await writeFile(`${out}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.some((item) => item.overflow || item.brokenImages || item.issues.length)) process.exitCode = 1;
