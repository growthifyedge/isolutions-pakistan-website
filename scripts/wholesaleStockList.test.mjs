import assert from "node:assert/strict";
import test from "node:test";
import { catalogVariantKey, normalizeDigits, normalizeStockLines, parsePriceText } from "../src/lib/catalogSheet.ts";
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
  assert.ok(row.reviewReasons.includes("Unrecognised value: active 25-04-26"));
});

test("5. two prices for one row are ambiguous and never guessed", () => {
  const [row] = rowsOf("🟢 ✨ Oppo ✨\nReno 16 5g 12/256 volt @ 𝟏𝟕𝟔𝟓𝟎𝟎/𝟏𝟕𝟖𝟓𝟎𝟎wht");
  assert.equal(row.model, "Reno 16 5G");
  assert.equal(row.priceMinor, null);
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewReasons.includes(AMBIGUOUS));
  assert.ok(!row.reviewReasons.includes("Price missing"));
  assert.deepEqual(parsePriceText("176500/178500wht"), { priceMinor: null, ambiguous: true, leftover: "176500/178500wht" });
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
  const rows = rowsOf("🔵 ✨ Samsung ✨\nA37 8/256 lavender/charcoal/grey green @ 𝟏𝟑𝟒𝟖𝟎𝟎/-");
  assert.deepEqual(rows.map((row) => row.color), ["Lavender", "Charcoal", "Grey Green"]);
  // Only the multi-word colour's own variant is flagged.
  assert.deepEqual(
    rows.map((row) => row.reviewReasons.includes('Multi-word colour value "Grey Green" — verify')),
    [false, false, true],
  );
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

test("active / non stay in Notes and need review", () => {
  const rows = rowsOf("💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 110000 active 25-04-26/-\nV70FE 8/256 silver @ 119500 non");
  assert.deepEqual(rows.map((row) => row.notes), [["active 25-04-26"], ["non"]]);
  assert.ok(rows.every((row) => row.needsReview));
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
});

test("a colour-specific review reason stays on that colour's variant only", async () => {
  const rows = rowsOf("🔵 ✨ Samsung ✨\nA37 8/256 lavender/charcoal/grey green @ 𝟏𝟑𝟒𝟖𝟎𝟎/-");
  const byColor = Object.fromEntries(rows.map((row) => [row.color, row]));
  const multiWord = 'Multi-word colour value "Grey Green" — verify';
  assert.deepEqual(Object.keys(byColor), ["Lavender", "Charcoal", "Grey Green"]);
  for (const color of ["Lavender", "Charcoal"]) {
    assert.deepEqual(byColor[color].reviewReasons, [], color);
    assert.equal(byColor[color].needsReview, false, color);
    assert.equal(byColor[color].fieldStatus.color, "explicit", color);
  }
  assert.deepEqual(byColor["Grey Green"].reviewReasons, [multiWord]);
  assert.equal(byColor["Grey Green"].fieldStatus.color, "needs_review");
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
