import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  altTextFromFileName,
  batchSummary,
  planMediaBatch,
  runMediaBatch,
  sha256Hex,
} from "../src/lib/productMediaBatch.ts";

const png = (bytes, name) => new File([new Uint8Array(bytes)], name, { type: "image/png" });

async function plan(files, existingAlt = [], uploaded = new Set()) {
  const hashed = await Promise.all(files.map(async (file) => ({ file, hash: await sha256Hex(file) })));
  return planMediaBatch(hashed, existingAlt, uploaded);
}

test("alt text matches the single-upload derivation", () => {
  assert.equal(altTextFromFileName("AC035_Redmi-Buds-8-Lite_Black_2.png"), "AC035 Redmi Buds 8 Lite Black 2");
});

test("sha256 is content based, not name based", async () => {
  assert.equal(await sha256Hex(png([1, 2, 3], "a.png")), await sha256Hex(png([1, 2, 3], "b.png")));
  assert.notEqual(await sha256Hex(png([1, 2, 3], "a.png")), await sha256Hex(png([1, 2, 4], "a.png")));
});

test("plan skips same content twice, session re-uploads and existing file names", async () => {
  const a = png([1], "front.png");
  const aCopy = png([1], "front-copy.png");
  const b = png([2], "side.png");
  const c = png([3], "Existing_Name.png");
  const d = png([4], "back.png");
  const uploaded = new Set([await sha256Hex(b)]);
  const items = await plan([a, aCopy, b, c, d], ["existing name"], uploaded);
  assert.deepEqual(items.map((item) => item.status), ["queued", "skipped", "skipped", "skipped", "queued"]);
  assert.match(items[1].message, /selected twice/);
  assert.match(items[2].message, /already uploaded/);
  assert.match(items[3].message, /file name already exists/);
  assert.equal(new Set(items.map((item) => item.key)).size, 5);
});

test("runner uploads sequentially, keeps successes on failure, then retries only failed", async () => {
  const items = await plan([png([1], "1.png"), png([2], "2.png"), png([3], "3.png")]);
  const state = new Map(items.map((item) => [item.key, { ...item }]));
  const onChange = (key, patch) => Object.assign(state.get(key), patch);
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const first = await runMediaBatch(items, async (item, onProgress) => {
    active += 1; maxActive = Math.max(maxActive, active);
    calls.push(item.name);
    onProgress(50);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (item.name === "2.png") return "Cloudinary rejected the upload.";
    return null;
  }, onChange);
  assert.deepEqual(first, { done: 2, failed: 1 });
  assert.equal(maxActive, 1, "uploads must not run in parallel");
  assert.deepEqual(calls, ["1.png", "2.png", "3.png"]);
  const after = [...state.values()];
  assert.deepEqual(after.map((item) => item.status), ["done", "failed", "done"]);
  assert.equal(after[1].message, "Cloudinary rejected the upload.");
  assert.deepEqual(batchSummary(after), { total: 3, done: 2, failed: 1, skipped: 0, pending: 0 });

  calls.length = 0;
  const retry = await runMediaBatch(after, async () => { calls.push("x"); return null; }, onChange);
  assert.deepEqual(retry, { done: 1, failed: 0 });
  assert.equal(calls.length, 1, "done items are never uploaded again");
  assert.deepEqual([...state.values()].map((item) => item.status), ["done", "done", "done"]);
});

test("a thrown upload error becomes a per-item failure and the batch continues", async () => {
  const items = await plan([png([1], "1.png"), png([2], "2.png")]);
  const seen = [];
  const result = await runMediaBatch(items, async (item) => {
    seen.push(item.name);
    if (item.name === "1.png") throw new Error("Upload authorization failed.");
    return null;
  }, () => {});
  assert.deepEqual(result, { done: 1, failed: 1 });
  assert.deepEqual(seen, ["1.png", "2.png"]);
});

test("skipped items are never uploaded", async () => {
  const items = await plan([png([1], "1.png"), png([1], "dup.png")]);
  let n = 0;
  await runMediaBatch(items, async () => { n += 1; return null; }, () => {});
  assert.equal(n, 1);
});

test("MediaManager wiring: add-only multi input, single Replace input, unchanged primary rule", async () => {
  const source = await readFile(new URL("../src/admin/MediaManager.tsx", import.meta.url), "utf8");
  // Upload button opens the multiple input; Replace still opens the single input.
  assert.match(source, /onClick=\{\(\) => multiInput\.current\?\.click\(\)\}/);
  assert.match(source, /setReplacementId\(item\.id\);\s*input\.current\?\.click\(\);/);
  const inputs = source.match(/<input\s+ref=\{(input|multiInput)\}[\s\S]*?\/>/g) ?? [];
  assert.equal(inputs.length, 2);
  assert.ok(!/multiple/.test(inputs.find((tag) => tag.includes("ref={input}"))));
  assert.ok(/multiple/.test(inputs.find((tag) => tag.includes("ref={multiInput}"))));
  // Multi path never replaces: it clears a pending Replace and calls the single upload with no replacement.
  assert.match(source, /setReplacementId\(null\);/);
  assert.match(source, /void upload\(files\[0\], true\)/);
  assert.match(source, /const replacementId = addOnly \? null : pendingReplacementId;/);
  // Same primary / sort rule as the single upload; batch inserts never pass a variant (colour) id.
  assert.match(source, /sort_order: media\.length,\s*is_primary: media\.length === 0,/);
  assert.match(source, /sort_order: count,\s*is_primary: count === 0,/);
  assert.equal((source.match(/variant_id: null,/g) ?? []).length, 2);
  // Same signed Cloudinary upload + binary guard; no service-role or secret in the browser.
  assert.equal((source.match(/requestProductUploadSignature\(/g) ?? []).length, 2);
  assert.equal((source.match(/containsBinaryMediaData\(metadata\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /service_role|api_secret/i);
});
