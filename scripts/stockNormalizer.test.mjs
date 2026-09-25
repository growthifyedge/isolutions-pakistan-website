import assert from "node:assert/strict";
import test from "node:test";
import { catalogVariantKey, normalizeStockLines } from "../src/lib/catalogSheet.ts";

const brands = [
  { name: "Samsung" },
  { name: "Xiaomi" },
  { name: "Oppo" },
  { name: "Apple" },
  { name: "Vivo" },
  { name: "Infinix" },
  { name: "Tecno" },
  { name: "Realme" },
];
const normalize = (text) => normalizeStockLines(text, { brands }).rows;
const one = (text) => {
  const rows = normalize(text);
  assert.equal(rows.length, 1);
  return rows[0];
};

test("1. Android standard line normalizes into one clean sheet row", () => {
  const row = one("Samsung A16 6/128 Black; 42500");
  assert.equal(row.brand, "Samsung");
  assert.equal(row.fieldStatus.brand, "explicit");
  assert.equal(row.model, "A16");
  assert.equal(row.productTitle, "Samsung A16");
  assert.equal(row.slug, "samsung-a16");
  assert.equal(row.ram, "6 GB");
  assert.equal(row.storage, "128 GB");
  assert.equal(row.color, "Black");
  assert.equal(row.priceMinor, 4_250_000);
  assert.equal(row.stock, 10);
  assert.equal(row.fieldStatus.stock, "default");
  assert.equal(row.productType, "Mobile Phone");
  assert.equal(row.fieldStatus.productType, "inferred");
  assert.equal(row.deliveryScope, "karachi_only");
  assert.equal(row.fieldStatus.deliveryScope, "inferred");
  // SKU stays blank: the database assigns it (e.g. MB001) when the variant is imported.
  assert.equal(row.sku, null);
  assert.equal(row.fieldStatus.sku, "blank");
  // Never guessed: PTA, condition, warranty, category and compare-at stay blank.
  for (const field of ["ptaStatus", "condition", "conditionGrade", "warranty", "category", "compareAtPriceMinor", "batteryHealth", "cycleCount", "action"]) {
    assert.equal(row[field], null, field);
    assert.equal(row.fieldStatus[field], "blank", field);
  }
  assert.equal(row.needsReview, false);
  assert.deepEqual(row.reviewReasons, []);
});

test("1b. model family resolves a known brand without putting the brand in the model", () => {
  const galaxy = one("Galaxy A16 6/128 Black; 42500");
  assert.equal(galaxy.brand, "Samsung");
  assert.equal(galaxy.fieldStatus.brand, "inferred");
  assert.equal(galaxy.model, "Galaxy A16");
  assert.equal(galaxy.productTitle, "Samsung Galaxy A16");
  assert.equal(galaxy.slug, "samsung-galaxy-a16");
  const redmi = one("Redmi Note 14 8/256 Green; 61000");
  assert.equal(redmi.brand, "Xiaomi");
  assert.equal(redmi.model, "Redmi Note 14");
  assert.equal(redmi.productTitle, "Xiaomi Redmi Note 14");
  const oppo = one("Oppo A5 Pro 8/256 Blue; 74500");
  assert.equal(oppo.brand, "Oppo");
  assert.equal(oppo.model, "A5 Pro");
});

test("2. comma, Rs-prefixed and k prices normalize to the same minor units", () => {
  assert.equal(one("Redmi Note 14 8/256 Green; 61,000").priceMinor, 6_100_000);
  assert.equal(one("Redmi Note 14 8/256 Green; Rs 61,000").priceMinor, 6_100_000);
  assert.equal(one("Redmi Note 14 8/256 Green; 61k").priceMinor, 6_100_000);
  assert.equal(one("Redmi Note 14 8/256 Green; 42.5k").priceMinor, 4_250_000);
});

test("3. explicit Qty / Stock overrides the default of 10", () => {
  const qty = one("Oppo A5 Pro 8/256 Blue; 74500; Qty 25");
  assert.equal(qty.stock, 25);
  assert.equal(qty.fieldStatus.stock, "explicit");
  assert.equal(one("Oppo A5 Pro 8/256 Blue; 74500; Stock 3").stock, 3);
  assert.equal(one("Oppo A5 Pro 8/256 Blue; 74500; Stock 0").stock, 0);
});

test("4. used iPhone with Non-PTA, battery health and cycles", () => {
  const row = one("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312");
  assert.equal(row.brand, "Apple");
  assert.equal(row.fieldStatus.brand, "inferred");
  assert.equal(row.model, "iPhone 15 Pro");
  assert.equal(row.productTitle, "Apple iPhone 15 Pro");
  assert.equal(row.slug, "apple-iphone-15-pro");
  assert.equal(row.ram, null);
  assert.equal(row.storage, "256 GB");
  assert.equal(row.color, "Natural");
  assert.equal(row.priceMinor, 26_500_000);
  assert.equal(row.condition, "used");
  assert.equal(row.conditionGrade, "A++");
  assert.equal(row.fieldStatus.conditionGrade, "default");
  assert.equal(row.ptaStatus, "not_approved");
  assert.equal(row.batteryHealth, 89);
  assert.equal(row.cycleCount, 312);
  assert.equal(row.stock, 10);
  assert.equal(row.sku, null);
  assert.equal(row.needsReview, false);
  const variants = one("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89; Cycle 312");
  assert.equal(variants.batteryHealth, 89);
  assert.equal(variants.cycleCount, 312);
});

test("5. used phone without BH/CC keeps both blank", () => {
  const row = one("iPhone 14 128 Midnight; 150000; Used; PTA Approved");
  assert.equal(row.condition, "used");
  assert.equal(row.conditionGrade, "A++");
  assert.equal(row.batteryHealth, null);
  assert.equal(row.cycleCount, null);
  assert.equal(row.fieldStatus.batteryHealth, "blank");
  assert.equal(row.fieldStatus.cycleCount, "blank");
  assert.equal(row.sku, null);
  assert.equal(row.needsReview, false);
});

test("6. PTA Approved is recognised explicitly, including inside the identity text", () => {
  const token = one("Samsung A16 6/128 Black; 42500; PTA Approved");
  assert.equal(token.ptaStatus, "approved");
  assert.equal(token.fieldStatus.ptaStatus, "explicit");
  const inline = one("Samsung A16 6/128 Black PTA Approved; 42500");
  assert.equal(inline.ptaStatus, "approved");
  assert.equal(inline.color, "Black");
  assert.equal(one("Samsung A16 6/128 Black; 42500; Brand New").condition, "brand_new");
  assert.equal(one("Samsung A16 6/128 Black; 42500; Box Pack").condition, "brand_new");
});

test("7. unknown brand is never created and needs review", () => {
  const row = one("Nothing Phone 2a 8/128 White; 90000");
  assert.equal(row.brand, null);
  assert.equal(row.fieldStatus.brand, "needs_review");
  assert.equal(row.fieldStatus.productTitle, "needs_review");
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewReasons.includes("Brand not recognised"));
});

test("8. unknown token is kept in Notes and needs review", () => {
  const row = one("Samsung A16 6/128 Black; 42500; Dual Sim");
  assert.deepEqual(row.notes, ["Dual Sim"]);
  assert.equal(row.fieldStatus.notes, "needs_review");
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewReasons.includes("Unrecognised value: Dual Sim"));
  assert.equal(row.priceMinor, 4_250_000);
});

test("9. a 100-line batch parses without collisions or review flags", () => {
  const families = ["Samsung Galaxy A", "Redmi Note ", "Oppo Reno ", "Vivo Y", "Infinix Hot ", "Tecno Spark ", "Realme C", "Samsung Galaxy S", "Oppo A", "Vivo V"];
  const configs = ["4/64", "6/128", "8/256", "12/512"];
  const colors = ["Black", "Blue", "Green", "Silver", "Gold"];
  const lines = Array.from({ length: 100 }, (_, index) => {
    const model = `${families[index % families.length]}${10 + Math.floor(index / 10)}`;
    return `${model} ${configs[index % configs.length]} ${colors[index % colors.length]}; ${(30000 + index * 500).toLocaleString("en-US")}`;
  });
  const rows = normalize(lines.join("\n"));
  assert.equal(rows.length, 100);
  assert.deepEqual(rows.filter((row) => row.needsReview).map((row) => `${row.lineNumber}: ${row.reviewReasons}`), []);
  assert.ok(rows.every((row) => row.sku === null));
  assert.equal(new Set(rows.map(catalogVariantKey)).size, 100);
  assert.ok(rows.every((row) => row.brand && row.stock === 10 && row.priceMinor > 0));
});

test("10. same model with several colours/configurations keeps one product identity", () => {
  const rows = normalize([
    "Samsung A16 6/128 Black; 42500",
    "Samsung A16 6/128 Blue; 42500",
    "Samsung A16 8/256 Black; 49000",
    "samsung a16 8/256 Mint/Silver; 49,000",
  ].join("\n"));
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((row) => row.slug)).size, 1);
  assert.deepEqual([...new Set(rows.map((row) => row.productTitle))], ["Samsung A16"]);
  assert.deepEqual(rows.map((row) => row.color), ["Black", "Blue", "Black", "Mint", "Silver"]);
  assert.equal(new Set(rows.map(catalogVariantKey)).size, 5);
  assert.ok(rows.every((row) => !row.needsReview));
});

test("11. lowercase/mixed-case input gets canonical display casing", () => {
  const brandsWithGoogle = [...brands, { name: "Google" }];
  const cases = [
    ["samsung a16 6/128 black; 42500", "Samsung", "A16", "Samsung A16"],
    ["galaxy a16 6/128 black; 42500", "Samsung", "Galaxy A16", "Samsung Galaxy A16"],
    ["GALAXY S25 FE 8/256 navy; 150000", "Samsung", "Galaxy S25 FE", "Samsung Galaxy S25 FE"],
    ["iphone 15 pro 256 natural; 265000", "Apple", "iPhone 15 Pro", "Apple iPhone 15 Pro"],
    ["IPHONE 15 PRO MAX 512 black; 330000", "Apple", "iPhone 15 Pro Max", "Apple iPhone 15 Pro Max"],
    ["redmi note 14 pro 8/256 green; 70000", "Xiaomi", "Redmi Note 14 Pro", "Xiaomi Redmi Note 14 Pro"],
    ["poco x7 pro 12/512 black; 95000", "Xiaomi", "Poco X7 Pro", "Xiaomi Poco X7 Pro"],
    ["pixel 9 pro 16/256 obsidian; 250000", "Google", "Pixel 9 Pro", "Google Pixel 9 Pro"],
    ["oppo reno 13 5g 12/256 blue; 120000", "Oppo", "Reno 13 5G", "Oppo Reno 13 5G"],
  ];
  for (const [line, brand, model, title] of cases) {
    const [row] = normalizeStockLines(line, { brands: brandsWithGoogle }).rows;
    assert.equal(row.brand, brand, line);
    assert.equal(row.model, model, line);
    assert.equal(row.productTitle, title, line);
    assert.equal(row.needsReview, false, line);
  }
  assert.equal(one("iphone 15 pro 256 natural; 265000").color, "Natural");
});

test("12. the same model in different casing shares one slug and product identity", () => {
  const rows = normalize([
    "iPhone 15 Pro 256 Natural; 265000",
    "iphone 15 pro 256 Black; 265000",
    "IPHONE 15 PRO 512 White; 300000",
    "Apple iPhone 15 Pro 128 Blue; 240000",
  ].join("\n"));
  assert.deepEqual([...new Set(rows.map((row) => row.slug))], ["apple-iphone-15-pro"]);
  assert.deepEqual([...new Set(rows.map((row) => row.productTitle))], ["Apple iPhone 15 Pro"]);
  assert.deepEqual([...new Set(rows.map((row) => row.model))], ["iPhone 15 Pro"]);
  assert.equal(new Set(rows.map(catalogVariantKey)).size, 4);
  assert.ok(rows.every((row) => !row.needsReview && row.sku === null));
});

test("duplicates, conflicts and missing prices are flagged, never resolved silently", () => {
  const duplicate = normalize("Samsung A16 6/128 Black; 42500\nSamsung A16 6/128 Black; 43000");
  assert.equal(duplicate[0].needsReview, false);
  assert.ok(duplicate[1].reviewReasons.includes("Duplicate variant (same as line 1)"));
  assert.ok(one("Samsung A16 6/128 Black; 42500; Nationwide").reviewReasons.some((reason) => reason.includes("Karachi-only")));
  assert.ok(one("Samsung A16 6/128 Black; 42500; PTA Approved; Non-PTA").reviewReasons.includes("Conflicting PTA values"));
  assert.ok(one("Samsung A16 6/128 Black; Used").reviewReasons.includes("Price missing"));
  // A clearly price-shaped trailing value needs no separator; anything else still needs review.
  const unseparated = one("Samsung A16 6/128 Black 42500");
  assert.equal(unseparated.priceMinor, 4_250_000);
  assert.equal(unseparated.needsReview, false);
  assert.ok(one("Samsung A16 6/128 Black").reviewReasons.includes("Missing ';' separator before price"));
  assert.ok(one("Samsung A16 6/128 Black; 42500; BH 120").reviewReasons.some((reason) => reason.startsWith("Battery Health out of range")));
  // PTA and Non-PTA of the same configuration are distinct variants.
  const pta = normalize("Samsung A16 6/128 Black; 42500; PTA Approved\nSamsung A16 6/128 Black; 39000; Non-PTA");
  assert.ok(pta.every((row) => !row.needsReview));
  assert.notEqual(catalogVariantKey(pta[0]), catalogVariantKey(pta[1]));
});

test("a brand heading line sets the brand for following lines", () => {
  const rows = normalize("Samsung\nA16 6/128 Black; 42500\nA26 8/256 Blue; 55000");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.brand === "Samsung" && !row.needsReview));
  assert.deepEqual(rows.map((row) => row.productTitle), ["Samsung A16", "Samsung A26"]);
});

test("13. MacBook / laptop lines are Laptop; iPad / tab lines are Tablet; neither is a phone", () => {
  const macbook = one("MacBook Air 13 M3 256 Midnight; 330000");
  assert.equal(macbook.brand, "Apple");
  assert.equal(macbook.productType, "Laptop");
  assert.equal(macbook.fieldStatus.productType, "inferred");
  // Laptop delivery is never inferred; only mobile phones default to Karachi Only.
  assert.equal(macbook.deliveryScope, null);
  assert.equal(macbook.fieldStatus.deliveryScope, "blank");
  const karachiMacbook = one("MacBook Neo 256 Indigo; 250000; Karachi Only");
  assert.equal(karachiMacbook.productType, "Laptop");
  assert.equal(karachiMacbook.deliveryScope, "karachi_only");
  assert.equal(karachiMacbook.fieldStatus.deliveryScope, "explicit");
  assert.equal(one("Samsung Laptop Book4 16/512 Grey; 280000").productType, "Laptop");
  assert.equal(one("iPad Air 11 128 Blue; 190000").productType, "Tablet");
  assert.equal(one("Samsung Tab S9 8/128 Grey; 150000").productType, "Tablet");
  assert.equal(one("Samsung A16 6/128 Black; 42500").productType, "Mobile Phone");
  assert.equal(one("Samsung 25W Charger; 3500").productType, null);
});
