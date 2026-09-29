import assert from "node:assert/strict";
import test from "node:test";
import { catalogVariantKey, normalizeDigits, normalizeStockLines, parsePriceText, parseSimText } from "../src/lib/catalogSheet.ts";
import { normalizeColor } from "../src/lib/catalogColors.ts";

// Representative lines from a real WhatsApp wholesale stock list (emoji headings,
// Unicode bold digits, "@ price/-", abbreviated colours, section notes).
const brands = ["Samsung", "Xiaomi", "Oppo", "Apple", "Vivo", "Infinix", "Tecno", "Realme", "Honor", "Nokia", "Motorola", "Itel", "Nothing"]
  .map((name) => ({ name }));
const normalize = (text) => normalizeStockLines(text, { brands });
const rowsOf = (text) => normalize(text).rows;
const AMBIGUOUS = "Multiple/ambiguous prices detected; review price-to-color mapping.";
const SUSPICIOUS = "Price appears unusually high — verify.";
const EXTENDED_RAM = "RAM uses extended/virtual notation — verify physical RAM";

test("Unicode styled digits normalize to ASCII before parsing", () => {
  assert.equal(normalizeDigits("𝟑𝟓𝟖𝟎𝟎"), "35800"); // mathematical bold
  assert.equal(normalizeDigits("𝟏𝟒𝟗𝟓𝟎𝟎"), "149500");
  assert.equal(normalizeDigits("𝟐𝟓-𝟎𝟒-𝟐𝟔"), "25-04-26");
  assert.equal(normalizeDigits("𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡"), "0123456789"); // double-struck
  assert.equal(normalizeDigits("𝟢𝟣𝟤𝟥𝟦𝟧𝟨𝟩𝟪𝟫"), "0123456789"); // sans-serif
  assert.equal(normalizeDigits("𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵"), "0123456789"); // sans-serif bold
  assert.equal(normalizeDigits("𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿"), "0123456789"); // monospace
  assert.equal(normalizeDigits("０１２３４５６７８９"), "0123456789"); // fullwidth
  assert.equal(normalizeDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789"); // Arabic-Indic
  assert.equal(normalizeDigits("A07 4/64"), "A07 4/64");
});

test("1. brand heading + A07 with three colours and a bold price", () => {
  const { rows, summary } = normalize("🔵 ✨ Samsung ✨\nA07 4/64 black/volt/green @ 𝟑𝟓𝟖𝟎𝟎/-");
  assert.equal(summary.headings, 1);
  assert.equal(summary.productLines, 1);
  assert.equal(rows.length, 3, "one configuration, three variants — never a product from the heading");
  assert.deepEqual(rows.map((row) => row.color), ["Black", "Volt", "Green"]);
  for (const row of rows) {
    assert.equal(row.brand, "Samsung");
    assert.equal(row.model, "A07");
    assert.equal(row.productTitle, "Samsung A07");
    assert.equal(row.ram, "4 GB");
    assert.equal(row.storage, "64 GB");
    assert.equal(row.priceMinor, 3_580_000);
    assert.equal(row.productType, "Mobile Phone");
    assert.equal(row.needsReview, false, row.reviewReasons.join("; "));
  }
  assert.equal(new Set(rows.map((row) => row.slug)).size, 1);
});

test("2. S23 Ultra with four colours under a Samsung Flagship heading", () => {
  const rows = rowsOf("👑 ✨ Samsung Flagship ✨\nS23 Ultra 12/256 black/cream/lavender/green @ 𝟐𝟔𝟗𝟓𝟎𝟎/-");
  assert.deepEqual(rows.map((row) => row.color), ["Black", "Cream", "Lavender", "Green"]);
  assert.ok(rows.every((row) => row.brand === "Samsung" && row.model === "S23 Ultra" && row.productType === "Mobile Phone"));
  assert.ok(rows.every((row) => row.priceMinor === 26_950_000 && !row.needsReview));
});

test("3. Samsung Tab heading + Non Warranty note -> Tablet with inherited warranty", () => {
  const { rows, summary } = normalize("📲 ✨ Samsung Tab ✨\n▪️ Non Warranty\nA11 wifi 8/128 grey @ 𝟓𝟐𝟎𝟎𝟎/-\n━━━━━━━━━━━━\n🔵 ✨ Samsung ✨\nA16 8/256 black @ 55000");
  assert.equal(summary.contextLines, 1);
  assert.equal(summary.decorativeLines, 1);
  assert.equal(summary.headings, 2);
  const [tab, phone] = rows;
  assert.equal(tab.productType, "Tablet");
  assert.equal(tab.brand, "Samsung");
  assert.equal(tab.model, "Tab A11 WiFi");
  assert.equal(tab.warranty, "No Warranty");
  assert.equal(tab.fieldStatus.warranty, "inferred");
  assert.equal(tab.priceMinor, 5_200_000);
  assert.equal(tab.needsReview, false, tab.reviewReasons.join("; "));
  // A new heading resets the section warranty.
  assert.equal(phone.productType, "Mobile Phone");
  assert.equal(phone.warranty, null);
  assert.equal(normalize("💠 ✨ Honor ✨\n▪️ official warranty\nX9c 12/256 black @ 90000").rows[0].warranty, "Official Warranty");
});

test("4. an activation date is never read as the price", () => {
  const [row] = rowsOf("💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 𝟏𝟏𝟎𝟎𝟎𝟎 active 𝟐𝟓-𝟎𝟒-𝟐𝟔/-");
  assert.equal(row.priceMinor, 11_000_000);
  assert.equal(row.color, "Silver");
  assert.deepEqual(row.notes, ["active 25-04-26"]);
  assert.ok(!row.reviewReasons.some((reason) => reason.startsWith("Unrecognised value")));
});

test("5. two prices for one row are ambiguous and never guessed", () => {
  const [row] = rowsOf("🟢 ✨ Oppo ✨\nReno 16 5g 12/256 volt @ 𝟏𝟕𝟔𝟓𝟎𝟎/𝟏𝟕𝟖𝟓𝟎𝟎wht");
  assert.equal(row.model, "Reno 16 5G");
  assert.equal(row.priceMinor, null);
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewReasons.includes(AMBIGUOUS));
  assert.ok(!row.reviewReasons.includes("Price missing"));
  assert.deepEqual(parsePriceText("176500/178500wht"), { priceMinor: null, ambiguous: true, leftover: "176500/178500wht", leftoverTrailing: false });
});

test("6. a trailing '@' with no price stays Needs Review", () => {
  const rows = rowsOf("🔶 ✨ Tecno ✨\nSpark 50pro 8/128 black/blue/grey/orange @");
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.model === "Spark 50 Pro" && row.priceMinor === null && row.reviewReasons.includes("Price missing")));
});

test("7. a suspicious price is kept as entered and flagged, never corrected", () => {
  const rows = rowsOf([
    "✨ Motorola ✨",
    "G77 8/256 black/green @ 𝟗𝟐𝟎𝟎𝟎𝟎/-",
    "G86 8/256 blue @ 75000/-",
    "Edge 60 8/256 grey @ 98000/-",
    "G96 8/256 green @ 82000/-",
  ].join("\n"));
  const g77 = rows.filter((row) => row.model === "G77");
  assert.ok(g77.every((row) => row.priceMinor === 92_000_000 && row.reviewReasons.includes(SUSPICIOUS)));
  assert.ok(g77.every((row) => row.fieldStatus.priceMinor === "needs_review"));
  assert.ok(rows.filter((row) => row.model !== "G77").every((row) => !row.needsReview));
  // Absolute ceiling, independent of peers.
  const [extraZero] = rowsOf("✨ Motorola ✨\nG77 8/256 black @ 9200000/-");
  assert.equal(extraZero.priceMinor, 920_000_000);
  assert.ok(extraZero.reviewReasons.includes(SUSPICIOUS));
});

test("8. 3+5 RAM keeps storage and never collapses the RAM expression", () => {
  const [row] = rowsOf("🔷 ✨ Infinix ✨\nNote 60x 3+5/64 green @ 𝟐𝟗𝟓𝟎𝟎/-");
  assert.equal(row.storage, "64 GB");
  assert.equal(row.ram, "3+5 GB");
  assert.equal(row.fieldStatus.ram, "needs_review");
  assert.ok(row.notes.includes("RAM as listed: 3+5"));
  assert.ok(row.reviewReasons.includes(EXTENDED_RAM));
  assert.equal(row.priceMinor, 2_950_000);
  assert.equal(row.model, "Note 60x", "a terminal single-letter suffix keeps its casing");
});

test("9. Mi Xiaomi heading + abbreviated colours", () => {
  const rows = rowsOf("🟠 ✨ Mi Xiaomi ✨\n15 pro 5g 12/512 slv/green @ 𝟏𝟒𝟑𝟓𝟎𝟎/-");
  assert.deepEqual(rows.map((row) => row.color), ["Silver", "Green"]);
  assert.ok(rows.every((row) => row.brand === "Xiaomi" && row.model === "15 Pro 5G" && row.priceMinor === 14_350_000 && !row.needsReview));
});

test("10. supplier typo 'forst' becomes Forest", () => {
  const rows = rowsOf("🟢 ✨ Oppo ✨\nA6s pro 8/256 forst/blue @ 𝟗𝟖𝟓𝟎𝟎/-");
  assert.deepEqual(rows.map((row) => row.color), ["Forest", "Blue"]);
  assert.ok(rows.every((row) => row.priceMinor === 9_850_000 && !row.needsReview));
});

test("colour aliases are canonical; unknown colours stay visible and need review", () => {
  const cases = { blk: "Black", wht: "White", slv: "Silver", gry: "Grey", gray: "Grey", grn: "Green", blu: "Blue",
    prp: "Purple", pnk: "Pink", org: "Orange", brn: "Brown", gld: "Gold", nv: "Navy", nvy: "Navy", lav: "Lavender",
    forst: "Forest", graphite: "Graphite", VOLT: "Volt", envy: "Envy", obsidian: "Obsidian", natural: "Natural" };
  for (const [input, color] of Object.entries(cases)) assert.deepEqual(normalizeColor(input), { color, known: true }, input);
  assert.deepEqual(normalizeColor("zorbl"), { color: "Zorbl", known: false });
  const [row] = rowsOf("🔵 ✨ Samsung ✨\nA17 6/128 zorbl @ 45000");
  assert.equal(row.color, "Zorbl");
  assert.ok(row.reviewReasons.includes('Colour "Zorbl" not recognised — verify'));
});

test("headings and decoration never become products; unknown heading brands are kept for validation", () => {
  const headings = ["🔵 ✨ Samsung ✨", "👑 ✨ Samsung Flagship ✨", "📲 ✨ Samsung Tab ✨", "💙 ✨ Vivo ✨", "🟠 ✨ Mi Xiaomi ✨",
    "🟡 ✨ Realme ✨", "🟢 ✨ Oppo ✨", "🔷 ✨ Infinix ✨", "🔶 ✨ Tecno ✨", "💠 ✨ Honor ✨", "⚪ ✨ Nokia ✨", "✨ Motorola ✨",
    "🟣 ✨ Itel ✨", "⚫ ✨ Nothing ✨", "🔴 ✨ Zte ✨", "🔵 ✨ Vgotel ✨"];
  const { rows, summary } = normalize([...headings, "━━━━━━━━━━━━", "▪️ Non Warranty", "▪️ official warranty"].join("\n"));
  assert.equal(rows.length, 0);
  assert.equal(summary.headings, headings.length);
  assert.equal(summary.decorativeLines, 1);
  assert.equal(summary.contextLines, 2);
  const [zte] = rowsOf("🔴 ✨ Zte ✨\nBlade A35 4/64 black @ 25000");
  assert.equal(zte.brand, "Zte", "not an active brand here: kept as written; catalog validation flags it");
  const [pad] = rowsOf("🟠 ✨ MI Xiaomi Pad ✨\n7 8/256 grey @ 95000");
  assert.equal(pad.brand, "Xiaomi");
  assert.equal(pad.productType, "Tablet");
  assert.equal(pad.model, "Pad 7");
});

test("product type context: watches are Gadgets, gift boxes need review, feature phones need no RAM/Storage", () => {
  const [watch] = rowsOf("🔵 ✨ Samsung ✨\nWatch 8 44mm graphite @ 85000");
  assert.equal(watch.productType, "Gadget");
  const [gift] = rowsOf("🔵 ✨ Vgotel ✨\nGift Box black @ 3000");
  assert.equal(gift.productType, null);
  assert.ok(gift.reviewReasons.some((reason) => reason.startsWith("Gift Box")));
  const nokia = rowsOf("⚪ ✨ Nokia ✨\n105 black/blue @ 5500/-");
  assert.equal(nokia.length, 2);
  assert.deepEqual(nokia.map((row) => row.color), ["Black", "Blue"]);
  assert.ok(nokia.every((row) => row.productType === "Mobile Phone" && row.ram === null && row.storage === null && !row.needsReview));
  const [buds] = rowsOf("🔵 ✨ Samsung ✨\nBuds 3 white @ 15000");
  assert.equal(buds.productType, null, "accessories are never inferred as phones from a brand section");
});

test("price syntax: @, /-, Rs, PKR, bare number, no separator", () => {
  for (const line of ["A07 4/64 black @ 35800/-", "A07 4/64 black @ 35800", "A07 4/64 black @35800/-", "A07 4/64 black; Rs 35800",
    "A07 4/64 black; PKR 35800", "A07 4/64 black 35800", "A07 4/64 black Rs 35800", "A07 4/64 black 35800/-"]) {
    const [row] = rowsOf(`Samsung\n${line}`);
    assert.equal(row.priceMinor, 3_580_000, line);
    assert.equal(row.color, "Black", line);
    assert.equal(row.needsReview, false, `${line}: ${row.reviewReasons.join("; ")}`);
  }
});

test("model casing is deterministic formatting only", () => {
  const cases = [
    ["S26 plus", "S26 Plus"], ["S26 Plus", "S26 Plus"], ["Note 14pro", "Note 14 Pro"], ["Note 15pro+", "Note 15 Pro+"],
    ["17T pro", "17T Pro"], ["Reno 15pro 5g", "Reno 15 Pro 5G"], ["Phone 3A pro", "Phone 3A Pro"],
  ];
  for (const [input, model] of cases) assert.equal(rowsOf(`Samsung\n${input} 8/256 black @ 90000`)[0].model, model, input);
});

test("regression: existing simple and used-phone formats are unchanged", () => {
  const [simple] = rowsOf("Samsung A16 8/256 Black; 55000; Brand New; PTA Approved; Qty 25");
  assert.equal(simple.productTitle, "Samsung A16");
  assert.equal(simple.priceMinor, 5_500_000);
  assert.equal(simple.condition, "brand_new");
  assert.equal(simple.ptaStatus, "approved");
  assert.equal(simple.stock, 25);
  assert.equal(simple.needsReview, false);
  const [used] = rowsOf("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312");
  assert.equal(used.productTitle, "Apple iPhone 15 Pro");
  assert.equal(used.storage, "256 GB");
  assert.equal(used.color, "Natural");
  assert.equal(used.priceMinor, 26_500_000);
  assert.equal(used.condition, "used");
  assert.equal(used.ptaStatus, "not_approved");
  assert.equal(used.batteryHealth, 89);
  assert.equal(used.cycleCount, 312);
  assert.equal(used.needsReview, false);
});

// Refinement pass after the full real-list run.

test("'+' is part of product identity: Pro vs Pro+, X5c vs X5c+, A200+", () => {
  const xiaomi = rowsOf("🟠 ✨ Mi Xiaomi ✨\nNote 15pro 12/512 black/blue/titanium @ 109500/-\nNote 15pro+ 12/512 black/blue/brown @ 159500/-");
  const pro = xiaomi.filter((row) => row.model === "Note 15 Pro");
  const plus = xiaomi.filter((row) => row.model === "Note 15 Pro+");
  assert.equal(pro.length, 3);
  assert.equal(plus.length, 3);
  assert.equal(pro[0].slug, "xiaomi-note-15-pro");
  assert.equal(plus[0].slug, "xiaomi-note-15-pro-plus");
  assert.ok(xiaomi.every((row) => !row.needsReview), "no false duplicate between Pro and Pro+");
  const honor = rowsOf("💠 ✨ Honor ✨\nX5c 4/64 black/blue @ 32400/-\nX5c+ 4/128 black/cyan @ 35200/-");
  assert.deepEqual([...new Set(honor.map((row) => row.model))], ["X5c", "X5c+"]);
  assert.deepEqual([...new Set(honor.map((row) => row.slug))], ["honor-x5c", "honor-x5c-plus"]);
  const [itel] = rowsOf("🟣 ✨ Itel ✨\nA200+ 3/128 orange @ 31500/-");
  assert.equal(itel.model, "A200+");
  assert.equal(itel.productTitle, "Itel A200+");
  assert.equal(itel.slug, "itel-a200-plus");
});

test("known glued suffix words split; other strings keep their boundaries", () => {
  const cases = [
    ["Mi Xiaomi", "A7pro 4/64 black", "A7 Pro"],
    ["Vivo", "V80lite 8/128 blue", "V80 Lite"],
    ["Oppo", "Reno 15pro 5g 12/512 brown", "Reno 15 Pro 5G"],
    ["Tecno", "Spark 50pro 8/128 black", "Spark 50 Pro"],
    ["Infinix", "GT 50pro 12/256 black", "GT 50 Pro"],
    ["Oppo", "A6s pro 8/256 blue", "A6s Pro"],
    ["Vivo", "V70FE 8/256 silver", "V70 FE"],
    ["Nokia", "HMD 106 2026 green", "HMD 106 2026"],
    ["Nokia", "hmd 102 blue", "HMD 102"],
  ];
  for (const [heading, line, model] of cases) assert.equal(rowsOf(`✨ ${heading} ✨\n${line} @ 50000/-`)[0].model, model, line);
  const [hmd] = rowsOf("⚪ ✨ Nokia ✨\nHMD 106 2026 green @ 3400/-");
  assert.equal(hmd.brand, "Nokia", "HMD stays part of the model; no brand is inferred");
  assert.equal(hmd.productTitle, "Nokia HMD 106 2026");
});

test("terminal single-letter model suffixes keep their casing", () => {
  const models = ["Y05e", "Y11d", "Y31d", "A6c", "A6k", "A6s", "C100i", "C100x", "X5c", "X6c", "A50c", "A100c", "Hot 60i"];
  for (const model of models) assert.equal(rowsOf(`Vivo\n${model} 4/64 black @ 36900/-`)[0].model, model);
  assert.equal(rowsOf("Vivo\ny05e 4/64 black @ 36900/-")[0].model, "Y05e", "series letter is upper-cased, suffix kept");
  assert.equal(rowsOf("Honor\nX9D 12/256 black @ 139000/-")[0].model, "X9D", "an upper-case suffix is kept as written");
});

test("a screen size is never a colour and is preserved in Notes", () => {
  const [pad] = rowsOf("🟠 ✨ Mi Xiaomi ✨\nPad 2 Wifi 4/64 9.7” silver @ 𝟓𝟔𝟓𝟎𝟎/-");
  assert.equal(pad.color, "Silver");
  assert.equal(pad.model, "Pad 2 WiFi");
  assert.equal(pad.productType, "Tablet");
  assert.ok(pad.notes.includes("Screen size as listed: 9.7”"));
  assert.equal(pad.needsReview, false, pad.reviewReasons.join("; "));
  const [tab] = rowsOf('Samsung\nTab S10 10.1" 8/128 grey @ 90000');
  assert.equal(tab.color, "Grey");
  assert.equal(tab.model, "Tab S10");
  assert.ok(tab.notes.includes('Screen size as listed: 10.1"'));
});

test("whitespace-separated colour text is kept as one value and flagged, never split", () => {
  const rows = rowsOf("🔵 ✨ Samsung ✨\nA37 8/256 lavender/charcoal/sky blue @ 𝟏𝟑𝟒𝟖𝟎𝟎/-");
  assert.deepEqual(rows.map((row) => row.color), ["Lavender", "Charcoal", "Sky Blue"]);
  // Only the multi-word colour's own variant is flagged.
  assert.deepEqual(
    rows.map((row) => row.reviewReasons.includes('Multi-word colour value "Sky Blue" — verify')),
    [false, false, true],
  );
});

test("'Grey Green' is an Owner-confirmed supplier colour: clean, displayed exactly", () => {
  const source = "🔵 ✨ Samsung ✨\nA37 8/256 lavender/charcoal/grey green @ 𝟏𝟑𝟒𝟖𝟎𝟎/-";
  const rows = rowsOf(source);
  assert.deepEqual(rows.map((row) => row.color), ["Lavender", "Charcoal", "Grey Green"]);
  for (const row of rows) {
    assert.equal(row.needsReview, false, `${row.color}: ${row.reviewReasons.join("; ")}`);
    assert.deepEqual(row.reviewReasons, [], row.color);
    assert.equal(row.fieldStatus.color, "explicit", row.color);
    assert.equal(row.priceMinor, 13_480_000);
    assert.deepEqual([row.ram, row.storage], ["8 GB", "256 GB"]);
    assert.equal(row.productTitle, rows[0].productTitle);
  }
  assert.equal(new Set(rows.map(catalogVariantKey)).size, 3);
  assert.equal(normalizeColor("grey green").color, "Grey Green");
  // Other multi-word colours are still flagged; no generic multi-word acceptance.
  for (const color of ["Grey Blue", "Green Grey", "Mystic Bronze"]) {
    const [row] = rowsOf(`🔵 ✨ Samsung ✨\nA37 8/256 ${color.toLowerCase()} @ 134800/-`);
    assert.equal(row.color, color);
    assert.ok(row.reviewReasons.includes(`Multi-word colour value "${color}" — verify`), color);
  }
});

test("'officail warranty' is Official Warranty metadata, never a heading or product", () => {
  const { rows, summary } = normalize("✨ Motorola ✨\n▪️ officail warranty\nG86 8/256 blue @ 75000/-");
  assert.equal(summary.headings, 1);
  assert.equal(summary.contextLines, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brand, "Motorola", "the typo note does not reset the section brand");
  assert.equal(rows[0].warranty, "Official Warranty");
  const trailing = normalize("✨ Motorola ✨\nG77 8/256 black @ 92000/-\n▪️ officail warranty");
  assert.equal(trailing.rows[0].warranty, null, "notes are never applied to earlier rows");
  assert.equal(trailing.summary.contextLines, 1);
  assert.equal(rowsOf("Samsung A16 6/128 Black; 42500; Officail Warranty")[0].warranty, "Official Warranty");
});

const CONFLICT = "Same variant is listed more than once with conflicting commercial data — review.";
const unrecognised = (row) => row.reviewReasons.filter((reason) => reason.startsWith("Unrecognised value"));

test("trailing 'active <date>' / 'non' after a price stay in Notes without unrecognised-value review", () => {
  const [active, non] = rowsOf("💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 110000 active 25-04-26/-\nV70FE 12/256 blue @ 137000 non");
  assert.deepEqual(active.notes, ["active 25-04-26"]);
  assert.deepEqual(non.notes, ["non"]);
  // The notes change no field and never enter variant identity.
  const [plainActive, plainNon] = rowsOf("💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 110000\nV70FE 12/256 blue @ 137000");
  for (const [row, plain] of [[active, plainActive], [non, plainNon]]) {
    assert.deepEqual(unrecognised(row), []);
    assert.equal(row.needsReview, false, row.reviewReasons.join("; "));
    for (const field of ["ptaStatus", "condition", "conditionGrade", "warranty", "productType", "deliveryScope", "priceMinor", "slug"]) {
      assert.equal(row[field], plain[field], field);
    }
    assert.equal(catalogVariantKey(row), catalogVariantKey(plain));
  }
});

test("V70FE: same identity with different prices stays blocked; 12/256 'non' row is clean", () => {
  const rows = rowsOf("💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 110000 active 25-04-26/-\nV70FE 8/256 silver @ 119500 non\nV70FE 12/256 blue/silver @ 137000 non");
  const [active, non, blue, silver] = rows;
  assert.deepEqual([active.priceMinor, non.priceMinor], [11_000_000, 11_950_000], "both prices kept, none chosen");
  for (const row of [active, non]) {
    assert.ok(row.needsReview);
    assert.ok(row.reviewReasons.includes(CONFLICT));
  }
  for (const row of [blue, silver]) {
    assert.equal(row.priceMinor, 13_700_000);
    assert.deepEqual(row.notes, ["non"]);
    assert.equal(row.needsReview, false, row.reviewReasons.join("; "));
  }
});

test("trailing 'with charger' after a price is kept in Notes without review; other charger text is not swallowed", () => {
  // Exact supplier line: glued price, plug emoji.
  const nokia = rowsOf("⚪ ✨ 𝐍𝐨𝐤𝐢𝐚 ✨\n▪️ 105 pure blue/charcoal @ 𝟐𝟕𝟓𝟎with 🔌 charger");
  const plain = rowsOf("⚪ ✨ 𝐍𝐨𝐤𝐢𝐚 ✨\n▪️ 105 pure blue/charcoal @ 𝟐𝟕𝟓𝟎/-");
  assert.equal(nokia.length, 2);
  nokia.forEach((row, index) => {
    assert.deepEqual(row.notes, ["with charger"]);
    assert.deepEqual(unrecognised(row), []);
    assert.equal(row.needsReview, false, row.reviewReasons.join("; "));
    for (const field of ["priceMinor", "ptaStatus", "condition", "warranty", "productType", "sku", "category", "productTitle", "slug", "color"]) {
      assert.equal(row[field], plain[index][field], field);
    }
    assert.equal(catalogVariantKey(row), catalogVariantKey(plain[index]));
  });
  // Other charger wording still needs review.
  for (const note of ["without charger", "charger missing", "charger damaged", "with charger missing"]) {
    const [row] = rowsOf(`⚪ ✨ Nokia ✨\n105 pure blue @ 2750 ${note}`);
    assert.deepEqual(unrecognised(row), [`Unrecognised value: ${note}`], note);
    assert.ok(row.needsReview, note);
  }
  // Charger before the price is not trailing metadata.
  const [before] = rowsOf("⚪ ✨ Nokia ✨\n105 pure blue @ with charger 2750");
  assert.equal(unrecognised(before).length, 1);
  // Product/model text containing "charger" is not altered.
  const [product] = rowsOf("Samsung 25W Charger White; 3500");
  assert.match(product.productTitle ?? "", /Charger/i);
  assert.deepEqual(product.notes, []);
});

test("the trailing rule is narrow: Non-PTA, Non Warranty, Non Active and other leftovers keep their meaning", () => {
  const [nonPta] = rowsOf("💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 110000; Non-PTA");
  assert.equal(nonPta.ptaStatus, "not_approved");
  const [identityNonPta] = rowsOf("Samsung A16 non pta 6/128 Black; 42500");
  assert.equal(identityNonPta.ptaStatus, "not_approved");
  const { rows: tab } = normalize("📲 ✨ Samsung Tab ✨\n▪️ Non Warranty\nA11 wifi 8/128 grey @ 52000 non");
  assert.equal(tab[0].warranty, "No Warranty");
  assert.deepEqual(tab[0].notes, ["non"]);
  assert.equal(rowsOf("Samsung A16 6/128 Black; 42500; Non Warranty")[0].warranty, "No Warranty");
  // "Non Active" is not the exact standalone "non" form: kept and reviewed, never swallowed.
  const [nonActive] = rowsOf("🍎 ✨ Apple ✨\niPhone 15 128 black @ 150000 Non Active iPhone");
  assert.deepEqual(nonActive.notes, ["Non Active iPhone"]);
  assert.deepEqual(unrecognised(nonActive), ["Unrecognised value: Non Active iPhone"]);
  // Model text containing "non" is untouched.
  const [nonTitle] = rowsOf("🍎 ✨ Apple ✨\nNon Active iPhone 15 128 black @ 150000");
  assert.match(nonTitle.productTitle ?? "", /Non Active/i);
  // Only exact trailing forms: "non" before the price, "active" without a date, or extra words still need review.
  for (const line of ["V70FE 8/256 silver @ non 110000", "V70FE 8/256 silver @ 110000 active", "V70FE 8/256 silver @ 110000 non stock"]) {
    const [row] = rowsOf(`💙 ✨ Vivo ✨\n${line}`);
    assert.equal(unrecognised(row).length, 1, line);
  }
});

test("extended/virtual RAM notation stays distinct, never summed or blanked", () => {
  const rows = rowsOf([
    "🟡 ✨ Realme ✨",
    "Note 60x 3+5/64 green @ 𝟐𝟗𝟓𝟎𝟎/-",
    "Note 60x 4+4/64 green @ 𝟑𝟑𝟓𝟎𝟎/-",
    "🔴 ✨ Zte ✨",
    "A36 4+8/64 gold/green @ 𝟐𝟖𝟑𝟎𝟎/-",
  ].join("\n"));
  const [threePlusFive, fourPlusFour, ...fourPlusEight] = rows;
  // 1-3. The expression is the RAM display value; storage parses normally; never 8 GB / 12 GB.
  assert.equal(threePlusFive.ram, "3+5 GB");
  assert.equal(fourPlusFour.ram, "4+4 GB");
  assert.equal(fourPlusEight.length, 2);
  assert.ok(fourPlusEight.every((row) => row.ram === "4+8 GB"));
  assert.ok(rows.every((row) => row.storage === "64 GB" && row.ram !== "8 GB" && row.ram !== "12 GB"));
  // 4. 3+5 and 4+4 of the same model/colour are different variants, not duplicates.
  assert.notEqual(catalogVariantKey(threePlusFive), catalogVariantKey(fourPlusFour));
  assert.ok(rows.every((row) => !row.reviewReasons.some((reason) => reason.startsWith("Duplicate variant"))));
  // 5. All remain Needs Review with the RAM field marked.
  for (const row of rows) {
    assert.equal(row.needsReview, true);
    assert.ok(row.reviewReasons.includes(EXTENDED_RAM));
    assert.equal(row.fieldStatus.ram, "needs_review");
  }
  // 6. The original notation is preserved in Notes; no physical RAM is guessed either way.
  assert.deepEqual(rows.map((row) => row.notes), [["RAM as listed: 3+5"], ["RAM as listed: 4+4"], ["RAM as listed: 4+8"], ["RAM as listed: 4+8"]]);
  assert.ok(rows.every((row) => !["3 GB", "4 GB", "5 GB", "8 GB", "12 GB"].includes(row.ram)));
});

test("a colour-specific review reason stays on that colour's variant only", async () => {
  const rows = rowsOf("🔵 ✨ Samsung ✨\nA37 8/256 lavender/charcoal/sky blue @ 𝟏𝟑𝟒𝟖𝟎𝟎/-");
  const byColor = Object.fromEntries(rows.map((row) => [row.color, row]));
  const multiWord = 'Multi-word colour value "Sky Blue" — verify';
  assert.deepEqual(Object.keys(byColor), ["Lavender", "Charcoal", "Sky Blue"]);
  for (const color of ["Lavender", "Charcoal"]) {
    assert.deepEqual(byColor[color].reviewReasons, [], color);
    assert.equal(byColor[color].needsReview, false, color);
    assert.equal(byColor[color].fieldStatus.color, "explicit", color);
  }
  assert.deepEqual(byColor["Sky Blue"].reviewReasons, [multiWord]);
  assert.equal(byColor["Sky Blue"].fieldStatus.color, "needs_review");
  // Arrays are independent: mutating one variant never touches its siblings.
  byColor.Lavender.reviewReasons.push("probe");
  assert.deepEqual(byColor.Charcoal.reviewReasons, []);
  byColor.Lavender.reviewReasons.pop();
  // Line-level issues still apply to every colour of the line.
  const missing = rowsOf("Tecno\nSpark 50pro 8/128 black/zorbl @");
  assert.ok(missing.every((row) => row.reviewReasons.includes("Price missing")));
  assert.deepEqual(missing.map((row) => row.reviewReasons.some((reason) => reason.startsWith("Colour"))), [false, true]);
  // In the preview the product still needs review because one variant does.
  const { catalogSheetToBulkParseResult } = await import("../src/lib/catalogWorkbook.ts");
  const [product] = catalogSheetToBulkParseResult({ rows, specifications: [] }).products;
  assert.deepEqual(product.variants.map((variant) => variant.warnings.length), [0, 0, 1]);
  assert.ok(product.variants.some((variant) => variant.warnings.includes(multiWord)));
});

test("a bare 'Gift box' freebie line is ignored without breaking the section context", () => {
  const { rows, summary } = normalize("🟡 ✨ 𝐑𝐞𝐚𝐥𝐦𝐞 ✨\n▪️ Gift box @ 𝟕𝟓𝟎/-\n▪️ C100i 4/64 grey/purple @ 𝟑𝟔𝟖𝟎𝟎/-\nGIFT BOX\ngift box @750");
  assert.equal(summary.nonProductLines, 3);
  assert.equal(summary.productLines, 1);
  assert.ok(rows.every((row) => !/gift/i.test(row.productTitle ?? "")), "no Gift Box product or variant");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.brand === "Realme" && row.model === "C100i" && row.productType === "Mobile Phone"));
  assert.deepEqual(rows.map((row) => row.color), ["Grey", "Purple"]);
  assert.ok(rows.every((row) => !row.needsReview), rows.flatMap((row) => row.reviewReasons).join("; "));
  // Narrow rule: other accessory lines are still parsed and reviewed, never silently dropped.
  const [buds] = rowsOf("🔵 ✨ Samsung ✨\nBuds 3 white @ 15000");
  assert.equal(buds.model, "Buds 3");
  const [boxWithColour] = rowsOf("🔵 ✨ Vgotel ✨\nGift Box black @ 3000");
  assert.ok(boxWithColour.reviewReasons.some((reason) => reason.startsWith("Gift Box")));
});

// ---------------------------------------------------------------------------
// SIM Configuration from supplier wording (never inferred; not part of identity)
// ---------------------------------------------------------------------------

const APPLE = "🍎 ✨ Apple ✨\n";
const simRow = (text) => {
  const [row] = rowsOf(text);
  return row;
};

test("SIM 1-6. each Owner-approved phrase maps to its SIM Configuration", () => {
  const cases = [
    ["Physical SIM", "physical_sim"], ["Physical", "physical_sim"], ["Single Physical SIM", "physical_sim"],
    ["eSIM", "esim"], ["eSIM Only", "esim"], ["eSIM Ready", "esim"],
    ["Physical + eSIM", "physical_plus_esim"], ["Physical/eSIM", "physical_plus_esim"],
    ["Physical & eSIM", "physical_plus_esim"], ["1 Physical + eSIM", "physical_plus_esim"],
    ["Dual eSIM", "dual_esim"], ["Both eSIM", "dual_esim"], ["Both eSIM Ready", "dual_esim"],
    ["2 eSIM", "dual_esim"], ["Two eSIM", "dual_esim"],
  ];
  for (const [phrase, expected] of cases) {
    assert.equal(parseSimText(phrase), expected, phrase);
    // As an attribute after the price...
    const token = simRow(`${APPLE}iPhone 17 Pro 256 Orange @ 450000; ${phrase}`);
    assert.equal(token.simConfiguration, expected, `token: ${phrase}`);
    assert.equal(token.fieldStatus.simConfiguration, "explicit");
    assert.deepEqual([token.needsReview, token.notes], [false, []], `${phrase}: ${token.reviewReasons}`);
  }
});

test("SIM: phrases in the identity text or straight after the price are lifted out", () => {
  const expected = { productTitle: "Apple 18 Pro Max", storage: "256 GB", color: "Blue", priceMinor: 49_000_000, simConfiguration: "dual_esim" };
  for (const line of [
    "18pro Max 256 Blue Both eSIM Ready @ 490,000",
    "18pro Max 256 Blue @ 490,000 Both eSIM Ready",
    "18pro Max 256 Blue @ 490,000; Both eSIM Ready",
    "18pro Max 256 blue both esim @490,000",
  ]) {
    const row = simRow(`${APPLE}${line}`);
    assert.deepEqual(
      { productTitle: row.productTitle, storage: row.storage, color: row.color, priceMinor: row.priceMinor, simConfiguration: row.simConfiguration },
      expected, line,
    );
    assert.equal(row.needsReview, false, `${line}: ${row.reviewReasons}`);
  }
  // Colour-expanded lines give every variant the same SIM.
  const rows = rowsOf(`${APPLE}17 Pro 256 orange/blue Physical + eSIM @ 450000`);
  assert.deepEqual(rows.map((row) => [row.color, row.simConfiguration]), [["Orange", "physical_plus_esim"], ["Blue", "physical_plus_esim"]]);
  // Used-phone facts still parse alongside the SIM.
  const used = simRow("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312; Physical + eSIM");
  assert.deepEqual([used.condition, used.batteryHealth, used.cycleCount, used.simConfiguration], ["used", 89, 312, "physical_plus_esim"]);
});

test("SIM 7. case and spacing variants", () => {
  for (const [phrase, expected] of [
    ["BOTH ESIM READY", "dual_esim"], ["both   esim   ready", "dual_esim"], ["  Dual eSim  ", "dual_esim"], ["2esim", "dual_esim"],
    ["PHYSICAL+ESIM", "physical_plus_esim"], ["physical  /  esim", "physical_plus_esim"], ["1  physical+esim", "physical_plus_esim"],
    ["physical   sim", "physical_sim"], ["ESIM ONLY", "esim"], ["esim  ready", "esim"],
  ]) {
    assert.equal(parseSimText(phrase), expected, phrase);
    assert.equal(simRow(`${APPLE}17 Pro 256 Orange @ 450000; ${phrase}`).simConfiguration, expected, phrase);
  }
});

test("SIM 8. no SIM wording leaves SIM Configuration NULL (never inferred)", () => {
  for (const line of [`${APPLE}17 Pro Max 256 Orange @ 450000`, "iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA", "Samsung A16 6/128 Black; 42500"]) {
    const row = simRow(line);
    assert.equal(row.simConfiguration, null, line);
    assert.equal(row.fieldStatus.simConfiguration, "blank");
  }
});

test("SIM 9. unrecognised SIM-like wording stays unresolved and needs review", () => {
  for (const phrase of ["Dual SIM", "Single SIM", "eSIM Supported", "Nano SIM", "e-SIM", "Physical eSIM Ready"]) {
    assert.equal(parseSimText(phrase), null, phrase);
    const row = simRow(`${APPLE}17 Pro 256 Orange @ 450000; ${phrase}`);
    assert.equal(row.simConfiguration, null, phrase);
    assert.equal(row.needsReview, true, phrase);
    assert.ok(row.reviewReasons.includes(`Unrecognised value: ${phrase}`), `${phrase}: ${row.reviewReasons}`);
  }
  // Inside the identity it is never guessed: it stays visible in the colour and needs review.
  const inline = simRow(`${APPLE}17 Pro 256 Orange Dual SIM @ 450000`);
  assert.equal(inline.simConfiguration, null);
  assert.equal(inline.needsReview, true);
  // Bare "Physical" is only a SIM value as a whole attribute token.
  assert.equal(simRow(`${APPLE}17 Pro 256 Physical @ 450000`).simConfiguration, null);
  // Two different SIM values for one row conflict and need review.
  const conflict = simRow(`${APPLE}17 Pro 256 Orange eSIM @ 450000; Dual eSIM`);
  assert.ok(conflict.reviewReasons.includes("Conflicting SIM Configuration values"));
});

test("SIM 10. SIM wording never changes product or variant identity", () => {
  const plain = simRow(`${APPLE}18pro Max 256 Blue @ 490000`);
  const withSim = simRow(`${APPLE}18pro Max 256 Blue Both eSIM Ready @ 490000`);
  for (const field of ["brand", "model", "productTitle", "slug", "ram", "storage", "color", "productType", "priceMinor"])
    assert.equal(withSim[field], plain[field], field);
  assert.equal(catalogVariantKey(withSim), catalogVariantKey(plain));
  // Two rows that differ only by SIM are still one variant: flagged as a duplicate.
  const rows = rowsOf(`${APPLE}17 Pro 256 Orange eSIM @ 450000\n17 Pro 256 Orange Physical SIM @ 450000`);
  assert.equal(new Set(rows.map(catalogVariantKey)).size, 1);
  assert.ok(rows[1].reviewReasons.some((reason) => reason.startsWith("Duplicate variant")));
});

// ---------------------------------------------------------------------------
// Multi-line listings: SIM and "@ price" lines continue the product line above
// ---------------------------------------------------------------------------

const summarize = (row) => ({
  productTitle: row.productTitle, model: row.model, productType: row.productType,
  priceMinor: row.priceMinor, simConfiguration: row.simConfiguration, reviewReasons: row.reviewReasons,
});
const PRO_MAX = { productTitle: "Apple 18 Pro Max", model: "18 Pro Max", productType: "Mobile Phone", priceMinor: 49_000_000, simConfiguration: "dual_esim", reviewReasons: [] };

test("multi-line 1-3. model / SIM / @price lines (any order) become one clean row", () => {
  for (const block of [
    "18pro Max\nBoth Esim Ready\n@490,000",
    "18pro Max\n@490,000\nBoth Esim Ready",
    "18pro Max\nBoth eSIM\n@490000",
    "18pro Max\n  both   esim   ready  \n@ 490,000/-",
  ]) {
    const { rows, summary } = normalize(`${APPLE}${block}`);
    assert.equal(rows.length, 1, block);
    assert.deepEqual(summarize(rows[0]), PRO_MAX, block);
    assert.equal(rows[0].needsReview, false);
    assert.equal(rows[0].lineNumber, 2, "the row keeps the model line's number");
    assert.deepEqual([summary.productLines, summary.continuationLines], [1, 2]);
  }
  const [row] = rowsOf(`${APPLE}18pro Max\nBoth Esim Ready\n@490,000`);
  assert.equal(row.sourceLine, "18pro Max | Both Esim Ready | @490,000");
});

test("multi-line 4. two consecutive listings stay two products", () => {
  const rows = rowsOf(`${APPLE}18pro Max\nBoth eSIM Ready\n@490000\n18 Pro\nPhysical + eSIM\n@450000`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.productTitle, row.priceMinor, row.simConfiguration]), [
    ["Apple 18 Pro Max", 49_000_000, "dual_esim"],
    ["Apple 18 Pro", 45_000_000, "physical_plus_esim"],
  ]);
  assert.ok(rows.every((row) => !row.needsReview), rows.flatMap((row) => row.reviewReasons).join("; "));
  // Complete single-line listings are never joined to each other.
  const singles = rowsOf(`${APPLE}17 Pro 256 Orange @ 450000\n17 Pro Max 256 Blue @ 490000`);
  assert.deepEqual(singles.map((row) => [row.model, row.priceMinor]), [["17 Pro", 45_000_000], ["17 Pro Max", 49_000_000]]);
});

test("multi-line 5. headings, separators, notes and blank lines end a listing and are never absorbed", () => {
  const { rows, summary } = normalize(
    `${APPLE}18pro Max\nBoth eSIM Ready\n🔵 ✨ Samsung ✨\n@490000\nA16 8/256 black\n@55000`,
  );
  assert.equal(summary.headings, 2);
  // The Apple listing ended at the Samsung heading: it has no price and needs review.
  const [iphone, orphanPrice, samsung] = rows;
  assert.deepEqual([iphone.productTitle, iphone.simConfiguration, iphone.priceMinor], ["Apple 18 Pro Max", "dual_esim", null]);
  assert.ok(iphone.reviewReasons.includes("Price missing"));
  // A price right after a heading has no listing to continue: it stays a blocked row, as before.
  assert.deepEqual([orphanPrice.model, orphanPrice.priceMinor], [null, 49_000_000]);
  assert.ok(orphanPrice.reviewReasons.includes("Model missing"));
  // The Samsung listing continues with its own price, under its own heading.
  assert.deepEqual([samsung.productTitle, samsung.color, samsung.priceMinor, samsung.needsReview], ["Samsung A16", "Black", 5_500_000, false]);

  for (const boundary of ["", "━━━━━━━━━━━━", "▪️ Non Warranty", "Gift box"]) {
    const split = rowsOf(`${APPLE}18pro Max\n${boundary}\nBoth eSIM Ready\n@490000`);
    assert.ok(split.length >= 2, `boundary ${JSON.stringify(boundary)}`);
    assert.equal(split[0].priceMinor, null, `boundary ${JSON.stringify(boundary)}`);
    assert.equal(split[0].simConfiguration, null, `boundary ${JSON.stringify(boundary)}`);
  }
});

test("multi-line 6. only SIM and @price lines continue; other lines start a new product", () => {
  // A second price never overwrites a listing that already has one.
  const twoPrices = rowsOf(`${APPLE}18pro Max @490000\n@480000`);
  assert.equal(twoPrices.length, 2);
  assert.equal(twoPrices[0].priceMinor, 49_000_000);
  assert.ok(twoPrices[1].reviewReasons.includes("Model missing"));
  // A SIM line after a complete one-line listing belongs to that listing.
  const [afterPrice] = rowsOf(`${APPLE}17 Pro 256 Orange @ 450000\neSIM Only`);
  assert.deepEqual([afterPrice.priceMinor, afterPrice.simConfiguration, afterPrice.needsReview], [45_000_000, "esim", false]);
  // Unrecognised SIM-like wording is not a continuation: it stays its own reviewed row.
  const unknown = rowsOf(`${APPLE}18pro Max\nDual SIM\n@490000`);
  assert.equal(unknown[0].priceMinor, null);
  assert.ok(unknown.some((row) => row.needsReview));
  // A "@" line that is not a price is not joined either.
  assert.equal(rowsOf(`${APPLE}18pro Max\n@ call for price`)[0].priceMinor, null);
  // Two SIM lines for one listing conflict and need review.
  const [conflict] = rowsOf(`${APPLE}18pro Max\neSIM\nDual eSIM\n@490000`);
  assert.ok(conflict.reviewReasons.includes("Conflicting SIM Configuration values"));
});

test("multi-line 7. no-SIM listing with a price on the next line; colours and identity unchanged", () => {
  const rows = rowsOf("🔵 ✨ Samsung ✨\nA07 4/64 black/volt/green\n@ 𝟑𝟓𝟖𝟎𝟎/-");
  assert.deepEqual(rows.map((row) => [row.productTitle, row.color, row.priceMinor, row.simConfiguration, row.needsReview]), [
    ["Samsung A07", "Black", 3_580_000, null, false],
    ["Samsung A07", "Volt", 3_580_000, null, false],
    ["Samsung A07", "Green", 3_580_000, null, false],
  ]);
  // Same rows and variant keys as the single-line form.
  const single = rowsOf("🔵 ✨ Samsung ✨\nA07 4/64 black/volt/green @ 𝟑𝟓𝟖𝟎𝟎/-");
  assert.deepEqual(rows.map(catalogVariantKey), single.map(catalogVariantKey));
  const strip = (row) => ({ ...row, sourceLine: null });
  assert.deepEqual(rows.map(strip), single.map(strip));
});
