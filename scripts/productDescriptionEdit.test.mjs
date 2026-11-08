import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productDescriptionPatch } from "../src/lib/productDescriptionEdit.ts";

const base = { short_description: "Short", content: "Line one\n\nLine two" };

test("Save description: only changed description fields are sent", () => {
  assert.equal(productDescriptionPatch(base, { ...base }), null, "nothing changed");
  assert.deepEqual(productDescriptionPatch(base, { ...base, content: "New text" }), { content: "New text" });
  assert.deepEqual(productDescriptionPatch(base, { ...base, short_description: "Other" }), { short_description: "Other" });
  assert.deepEqual(productDescriptionPatch(base, { short_description: "A", content: "B" }), { short_description: "A", content: "B" });
});

test("Save description: blank text is stored as NULL; blank vs NULL is not a change", () => {
  assert.deepEqual(productDescriptionPatch(base, { ...base, content: "   \n " }), { content: null });
  assert.equal(productDescriptionPatch({ short_description: "", content: "" }, { short_description: "  ", content: "\n" }), null);
  assert.deepEqual(productDescriptionPatch({ short_description: "", content: "" }, { short_description: "", content: "Hello" }), { content: "Hello" });
});

test("Save description: the patch never contains publication_status or any other column", () => {
  const patch = productDescriptionPatch(base, { short_description: "x", content: "y" });
  assert.deepEqual(Object.keys(patch).sort(), ["content", "short_description"]);
});

test("Admin editor: Save description updates only the patch and keeps publication status", () => {
  const src = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const fn = src.match(/const saveDescription = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(fn, "saveDescription exists");
  assert.match(fn, /\.from\("products"\)\s*\.update\(patch\)\s*\.eq\("id", productId\)/);
  assert.equal(fn.includes("publication_status: \"draft\""), false, "never resets to draft");
  assert.equal(/product_variants|product_media|inventory|price/.test(fn), false, "touches no variants, media, stock or prices");
  assert.match(src, /onClick=\{saveDescription\}/);
  // Save draft keeps its existing behaviour.
  assert.match(src, /publication_status: "draft" as const,/);
});
