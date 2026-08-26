# Phase 4 bulk catalog import

Admin route: `/admin/bulk-import`

The workflow accepts pasted rough-text product blocks or a UTF-8 CSV file. Parse and preview are read-only. Apply is disabled while any row is ambiguous, invalid, or unresolved in a field required by the approved schema. Applying calls the authenticated `apply_catalog_bulk_import(jsonb)` PostgreSQL RPC; the function re-matches identities server-side and runs as one database transaction.

## Rough text

Separate products with a blank line. Start each block with `Brand + Product Title`. Add `Category: ...` for new products. A variant line ends in a PKR major-unit price. Slash-separated colors on one source line expand only those explicit colors.

```text
Apple 17 Pro Max
Category: Smartphones
256 GB Blue/Orange/Silver 472000
Brand New
Karachi only
```

Supported explicit shared lines are `PTA Approved`, `Official Approved`, `Brand New`, `Karachi only`, `Nationwide`, `Category:`, `Slug:`, and `Warranty:`. Unrecognized or ambiguous lines are shown as Needs Owner Review.

## CSV

Supported columns are:

```text
product_title,brand,category,slug,sku,ram,storage,color,price_pkr,compare_at_price_pkr,pta_status,condition,warranty,delivery_scope,inventory,short_description,seo_title,seo_description
```

Only `product_title` and `brand` are structurally required per row, but new products require a category and new variants require an exact price before Apply becomes available. Omitted fields remain unresolved; omitted inventory preserves an existing quantity and creates no movement. Prices are entered in PKR major units and converted with integer-only minor-unit handling.

New products are always real Draft records and require the existing Product → Media workflow plus publication validation before publication. Bulk import never uploads media, deletes absent rows, or bypasses Phase 3B or publication guards.
