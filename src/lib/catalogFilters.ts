export const nullIfEmpty = <T>(value: T[] | undefined) =>
  value && value.length ? value : null;

/** The RPC caps one page at 100 rows. */
export const CATALOG_PAGE_SIZE = 100;
export const CATALOG_MAX_PAGES = 50;

/** Walks every page (stable order: published_at desc, id) until a short page; de-duplicates by product id. */
export async function collectAllCatalogPages<T extends { id: string }>(
  fetchPage: (offset: number, pageSize: number) => Promise<T[]>,
  pageSize = CATALOG_PAGE_SIZE,
) {
  const byId = new Map<string, T>();
  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const rows = await fetchPage(page * pageSize, pageSize);
    for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
    if (rows.length < pageSize) break;
  }
  return [...byId.values()];
}
