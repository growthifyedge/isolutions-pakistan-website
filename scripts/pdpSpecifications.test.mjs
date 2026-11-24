// PDP specifications compact view (Owner-approved 2026-11-24, localhost): the Top 7 key specifications, Show more / less.
// Data = the real S26 Ultra specification file (scripts/fixtures); nothing is hard-coded in the component.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { KEY_SPECIFICATION_LIMIT, conciseSpecValue, groupSpecifications, keySpecifications } from "../src/lib/specificationGroups.ts";
import { rowsFromXlsx } from "../src/lib/specificationBulkUpload.ts";

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const s26 = async () => (await rowsFromXlsx(readFileSync(new URL("./fixtures/samsung-s26-ultra-gpt-specifications.xlsx", import.meta.url)))).rows.map((row) => ({ group: row.section, label: row.label, value: row.value }));

test("S26 Ultra: compact view = exactly the Top 7 (Display Size … Fast Charging); stored values untouched; full list intact", async () => {
  const rows = await s26();
  assert.equal(rows.length, 53);
  const groups = groupSpecifications(rows);
  const key = keySpecifications(groups);
  assert.equal(KEY_SPECIFICATION_LIMIT, 7);
  assert.deepEqual(key.items.map((item) => [item.label, item.row.label]), [
    ["Display Size", "Screen Size"], ["Display Type", "Display Type"], ["Processor", "Chipset"], ["Rear Camera", "Rear Cameras"],
    ["Front Camera", "Front Camera"], ["Battery Capacity", "Battery Capacity (Typical)"], ["Fast Charging", "Wired Charging"],
  ]);
  // Each shown value comes from its stored row; only the multi-lens camera line is shortened for display.
  for (const item of key.items) assert.ok(rows.includes(item.row));
  assert.equal(key.items.find((item) => item.key === "rear-camera").value, "200 MP + 50 MP + 50 MP + 10 MP");
  assert.equal(key.items.find((item) => item.key === "rear-camera").row.value, "200 MP wide + 50 MP ultrawide + 50 MP telephoto + 10 MP telephoto");
  assert.equal(key.hiddenRows, 53 - 7);
  // Show more = every group and every row, nothing dropped or rewritten.
  assert.deepEqual(groups.flatMap((group) => group.rows).sort((a, b) => a.label.localeCompare(b.label)), [...rows].sort((a, b) => a.label.localeCompare(b.label)));
});

test("missing specs are skipped (never replaced); repeated values are not shown twice; otherwise everything is shown", () => {
  const row = (group, label, value = `${label}-value`) => ({ group, label, value });
  // Live S26: "Battery Capacity" and "Battery Capacity (Typical)" are both 5000 mAh → one; wireless charging is not "fast charging".
  const live = keySpecifications(groupSpecifications([
    row("Battery", "Battery Capacity", "5000 mAh"), row("Battery", "Wireless Charging", "Supported"), row("Battery", "Battery Capacity (Typical)", "5000 mAh"),
    row("Battery", "Wired Charging", "Up to 60 W"), row("Build", "Weight", "214 g"),
  ]));
  assert.deepEqual(live.items.map((item) => [item.label, item.value]), [["Battery Capacity", "5000 mAh"], ["Fast Charging", "Up to 60 W"]]);
  // No Chipset / Processor row: no Processor item (CPU core count is not used as a replacement); no front camera: skipped.
  const partial = keySpecifications(groupSpecifications([row("Performance", "CPU", "Octa-core"), row("Camera", "Main Camera", "50 MP"), row("Camera", "Main Camera Aperture", "f/1.8"), row("Display", "Refresh Rate", "120Hz")]));
  assert.deepEqual(partial.items.map((item) => item.label), ["Rear Camera"]);
  assert.equal(partial.hiddenRows, 3);
  // A value already shown is not repeated under another label.
  const repeated = keySpecifications(groupSpecifications([row("Camera", "Rear Camera", "12 MP"), row("Camera", "Front Camera", "12 MP"), row("Build", "Weight")]));
  assert.deepEqual(repeated.items.map((item) => item.label), ["Rear Camera"]);
  assert.equal(keySpecifications(groupSpecifications([row("Build", "Weight"), row("Audio", "Speakers")])), null, "none of the 7");
  assert.equal(keySpecifications(groupSpecifications([row("Display", "Screen Size"), row("Battery", "Battery Capacity")])), null, "nothing hidden");
  assert.equal(conciseSpecValue("front-camera", "12 MP,  f/2.2"), "12 MP, f/2.2", "a single camera stays as stored");
  assert.equal(conciseSpecValue("processor", "Snapdragon 8 Elite Gen 5 for Galaxy"), "Snapdragon 8 Elite Gen 5 for Galaxy");
});

test("component: data from props only (no hard-coded specs, no data access), accessible toggle, phones only", () => {
  const component = src("src/PdpSpecifications.tsx");
  assert.doesNotMatch(component, /supabase|fetch\(|\.rpc\(|\.from\(/, "no data access: specifications come from the product");
  assert.doesNotMatch(component, /mAh|inches|MP\b|Hz|Snapdragon|AMOLED/, "no hard-coded specification values");
  assert.match(component, /aria-expanded=\{expanded\} aria-controls=\{regionId\}/);
  assert.match(component, /Show all specifications <span className="pdp-spec-count">\+\{key\.hiddenRows\}<\/span>/);
  assert.match(component, /Show less <ChevronUp/);
  const app = src("src/StorefrontApp.tsx");
  assert.match(app, /<PdpSpecifications specifications=\{product\.specifications\} compact=\{isPhonePdp\} \/>/);
  assert.match(app, /const isPhonePdp = product\.category\?\.slug === "mobile-phones";/);
});

test("styles: every new rule is scoped to the phone PDP (other categories keep their look)", () => {
  const css = src("src/styles.css");
  const start = css.indexOf("/* Phone PDP specifications — Top 7");
  assert.ok(start > 0);
  const block = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes pdp-spec-in \{[\s\S]*?\}\s*\}/, "");
  for (const selector of block.match(/^\s*([^{}@\n][^{}\n]*)\{/gm) ?? []) {
    for (const part of selector.replace("{", "").split(",")) assert.match(part.trim(), /^\.pdp-page--phone /, `scoped: ${part.trim()}`);
  }
});

test("Top 7 shown as section cards (7 in total, not per section); N/A, commercial facts and exact repeats are never shown", async () => {
  const { displayableSpecifications, keySpecificationCards } = await import("../src/lib/specificationGroups.ts");
  const rows = await s26();
  const key = keySpecifications(groupSpecifications(displayableSpecifications(rows)));
  const cards = keySpecificationCards(key.items);
  assert.deepEqual(cards.map((card) => [card.title, card.items.map((item) => item.label)]), [
    ["Display", ["Display Size", "Display Type"]], ["Performance", ["Processor"]], ["Camera", ["Rear Camera", "Front Camera"]], ["Battery", ["Battery Capacity", "Fast Charging"]],
  ]);
  assert.equal(cards.flatMap((card) => card.items).length, 7);
  const row = (group, label, value) => ({ group, label, value });
  const shown = displayableSpecifications([
    row("Display", "Screen Size", "6.9 inches"), row("Display", "Screen  Size", "6.9  inches"), row("Display", "HDR", "N/A"), row("Display", "Notch", "-"),
    row("Other", "PTA Status", "Approved"), row("Other", "Price", "Rs 1"), row("Other", "Warranty", "1 Year"), row("Other", "Stock", "5"), row("Other", "Condition", "New"),
    row("Other", "Delivery", "Karachi"), row("Build", "Weight", "214 g"), row("Battery", "Battery Capacity", ""),
  ]);
  assert.deepEqual(shown.map((item) => item.label), ["Screen Size", "Weight"]);
  // The S26 record has none of these: all 57 stay in "Show all".
  assert.equal(displayableSpecifications(rows).length, rows.length);
});
