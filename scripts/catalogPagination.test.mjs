import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectAllCatalogPages, CATALOG_PAGE_SIZE } from "../src/lib/catalogFilters.ts";

// Fake of search_public_catalog: published only, optional category, ordered published_at desc / id, capped at 100 per page.
function backend(total, { drafts = 0 } = {}) {
  const rows = [];
  for (let i = 0; i < total + drafts; i += 1) {
    rows.push({
      id: `id-${String(i).padStart(4, "0")}`,
      slug: `p-${i}`,
      title: `Product ${i}`,
      published: i < total,
      category: { slug: i % 3 === 0 ? "iphone-new" : "mobile-phones" },
      published_at: new Date(Date.UTC(2026, 9, 11, 10, 0, 0) - i * 1000).toISOString(),
    });
  }
  const calls = [];
  const fetchPage = (category) => async (offset, pageSize) => {
    calls.push({ offset, pageSize });
    return rows
      .filter((r) => r.published && (!category || r.category.slug === category))
      .slice(offset, offset + Math.min(pageSize, 100));
  };
  return { rows, calls, fetchPage };
}

for (const total of [0, 1, 47, 48, 49, 82, 99, 100, 101, 200, 201, 250]) {
  test(`returns all ${total} published products across pagination boundaries with no duplicates or loss`, async () => {
    const b = backend(total, { drafts: 5 });
    const result = await collectAllCatalogPages(b.fetchPage());
    assert.equal(result.length, total);
    assert.equal(new Set(result.map((r) => r.id)).size, total);
    assert.ok(result.every((r) => r.published), "unpublished products stay excluded");
    if (total > 0) {
      assert.equal(result[0].id, "id-0000");
      assert.equal(result.at(-1).id, `id-${String(total - 1).padStart(4, "0")}`);
    }
  });
}

test("more than 48 products are retrievable (previous default ceiling)", async () => {
  const b = backend(82);
  assert.equal((await collectAllCatalogPages(b.fetchPage())).length, 82);
  assert.deepEqual(b.calls.map((c) => c.offset), [0]);
  assert.equal(b.calls[0].pageSize, CATALOG_PAGE_SIZE);
});

test("walks pages of 100 by offset until a short page", async () => {
  const b = backend(250);
  await collectAllCatalogPages(b.fetchPage());
  assert.deepEqual(b.calls.map((c) => c.offset), [0, 100, 200]);
});

test("category filter still applies to every page", async () => {
  const b = backend(250);
  const result = await collectAllCatalogPages(b.fetchPage("iphone-new"));
  const expected = b.rows.filter((r) => r.published && r.category.slug === "iphone-new").length;
  assert.equal(result.length, expected);
  assert.ok(result.every((r) => r.category.slug === "iphone-new"));
});

test("a repeated row across pages is de-duplicated", async () => {
  const dup = { id: "a", slug: "a", title: "A" };
  const pages = [Array.from({ length: 100 }, (_, i) => ({ id: i === 0 ? "a" : `x${i}`, slug: "s", title: "t" })), [dup, { id: "z", slug: "z", title: "Z" }]];
  let n = 0;
  const result = await collectAllCatalogPages(async () => pages[n++] ?? []);
  assert.equal(result.length, 101);
});

test("storefront no longer relies on the 48 default or a fixed 100 cap", () => {
  const app = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /fetchPublicCatalog\(\{ limit: 100 \}\)/);
  assert.doesNotMatch(app, /fetchPublicCatalog\(filters\)/);
  assert.doesNotMatch(app, /fetchPublicCatalog\(collection\.filters\)/);
  assert.ok((app.match(/fetchAllPublicCatalog\(/g) ?? []).length >= 4);
});
