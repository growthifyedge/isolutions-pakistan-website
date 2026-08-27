import { ChangeEvent, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Play,
  Upload,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  BulkProduct,
  BulkVariant,
  bulkInventoryPreview,
  generatedVariantSku,
  matchingActiveRealTaxonomy,
  normalizedPriceDisplay,
  parseBulkCatalog,
} from "../lib/bulkCatalog";

type Taxonomy = {
  id: string;
  name: string;
  slug: string;
  data_class: "real" | "development";
  is_active: boolean;
};
type ExistingProduct = {
  id: string;
  title: string;
  slug: string;
  brand_id: string;
  category_id: string;
  publication_status: "draft" | "published" | "archived";
  default_pta_status: BulkVariant["ptaStatus"];
  default_delivery_scope: BulkVariant["deliveryScope"];
  product_variants: Array<{
    id: string;
    sku: string;
    ram_display: string | null;
    storage_display: string | null;
    color_finish: string | null;
    price_minor: number;
    compare_at_price_minor: number | null;
    pta_status: BulkVariant["ptaStatus"];
    condition: BulkVariant["condition"];
    warranty_override: string | null;
    delivery_scope: BulkVariant["deliveryScope"];
  }>;
};

type PreviewVariant = BulkVariant & {
  action: string;
  id: string | null;
  skuResolved: string;
  inventoryLabel: string;
};
type PreviewProduct = Omit<BulkProduct, "variants"> & {
  action: string;
  id: string | null;
  slugResolved: string;
  brandId: string | null;
  categoryId: string | null;
  variants: PreviewVariant[];
  blocked: string[];
  taxonomyNotes: string[];
  brandAction: "REUSE BRAND" | "CREATE BRAND" | "NEEDS REVIEW";
  categoryAction: "REUSE CATEGORY" | "CREATE CATEGORY" | "NEEDS REVIEW";
};

const normalized = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? "";
const slugify = (value: string) =>
  normalized(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function matchesVariant(
  existing: ExistingProduct["product_variants"][number],
  variant: BulkVariant,
) {
  return (
    normalized(existing.ram_display) === normalized(variant.ram) &&
    normalized(existing.storage_display) === normalized(variant.storage) &&
    normalized(existing.color_finish) === normalized(variant.color) &&
    (variant.ptaSource !== "explicit variant override" ||
      variant.ptaStatus === "unknown" ||
      existing.pta_status === variant.ptaStatus) &&
    (variant.condition === "unknown" ||
      existing.condition === variant.condition)
  );
}

export function BulkImport() {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<PreviewProduct[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [format, setFormat] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState("");

  const parseAndPreview = async () => {
    if (!source.trim()) {
      setMessage(
        "Paste rough catalog text or upload a CSV file before parsing.",
      );
      return;
    }
    if (!supabase) {
      setMessage(
        "Preview unavailable: Supabase environment is not configured.",
      );
      return;
    }
    setWorking(true);
    setResult(null);
    setMessage("");
    setPreview([]);
    try {
      const parsed = parseBulkCatalog(source);
      setFormat(parsed.format);
      setParseErrors(parsed.errors);
      if (!parsed.products.length) {
        throw new Error(
          parsed.errors[0] ??
            "No products could be parsed from the source data.",
        );
      }
      const [brandResult, categoryResult, productResult] = await Promise.all([
        supabase.from("brands").select("id,name,slug,data_class,is_active"),
        supabase.from("categories").select("id,name,slug,data_class,is_active"),
        supabase
          .from("products")
          .select(
            "id,title,slug,brand_id,category_id,publication_status,default_pta_status,default_delivery_scope,product_variants(id,sku,ram_display,storage_display,color_finish,price_minor,compare_at_price_minor,pta_status,condition,warranty_override,delivery_scope)",
          ),
      ]);
      const queryError =
        brandResult.error ?? categoryResult.error ?? productResult.error;
      if (queryError) throw queryError;
      const brands = (brandResult.data ?? []) as Taxonomy[];
      const categories = (categoryResult.data ?? []) as Taxonomy[];
      const products = (productResult.data ?? []) as ExistingProduct[];
      const rows = parsed.products.map((product): PreviewProduct => {
        const blocked = [...product.warnings];
        const realBrands = matchingActiveRealTaxonomy(brands, product.brand);
        const developmentBrand = brands.some(
          (item) =>
            item.data_class === "development" &&
            normalized(item.name) === normalized(product.brand),
        );
        if (realBrands.length > 1) blocked.push("Ambiguous real brand match");
        else if (realBrands.length === 0 && !product.brandExplicit)
          blocked.push(
            `Needs Owner Review: explicit Brand required for ${product.brand}`,
          );
        const brandAction =
          realBrands.length === 1
            ? "REUSE BRAND"
            : product.brandExplicit && realBrands.length === 0
              ? "CREATE BRAND"
              : "NEEDS REVIEW";
        const brandId = realBrands.length === 1 ? realBrands[0].id : null;
        const realCategories = product.category
          ? matchingActiveRealTaxonomy(categories, product.category)
          : [];
        const developmentCategory = product.category
          ? categories.some(
              (item) =>
                item.data_class === "development" &&
                normalized(item.name) === normalized(product.category),
            )
          : false;
        if (realCategories.length > 1)
          blocked.push("Ambiguous real category match");
        if (
          product.category &&
          realCategories.length === 0 &&
          !product.categoryExplicit
        )
          blocked.push("Needs Owner Review: explicit Category required");
        const categoryAction =
          realCategories.length === 1
            ? "REUSE CATEGORY"
            : product.categoryExplicit && realCategories.length === 0
              ? "CREATE CATEGORY"
              : "NEEDS REVIEW";
        const categoryId =
          realCategories.length === 1 ? realCategories[0].id : null;
        const requestedSlug = product.slug ?? slugify(product.title);
        const candidates = product.slug
          ? products.filter((item) => item.slug === product.slug)
          : brandId
            ? products.filter(
                (item) =>
                  normalized(item.title) === normalized(product.title) &&
                  item.brand_id === brandId,
              )
            : [];
        if (candidates.length > 1) blocked.push("Ambiguous product match");
        const existing = candidates.length === 1 ? candidates[0] : null;
        if (!existing && !product.category)
          blocked.push("Category required for new product");
        const taxonomyNotes: string[] = [];
        if (developmentBrand)
          taxonomyNotes.push(
            "Development brand collision shown; a separate real brand will be created",
          );
        if (developmentCategory)
          taxonomyNotes.push(
            "Development category collision shown; a separate real category will be created",
          );
        const variants = product.variants.map((variant): PreviewVariant => {
          const matches = variant.sku
            ? (existing?.product_variants.filter(
                (item) => item.sku === variant.sku,
              ) ?? [])
            : (existing?.product_variants.filter((item) =>
                matchesVariant(item, variant),
              ) ?? []);
          const variantBlocked = [...variant.warnings];
          if (matches.length > 1)
            variantBlocked.push("Ambiguous variant match");
          const match = matches.length === 1 ? matches[0] : null;
          const inventoryIntent = bulkInventoryPreview(
            variant.inventory,
            Boolean(match),
          );
          const preserveExistingPta = Boolean(
            match &&
            variant.ptaSource === "inherited by variant" &&
            match.pta_status !== "unknown",
          );
          const effectivePtaStatus = preserveExistingPta
            ? match!.pta_status
            : variant.ptaStatus;
          const effectivePtaSource = preserveExistingPta
            ? "explicit variant override"
            : variant.ptaSource;
          const skuResolved =
            variant.sku ??
            match?.sku ??
            generatedVariantSku(existing?.slug ?? requestedSlug, variant);
          const unchanged = Boolean(
            match &&
            variant.inventory === null &&
            match.price_minor === variant.priceMinor &&
            (variant.compareAtPriceMinor === null ||
              match.compare_at_price_minor === variant.compareAtPriceMinor) &&
            (variant.ptaSource !== "explicit variant override" ||
              variant.ptaStatus === "unknown" ||
              match.pta_status === variant.ptaStatus) &&
            (variant.condition === "unknown" ||
              match.condition === variant.condition) &&
            (variant.warranty === null ||
              match.warranty_override === variant.warranty) &&
            (variant.deliveryScope === null ||
              match.delivery_scope === variant.deliveryScope),
          );
          return {
            ...variant,
            ptaStatus: effectivePtaStatus,
            ptaSource: effectivePtaSource,
            warnings: variantBlocked,
            id: match?.id ?? null,
            skuResolved,
            inventoryLabel: inventoryIntent.label,
            action: variantBlocked.length
              ? "NEEDS REVIEW"
              : unchanged
                ? "UNCHANGED"
                : match
                  ? "UPDATE VARIANT"
                  : "CREATE VARIANT",
          };
        });
        if (variants.some((variant) => variant.warnings.length))
          blocked.push("One or more variants require review");
        return {
          ...product,
          id: existing?.id ?? null,
          brandId: brandId ?? (existing ? existing.brand_id : null),
          categoryId:
            categoryId ??
            (existing && !product.category ? existing.category_id : null),
          slugResolved: existing?.slug ?? requestedSlug,
          variants,
          blocked,
          taxonomyNotes,
          brandAction,
          categoryAction,
          action: blocked.length
            ? "BLOCKED"
            : existing
              ? "UPDATE PRODUCT"
              : "CREATE PRODUCT",
        };
      });
      setPreview(rows);
      setMessage(
        `Preview ready: ${rows.length} product${rows.length === 1 ? "" : "s"} parsed. No database writes performed.`,
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "Unknown parsing or preview error.";
      setMessage(`Parse and preview failed: ${detail}`);
    } finally {
      setWorking(false);
    }
  };

  const apply = async () => {
    if (
      !supabase ||
      preview.some((product) => product.blocked.length) ||
      parseErrors.length
    )
      return;
    setWorking(true);
    const batch = {
      products: preview.map((product) => ({
        id: product.id,
        title: product.title,
        slug: product.slugResolved,
        brand: product.brand,
        brand_id: product.brandId,
        category: product.category,
        category_id: product.categoryId,
        short_description: product.shortDescription,
        seo_title: product.seoTitle,
        seo_description: product.seoDescription,
        default_pta_status: product.defaultPtaStatus,
        default_delivery_scope: product.defaultDeliveryScope,
        content: product.notes.length ? product.notes.join("\n") : null,
        specifications: product.specifications,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          action: variant.action,
          sku: variant.skuResolved,
          ram_display: variant.ram,
          storage_display: variant.storage,
          color_finish: variant.color,
          price_minor: variant.priceMinor,
          compare_at_price_minor: variant.compareAtPriceMinor,
          pta_status: variant.ptaStatus,
          condition: variant.condition,
          warranty_override: variant.warranty,
          delivery_scope: variant.deliveryScope,
          inventory: variant.inventory,
        })),
      })),
    };
    const { data, error } = await supabase.rpc("apply_catalog_bulk_import", {
      p_batch: batch,
    });
    if (error) setMessage(error.message);
    else {
      setResult(data as Record<string, number>);
      setMessage("Approved batch applied atomically.");
    }
    setWorking(false);
  };

  const uploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setSource(await file.text());
  };

  const blocked =
    parseErrors.length > 0 ||
    preview.some((product) => product.blocked.length > 0);
  const totals = preview.reduce(
    (summary, product) => {
      summary.products += 1;
      summary.variants += product.variants.length;
      summary.changes +=
        Number(product.action !== "BLOCKED") +
        product.variants.filter((variant) => variant.action !== "UNCHANGED")
          .length;
      return summary;
    },
    { products: 0, variants: 0, changes: 0 },
  );

  return (
    <section className="bulk-import">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">PHASE 4 · OWNER-APPROVED DATA</span>
          <h1>Bulk catalog import</h1>
          <p>
            Paste rough product blocks or upload CSV. Nothing writes until this
            preview is approved.
          </p>
        </div>
      </div>
      <div className="bulk-step">
        <b>1. Source data</b>
        <span>PKR major units · missing facts remain unresolved</span>
      </div>
      <textarea
        aria-label="Bulk catalog source"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder="Apple 17 Pro Max&#10;Category: Smartphones&#10;256 GB Blue/Orange/Silver 472000&#10;Brand New&#10;Karachi only"
      />
      <div className="bulk-actions">
        <label className="admin-secondary">
          <FileUp /> Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={uploadCsv}
            hidden
          />
        </label>
        <button
          className="admin-primary"
          onClick={parseAndPreview}
          disabled={working || !source.trim()}
          type="button"
        >
          <Play /> Parse and preview
        </button>
      </div>
      {message && (
        <p
          className={result || preview.length ? "admin-success" : "admin-error"}
          role={result || preview.length ? "status" : "alert"}
          aria-live="polite"
        >
          {message}
        </p>
      )}
      {preview.length > 0 && (
        <>
          <div className="bulk-step">
            <b>2–4. Preview and review</b>
            <span>
              {format} · {totals.products} products · {totals.variants} explicit
              variants · {totals.changes} proposed changes
            </span>
          </div>
          {parseErrors.map((error) => (
            <p className="admin-error" key={error}>
              {error}
            </p>
          ))}
          <div className="bulk-preview">
            {preview.map((product) => (
              <article
                key={`${product.brand}-${product.title}`}
                className="bulk-product"
              >
                <header>
                  <div>
                    <strong>{product.title}</strong>
                    <small>
                      {product.brand} ·{" "}
                      {product.category ?? "Category unresolved"} ·{" "}
                      {product.slugResolved}
                    </small>
                  </div>
                  <span
                    className={`bulk-status ${product.blocked.length ? "blocked" : "ready"}`}
                  >
                    {product.action}
                  </span>
                </header>
                <p className="bulk-meta">
                  {product.brandAction} · {product.categoryAction}
                </p>
                <p className="bulk-meta">
                  Defaults: PTA {product.defaultPtaStatus ?? "unresolved"} ·
                  condition {product.defaultCondition ?? "unresolved"} ·
                  warranty {product.defaultWarranty ?? "unresolved"} · delivery{" "}
                  {product.defaultDeliveryScope ?? "unresolved"}
                </p>
                {product.notes.map((note) => (
                  <p className="bulk-meta" key={`note-${note}`}>
                    Owner note: {note}
                  </p>
                ))}
                {product.specifications.map((specification) => (
                  <p
                    className="bulk-meta"
                    key={`${specification.label}-${specification.value}`}
                  >
                    Specification: {specification.label} — {specification.value}
                  </p>
                ))}
                {product.diagnostics
                  .filter((item) => !item.blocksApply)
                  .map((item) => (
                    <p
                      className="bulk-meta"
                      key={`${item.line}-${item.reason}`}
                    >
                      {item.classification}: {item.line} — {item.reason}
                    </p>
                  ))}
                {product.blocked.map((warning) => (
                  <p className="bulk-warning" key={warning}>
                    <AlertTriangle /> {warning}
                  </p>
                ))}
                {product.taxonomyNotes.map((note) => (
                  <p className="bulk-warning" key={note}>
                    <CheckCircle2 /> {note}
                  </p>
                ))}
                {product.variants.map((variant) => (
                  <div
                    className="bulk-variant"
                    key={`${variant.source}-${variant.color}`}
                  >
                    <div>
                      <b>
                        {variant.ram ?? "RAM unresolved"} /{" "}
                        {variant.storage ?? "Storage unresolved"} /{" "}
                        {variant.color ?? "Color unresolved"}
                      </b>
                      <small>{variant.skuResolved}</small>
                    </div>
                    <div>
                      <span>Entered: {variant.pricePkr ?? "unresolved"}</span>
                      <b>{normalizedPriceDisplay(variant)}</b>
                    </div>
                    <span>
                      {variant.ptaStatus} ({variant.ptaSource}) ·{" "}
                      {variant.condition} ({variant.conditionSource}) · warranty{" "}
                      {variant.warranty ?? "unresolved"} (
                      {variant.warrantySource}) ·{" "}
                      {variant.deliveryScope ?? "delivery unresolved"} (
                      {variant.deliverySource}) · {variant.inventoryLabel}
                    </span>
                    <span
                      className={`bulk-status ${variant.warnings.length ? "blocked" : "ready"}`}
                    >
                      {variant.action}
                    </span>
                  </div>
                ))}
              </article>
            ))}
          </div>
          <div className="bulk-step">
            <b>5. Apply approved batch</b>
            <span>
              {blocked
                ? "Resolve all blocked rows before apply"
                : "Server authorization + atomic transaction"}
            </span>
          </div>
          <button
            className="admin-primary"
            disabled={working || blocked}
            onClick={apply}
          >
            <Upload /> Apply approved batch
          </button>
        </>
      )}
      {result && (
        <div className="bulk-result">
          <CheckCircle2 />
          <div>
            <b>6. Result report</b>
            {Object.entries(result).map(([key, value]) => (
              <span key={key}>
                {key.replaceAll("_", " ")}: {value}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
