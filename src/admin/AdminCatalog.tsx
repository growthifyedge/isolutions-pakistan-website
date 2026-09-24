import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Plus,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  formatPkrMinor,
  parsePkrMajorToMinor,
  pkrMajorInputFromMinor,
} from "../lib/money";
import {
  CONDITION_GRADES,
  parseUsedPhoneFacts,
  ptaLabel,
  variantFacts,
} from "../lib/variantFacts";
import { MediaManager } from "./MediaManager";

type Option = {
  id: string;
  name: string;
  slug: string;
  data_class: "development" | "real";
  is_active: boolean;
};
type ProductRow = {
  id: string;
  title: string;
  slug: string;
  publication_status: "draft" | "published" | "archived";
  data_class: "development" | "real";
  brand: { name: string } | null;
  category: { name: string } | null;
  product_variants: { id: string }[];
  product_media: { is_primary: boolean; cloudinary_public_id: string | null }[];
};
type Draft = {
  id?: string;
  title: string;
  slug: string;
  brand_id: string;
  category_id: string;
  short_description: string;
  content: string;
  default_warranty: string;
  default_condition:
    "brand_new" | "used" | "open_box" | "refurbished" | "unknown";
  default_delivery_scope: "" | "karachi_only" | "nationwide";
  default_pta_status:
    "approved" | "not_approved" | "not_applicable" | "unknown";
  seo_title: string;
  seo_description: string;
  publication_status: "draft" | "published" | "archived";
  data_class: "development" | "real";
  is_flash_sale: boolean;
  is_featured: boolean;
  is_best_seller: boolean;
};
type Variant = {
  id: string;
  sku: string;
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  pta_status: string;
  condition: string;
  warranty_override: string | null;
  carrier_jv: string | null;
  delivery_scope: string | null;
  is_active: boolean;
  // Used-phone facts (202609240005); NULL when not supplied.
  condition_grade?: string | null;
  battery_health_percent?: number | null;
  battery_cycle_count?: number | null;
  quantity?: number;
};
/** Variant being edited; Battery Health / Cycle Count are edited as text and validated on save. */
type VariantEdit = Variant & { batteryHealthInput: string; cycleCountInput: string };
const editableVariant = (variant: Variant): VariantEdit => ({
  ...variant,
  batteryHealthInput: variant.battery_health_percent?.toString() ?? "",
  cycleCountInput: variant.battery_cycle_count?.toString() ?? "",
});
const variantIdentity = (variant: Variant) =>
  [variant.storage_display, variant.ram_display, variant.color_finish]
    .filter(Boolean)
    .join(" / ") || variant.sku;
type Specification = {
  id: string;
  specification_group: string | null;
  label: string;
  value: string;
  sort_order: number;
};
type RecommendationProduct = {
  id: string;
  title: string;
  slug: string;
  publication_status: "draft" | "published" | "archived";
  data_class: "development" | "real";
  brand: { name: string } | null;
  product_variants: { price_minor: number }[];
};
const emptyDraft: Draft = {
  title: "",
  slug: "",
  brand_id: "",
  category_id: "",
  short_description: "",
  content: "",
  default_warranty: "",
  default_condition: "unknown",
  default_delivery_scope: "",
  default_pta_status: "unknown",
  seo_title: "",
  seo_description: "",
  publication_status: "draft",
  data_class: "development",
  is_flash_sale: false,
  is_featured: false,
  is_best_seller: false,
};
export function Phase4ProductList() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    supabase
      .from("products")
      .select(
        "id,title,slug,publication_status,data_class,brand:brands(name),category:categories(name),product_variants(id),product_media(is_primary,cloudinary_public_id)",
      )
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setProducts((data ?? []) as unknown as ProductRow[]);
      });
  }, []);
  // /admin/products?missing=images (linked after a Bulk Upload v2 import) lists products
  // that still need their primary image before they can be published.
  const missingImagesOnly =
    new URLSearchParams(location.search).get("missing") === "images";
  const shown = products.filter(
    (p) =>
      `${p.title} ${p.slug} ${p.brand?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!missingImagesOnly ||
        !p.product_media.some((media) => media.is_primary && media.cloudinary_public_id)),
  );
  return (
    <>
      <div className="admin-heading compact">
        <div>
          <a className="back-link" href="/admin">
            Studio / Catalog
          </a>
          <h1>Products</h1>
          <p>
            Real and development records are explicitly isolated. Only validated
            published real products can reach the storefront.
          </p>
        </div>
        <a href="/admin/products/new" className="admin-primary">
          <Plus /> New product
        </a>
      </div>
      <div className="catalog-tools">
        <div>
          <Search />
          <input
            aria-label="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, slug or brand"
          />
        </div>
        <a className="admin-secondary" href="/admin/taxonomy">
          Brands & categories
        </a>
        {missingImagesOnly && (
          <a className="admin-secondary" href="/admin/products">
            Missing images only · Show all
          </a>
        )}
      </div>
      {error && (
        <div className="validation-callout">
          <ShieldCheck />
          <div>
            <strong>Catalog unavailable</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      <section className="product-table">
        <div className="table-head">
          <span>Product</span>
          <span>Status</span>
          <span>Variants</span>
          <span>Class</span>
          <span />
        </div>
        {shown.map((p) => (
          <a href={`/admin/products/${p.id}`} className="table-row" key={p.id}>
            <div className="admin-product-thumb">
              <ShieldCheck />
            </div>
            <div className="table-product">
              <strong>{p.title}</strong>
              <span>
                {p.brand?.name ?? "Unassigned"} ·{" "}
                {p.category?.name ?? "Unassigned"}
              </span>
            </div>
            <em className={`state ${p.publication_status}`}>
              {p.publication_status}
            </em>
            <span>{p.product_variants.length} explicit</span>
            <span>{p.data_class}</span>
            <ChevronRight />
          </a>
        ))}
      </section>
      <div className="table-foot">
        {shown.length} records · Development records remain public-invisible
      </div>
    </>
  );
}

export function TaxonomyManager() {
  const [brands, setBrands] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [kind, setKind] = useState<"brands" | "categories">("brands");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!supabase) return;
    const [b, c] = await Promise.all([
      supabase
        .from("brands")
        .select("id,name,slug,data_class,is_active")
        .order("name"),
      supabase
        .from("categories")
        .select("id,name,slug,data_class,is_active")
        .order("sort_order")
        .order("name"),
    ]);
    setBrands((b.data ?? []) as Option[]);
    setCategories((c.data ?? []) as Option[]);
  };
  useEffect(() => {
    load();
  }, []);
  const create = async () => {
    if (!supabase || !name.trim() || !slug.trim()) return;
    const { error } = await supabase.from(kind).insert({
      name: name.trim(),
      slug: slug.trim(),
      data_class: "development",
    });
    setMessage(
      error?.message ?? "Created as development/unpublished taxonomy.",
    );
    if (!error) {
      setName("");
      setSlug("");
      await load();
    }
  };
  const setClassification = async (item: Option) => {
    if (!supabase) return;
    const next = item.data_class === "real" ? "development" : "real";
    const { error } = await supabase
      .from(kind)
      .update({ data_class: next })
      .eq("id", item.id);
    setMessage(error?.message ?? `Classification changed to ${next}.`);
    if (!error) await load();
  };
  return (
    <>
      <div className="admin-heading compact">
        <div>
          <a className="back-link" href="/admin/products">
            <ArrowLeft /> Products
          </a>
          <h1>Brands & categories</h1>
          <p>
            New records default to development. Mark real only after Owner
            approval.
          </p>
        </div>
      </div>
      <div className="editor-card">
        <div className="form-grid">
          <label>
            Record type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="brands">Brand</option>
              <option value="categories">Category</option>
            </select>
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Slug
            <input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </label>
          <button className="admin-primary" onClick={create}>
            <Plus /> Create development record
          </button>
        </div>
        {message && <p>{message}</p>}
        <div className="variant-list">
          {(kind === "brands" ? brands : categories).map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.slug}</span>
              </div>
              <code>{item.data_class}</code>
              <span>{item.is_active ? "active" : "inactive"}</span>
              <button
                className="admin-secondary"
                onClick={() => setClassification(item)}
              >
                Mark{" "}
                {item.data_class === "real"
                  ? "development"
                  : "Owner-approved real"}
              </button>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

const tabs = [
  "Overview",
  "Variants & Pricing",
  "Inventory",
  "Specifications",
  "Media",
  "Frequently Bought Together",
  "SEO & Publishing",
];
export function Phase4ProductEditor() {
  const routeId = location.pathname.split("/").at(-1) ?? "";
  const isNew = routeId === "new";
  const productId = isNew ? null : routeId;
  const initial =
    new URLSearchParams(location.search).get("tab") === "media"
      ? "Media"
      : "Overview";
  const [tab, setTab] = useState(initial);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [brands, setBrands] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantPrices, setVariantPrices] = useState<Record<string, string>>(
    {},
  );
  const [variantCompareAtPrices, setVariantCompareAtPrices] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [recommendationOptions, setRecommendationOptions] = useState<RecommendationProduct[]>([]);
  const [recommendationIds, setRecommendationIds] = useState<string[]>([]);
  const [recommendationQuery, setRecommendationQuery] = useState("");
  const [message, setMessage] = useState("");
  const [newVariant, setNewVariant] = useState({
    ram_display: "",
    storage_display: "",
    color_finish: "",
    price: "",
    compare_at_price: "",
    pta_status: "unknown",
    condition: "unknown",
    condition_grade: "",
    battery_health_percent: "",
    battery_cycle_count: "",
    delivery_scope: "",
  });
  const [stock, setStock] = useState<Record<string, string>>({});
  const [newSpec, setNewSpec] = useState({
    specification_group: "",
    label: "",
    value: "",
  });
  const [variantPendingDelete, setVariantPendingDelete] = useState<Variant | null>(null);
  const [variantDeleting, setVariantDeleting] = useState(false);
  const [variantEditing, setVariantEditing] = useState<VariantEdit | null>(null);
  const [variantSaving, setVariantSaving] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [b, c, catalog] = await Promise.all([
      supabase
        .from("brands")
        .select("id,name,slug,data_class,is_active")
        .order("name"),
      supabase
        .from("categories")
        .select("id,name,slug,data_class,is_active")
        .order("name"),
      supabase
        .from("products")
        .select("id,title,slug,publication_status,data_class,brand:brands(name),product_variants(price_minor)")
        .order("title"),
    ]);
    setBrands((b.data ?? []) as Option[]);
    setCategories((c.data ?? []) as Option[]);
    setRecommendationOptions((catalog.data ?? []) as unknown as RecommendationProduct[]);
    if (!productId) return;
    const [p, v, s, i, r] = await Promise.all([
      supabase.from("products").select("*").eq("id", productId).single(),
      supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order"),
      supabase
        .from("product_specifications")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order"),
      supabase
        .from("admin_variant_inventory")
        .select("variant_id,quantity_on_hand")
        .eq("product_id", productId),
      supabase
        .from("product_recommendations")
        .select("recommended_product_id,sort_order")
        .eq("source_product_id", productId)
        .eq("relation_type", "frequently_bought_together")
        .eq("is_active", true)
        .order("sort_order"),
    ]);
    if (p.error) {
      setMessage(p.error.message);
      return;
    }
    setDraft({
      ...emptyDraft,
      ...p.data,
      is_flash_sale: p.data.is_flash_sale === true,
      is_featured: p.data.is_featured === true,
      is_best_seller: p.data.is_best_seller === true,
      brand_id: p.data.brand_id ?? "",
      short_description: p.data.short_description ?? "",
      content: p.data.content ?? "",
      default_warranty: p.data.default_warranty ?? "",
      default_condition: p.data.default_condition ?? "unknown",
      default_delivery_scope: p.data.default_delivery_scope ?? "",
      default_pta_status: p.data.default_pta_status ?? "unknown",
      seo_title: p.data.seo_title ?? "",
      seo_description: p.data.seo_description ?? "",
    });
    const quantities = new Map(
      (i.data ?? []).map((x) => [x.variant_id, Number(x.quantity_on_hand)]),
    );
    setVariants(
      ((v.data ?? []) as Variant[]).map((x) => ({
        ...x,
        quantity: quantities.get(x.id) ?? 0,
      })),
    );
    setVariantPrices(
      Object.fromEntries(
        ((v.data ?? []) as Variant[]).map((variant) => [
          variant.id,
          pkrMajorInputFromMinor(variant.price_minor),
        ]),
      ),
    );
    setVariantCompareAtPrices(
      Object.fromEntries(
        ((v.data ?? []) as Variant[]).map((variant) => [
          variant.id,
          variant.compare_at_price_minor === null
            ? ""
            : pkrMajorInputFromMinor(variant.compare_at_price_minor),
        ]),
      ),
    );
    setSpecs((s.data ?? []) as Specification[]);
    if (r.error) setMessage(r.error.message);
    else setRecommendationIds((r.data ?? []).map((row) => row.recommended_product_id));
  }, [productId]);
  useEffect(() => {
    load();
  }, [load]);
  const persistChangedVariantPricing = async () => {
    if (!supabase) return "Supabase is not configured.";

    for (const variant of variants) {
      let priceMinor: number;
      let compareAtPriceMinor: number | null;
      try {
        priceMinor = parsePkrMajorToMinor(
          variantPrices[variant.id] ??
            pkrMajorInputFromMinor(variant.price_minor),
        );
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "Enter a valid PKR price.";
      }

      const compareAtInput = variantCompareAtPrices[variant.id] ??
        (variant.compare_at_price_minor === null
          ? ""
          : pkrMajorInputFromMinor(variant.compare_at_price_minor));
      try {
        compareAtPriceMinor = compareAtInput.trim()
          ? parsePkrMajorToMinor(compareAtInput)
          : null;
      } catch {
        return "Enter a valid Compare-at Price PKR value.";
      }
      if (
        compareAtPriceMinor !== null &&
        compareAtPriceMinor <= priceMinor
      ) {
        return "Compare-at Price PKR must be greater than Price PKR.";
      }

      if (
        priceMinor === variant.price_minor &&
        compareAtPriceMinor === variant.compare_at_price_minor
      ) continue;
      const { error } = await supabase
        .from("product_variants")
        .update({
          price_minor: priceMinor,
          compare_at_price_minor: compareAtPriceMinor,
        })
        .eq("id", variant.id);
      if (error) return error.message;
    }
    return null;
  };
  const persistRecommendations = async () => {
    if (!supabase || !productId) return null;
    const { error: deleteError } = await supabase
      .from("product_recommendations")
      .delete()
      .eq("source_product_id", productId)
      .eq("relation_type", "frequently_bought_together");
    if (deleteError) return deleteError.message;
    if (recommendationIds.length === 0) return null;
    const { error: insertError } = await supabase
      .from("product_recommendations")
      .insert(recommendationIds.map((recommendedProductId, sortOrder) => ({
        source_product_id: productId,
        recommended_product_id: recommendedProductId,
        relation_type: "frequently_bought_together",
        sort_order: sortOrder,
        is_active: true,
      })));
    return insertError?.message ?? null;
  };
  const save = async () => {
    if (!supabase) return;
    if (
      !draft.title.trim() ||
      !draft.slug.trim() ||
      !draft.category_id
    ) {
      setMessage("Title, slug, and category are required.");
      return;
    }
    const payload = {
      ...draft,
      is_flash_sale: draft.is_flash_sale,
      is_featured: draft.is_featured,
      is_best_seller: draft.is_best_seller,
      title: draft.title.trim(),
      slug: draft.slug.trim(),
      brand_id: draft.brand_id || null,
      short_description: draft.short_description || null,
      content: draft.content || null,
      default_warranty: draft.default_warranty || null,
      default_condition: draft.default_condition,
      default_delivery_scope: draft.default_delivery_scope || null,
      default_pta_status: draft.default_pta_status,
      seo_title: draft.seo_title || null,
      seo_description: draft.seo_description || null,
      publication_status: "draft" as const,
    };
    delete payload.id;
    const result = productId
      ? await supabase
          .from("products")
          .update(payload)
          .eq("id", productId)
          .select("id")
          .single()
      : await supabase.from("products").insert(payload).select("id").single();
    if (result.error) setMessage(result.error.message);
    else if (!productId) location.href = `/admin/products/${result.data.id}`;
    else {
      const variantPriceError = await persistChangedVariantPricing();
      if (variantPriceError) {
        setMessage(variantPriceError);
        return;
      }
      const recommendationError = await persistRecommendations();
      if (recommendationError) {
        setMessage(recommendationError);
        return;
      }
      setMessage("Draft saved.");
      await load();
    }
  };
  const publish = async () => {
    if (!supabase || !productId) return;
    const variantPriceError = await persistChangedVariantPricing();
    if (variantPriceError) {
      setMessage(variantPriceError);
      return;
    }
    const recommendationError = await persistRecommendations();
    if (recommendationError) {
      setMessage(recommendationError);
      return;
    }
    const validation = await supabase.rpc("validate_product_for_publication", {
      p_product_id: productId,
    });
    const row = validation.data?.[0];
    if (validation.error || !row?.is_valid) {
      setMessage(
        `Publication blocked: ${(row?.errors ?? [validation.error?.message ?? "validation_failed"]).join(", ")}`,
      );
      return;
    }
    const { error } = await supabase
      .from("products")
      .update({
        publication_status: "published",
        is_flash_sale: draft.is_flash_sale,
        is_featured: draft.is_featured,
        is_best_seller: draft.is_best_seller,
      })
      .eq("id", productId);
    setMessage(error?.message ?? "Published successfully.");
    if (!error) await load();
  };
  const addVariant = async () => {
    if (!supabase || !productId) return;
    let priceMinor: number;
    let compareAtPriceMinor: number | null;
    try {
      priceMinor = parsePkrMajorToMinor(newVariant.price);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Enter a valid PKR price.",
      );
      return;
    }
    try {
      compareAtPriceMinor = newVariant.compare_at_price.trim()
        ? parsePkrMajorToMinor(newVariant.compare_at_price)
        : null;
    } catch {
      setMessage("Enter a valid Compare-at Price PKR value.");
      return;
    }
    if (compareAtPriceMinor !== null && compareAtPriceMinor <= priceMinor) {
      setMessage("Compare-at Price PKR must be greater than Price PKR.");
      return;
    }
    const usedFacts = parseUsedPhoneFacts({
      condition: newVariant.condition,
      conditionGrade: newVariant.condition_grade,
      batteryHealth: newVariant.battery_health_percent,
      cycleCount: newVariant.battery_cycle_count,
    });
    if (!usedFacts.ok) {
      setMessage(usedFacts.message);
      return;
    }
    // No SKU is sent: the database assigns the next sequential SKU for the
    // product's category (e.g. MB001) when the variant is inserted.
    const { error } = await supabase.from("product_variants").insert({
      ...usedFacts.values,
      product_id: productId,
      ram_display: newVariant.ram_display || null,
      storage_display: newVariant.storage_display || null,
      color_finish: newVariant.color_finish || null,
      price_minor: priceMinor,
      compare_at_price_minor: compareAtPriceMinor,
      pta_status: newVariant.pta_status,
      condition: newVariant.condition,
      delivery_scope: newVariant.delivery_scope || null,
    });
    setMessage(error?.message ?? "Explicit variant added. SKU assigned automatically.");
    if (!error) {
      setNewVariant({
        ram_display: "",
        storage_display: "",
        color_finish: "",
        price: "",
        compare_at_price: "",
        pta_status: "unknown",
        condition: "unknown",
        condition_grade: "",
        battery_health_percent: "",
        battery_cycle_count: "",
        delivery_scope: "",
      });
      await load();
    }
  };
  const saveVariantPrice = async (variantId: string) => {
    if (!supabase) return;
    if (!variants.some((item) => item.id === variantId)) return;
    const error = await persistChangedVariantPricing();
    setMessage(error ?? "Variant pricing saved exactly.");
    if (!error) await load();
  };
  const saveVariantDetails = async () => {
    if (!supabase || !variantEditing || variantSaving) return;
    const usedFacts = parseUsedPhoneFacts({
      condition: variantEditing.condition,
      conditionGrade: variantEditing.condition_grade,
      batteryHealth: variantEditing.batteryHealthInput,
      cycleCount: variantEditing.cycleCountInput,
    });
    if (!usedFacts.ok) {
      setMessage(usedFacts.message);
      return;
    }
    setVariantSaving(true);
    // The SKU is never sent: existing SKUs are permanent and read-only.
    const { error } = await supabase
      .from("product_variants")
      .update({
        ...usedFacts.values,
        storage_display: variantEditing.storage_display?.trim() || null,
        ram_display: variantEditing.ram_display?.trim() || null,
        color_finish: variantEditing.color_finish?.trim() || null,
        pta_status: variantEditing.pta_status,
        condition: variantEditing.condition,
        delivery_scope: variantEditing.delivery_scope || null,
      })
      .eq("id", variantEditing.id);
    setVariantSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setVariantEditing(null);
    setMessage("Variant details saved.");
    await load();
  };
  const deleteVariant = async () => {
    if (!supabase || !variantPendingDelete || variantDeleting) return;
    setVariantDeleting(true);
    const { data: media, error: mediaReadError } = await supabase
      .from("product_media")
      .select("id")
      .eq("variant_id", variantPendingDelete.id);
    if (mediaReadError) {
      setMessage(mediaReadError.message);
      setVariantDeleting(false);
      return;
    }
    for (const item of media ?? []) {
      const { error: mediaDeleteError } = await supabase.functions.invoke(
        "cloudinary-delete-media",
        { body: { mediaId: item.id } },
      );
      if (mediaDeleteError) {
        setMessage(`Variant deletion stopped: ${mediaDeleteError.message}`);
        setVariantDeleting(false);
        return;
      }
    }
    const { error } = await supabase.rpc("delete_product_variant", {
      p_variant_id: variantPendingDelete.id,
    });
    setVariantDeleting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(`Variant deleted: ${variantIdentity(variantPendingDelete)}.`);
    setVariantPendingDelete(null);
    await load();
  };
  const adjustStock = async (variantId: string) => {
    if (!supabase) return;
    const delta = Number(stock[variantId]);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!Number.isInteger(delta) || delta === 0 || !user) {
      setMessage("Enter a non-zero whole-number adjustment.");
      return;
    }
    const { error } = await supabase.from("inventory_movements").insert({
      variant_id: variantId,
      quantity_delta: delta,
      reason: "correction",
      actor_id: user.id,
      note: "Phase 4 Admin Studio adjustment",
    });
    setMessage(error?.message ?? "Inventory movement recorded.");
    if (!error) await load();
  };
  const addSpec = async () => {
    if (!supabase || !productId) return;
    const { error } = await supabase.from("product_specifications").insert({
      product_id: productId,
      specification_group: newSpec.specification_group || null,
      label: newSpec.label.trim(),
      value: newSpec.value.trim(),
      sort_order: specs.length,
    });
    setMessage(error?.message ?? "Specification added.");
    if (!error) {
      setNewSpec({ specification_group: "", label: "", value: "" });
      await load();
    }
  };
  return (
    <>
      <div className="editor-head">
        <a className="back-link" href="/admin/products">
          <ArrowLeft /> Products
        </a>
        <div>
          <span className="admin-kicker">
            {draft.publication_status.toUpperCase()} ·{" "}
            {draft.data_class.toUpperCase()} RECORD
          </span>
          <h1>{draft.title || "New product"}</h1>
          <p>
            {productId
              ? draft.slug
              : "Save the product identity before adding variants, inventory, specifications, or media."}
          </p>
        </div>
        <div>
          <button className="admin-secondary" onClick={save}>
            Save draft
          </button>
          <button
            className="admin-primary"
            disabled={!productId}
            onClick={publish}
          >
            Validate & publish
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <nav className="editor-tabs" aria-label="Product editor sections">
          {tabs.map((item) => (
            <button
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
              key={item}
            >
              {item}
              {item === "Variants & Pricing" && <span>{variants.length}</span>}
            </button>
          ))}
        </nav>
        <section className="editor-card">
          {message && (
            <div className="validation-callout">
              <ShieldCheck />
              <div>
                <strong>Catalog status</strong>
                <p>{message}</p>
              </div>
            </div>
          )}
          {tab === "Overview" && (
            <div className="form-grid">
              <label className="wide">
                Product title
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                Brand
                <select
                  value={draft.brand_id}
                  onChange={(e) =>
                    setDraft({ ...draft, brand_id: e.target.value })
                  }
                >
                  <option value="">No brand</option>
                  {brands.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name} · {x.data_class}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={draft.category_id}
                  onChange={(e) =>
                    setDraft({ ...draft, category_id: e.target.value })
                  }
                >
                  <option value="">Select</option>
                  {categories.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name} · {x.data_class}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Slug
                <input
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </label>
              <label className="wide">
                Short description
                <textarea
                  value={draft.short_description}
                  onChange={(e) =>
                    setDraft({ ...draft, short_description: e.target.value })
                  }
                />
              </label>
              <label className="wide">
                Product content
                <textarea
                  value={draft.content}
                  onChange={(e) =>
                    setDraft({ ...draft, content: e.target.value })
                  }
                />
              </label>
              <label>
                Default warranty
                <input
                  value={draft.default_warranty}
                  onChange={(e) =>
                    setDraft({ ...draft, default_warranty: e.target.value })
                  }
                />
              </label>
              <label>
                Default condition
                <select
                  value={draft.default_condition}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      default_condition: e.target
                        .value as Draft["default_condition"],
                    })
                  }
                >
                  <option value="unknown">Unresolved</option>
                  <option value="brand_new">Brand New</option>
                  <option value="used">Used</option>
                  <option value="open_box">Open Box</option>
                  <option value="refurbished">Refurbished</option>
                </select>
              </label>
              <label>
                Default delivery scope
                <select
                  value={draft.default_delivery_scope}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      default_delivery_scope: e.target
                        .value as Draft["default_delivery_scope"],
                    })
                  }
                >
                  <option value="">Unresolved</option>
                  <option value="karachi_only">Karachi only</option>
                  <option value="nationwide">Nationwide</option>
                </select>
              </label>
              <label>
                Default PTA status
                <select
                  value={draft.default_pta_status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      default_pta_status: e.target
                        .value as Draft["default_pta_status"],
                    })
                  }
                >
                  <option value="unknown">Unresolved / Unknown</option>
                  <option value="approved">PTA Approved</option>
                  <option value="not_approved">Non-PTA</option>
                  <option value="not_applicable">Not Applicable</option>
                </select>
              </label>
              <label>
                Catalog class
                <select
                  value={draft.data_class}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      data_class: e.target.value as Draft["data_class"],
                    })
                  }
                >
                  <option value="development">
                    Development — never public
                  </option>
                  <option value="real">Real — Owner-approved facts only</option>
                </select>
              </label>
              <fieldset className="homepage-placement wide">
                <legend>Homepage Placement</legend>
                <div>
                  <label className="admin-checkbox">
                    <input type="checkbox" checked={draft.is_flash_sale} onChange={(e) => setDraft({ ...draft, is_flash_sale: e.target.checked })} />
                    <span>Flash Sale</span>
                  </label>
                  <label className="admin-checkbox">
                    <input type="checkbox" checked={draft.is_featured} onChange={(e) => setDraft({ ...draft, is_featured: e.target.checked })} />
                    <span>Featured Product</span>
                  </label>
                  <label className="admin-checkbox">
                    <input type="checkbox" checked={draft.is_best_seller} onChange={(e) => setDraft({ ...draft, is_best_seller: e.target.checked })} />
                    <span>Best Seller</span>
                  </label>
                </div>
              </fieldset>
            </div>
          )}
          {tab === "Variants & Pricing" && (
            <>
              <div className="editor-section-title">
                <h2>Explicit variants</h2>
                <p>
                  Each row is one actual combination. Unknown facts remain
                  unresolved and block publication.
                </p>
              </div>
              <div className="form-grid">
                <label>
                  SKU
                  <input value="Assigned on save" disabled aria-disabled="true" />
                  <small>SKU assigned automatically.</small>
                </label>
                <label>
                  Price PKR
                  <input
                    type="number"
                    min="0"
                    value={newVariant.price}
                    onChange={(e) =>
                      setNewVariant({ ...newVariant, price: e.target.value })
                    }
                  />
                </label>
                <label>
                  Compare-at Price PKR
                  <input
                    type="number"
                    min="0"
                    value={newVariant.compare_at_price}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        compare_at_price: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Storage
                  <input
                    value={newVariant.storage_display}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        storage_display: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  RAM
                  <input
                    value={newVariant.ram_display}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        ram_display: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Color / finish
                  <input
                    value={newVariant.color_finish}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        color_finish: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  PTA
                  <select
                    value={newVariant.pta_status}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        pta_status: e.target.value,
                      })
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="approved">Approved</option>
                    <option value="not_approved">Not approved</option>
                    <option value="not_applicable">Not applicable</option>
                  </select>
                </label>
                <label>
                  Condition
                  <select
                    value={newVariant.condition}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        condition: e.target.value,
                        // Grade applies to used phones only.
                        condition_grade:
                          e.target.value === "used" ? newVariant.condition_grade : "",
                      })
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="brand_new">Brand new</option>
                    <option value="used">Used</option>
                    <option value="open_box">Open box</option>
                    <option value="refurbished">Refurbished</option>
                  </select>
                </label>
                <label>
                  Condition Grade
                  <select
                    value={newVariant.condition_grade}
                    disabled={newVariant.condition !== "used"}
                    onChange={(e) =>
                      setNewVariant({ ...newVariant, condition_grade: e.target.value })
                    }
                  >
                    <option value="">None</option>
                    {CONDITION_GRADES.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                  <small>Used phones only.</small>
                </label>
                <label>
                  Battery Health %
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={newVariant.battery_health_percent}
                    onChange={(e) =>
                      setNewVariant({ ...newVariant, battery_health_percent: e.target.value })
                    }
                  />
                  <small>Optional · 1–100</small>
                </label>
                <label>
                  Battery Cycle Count
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newVariant.battery_cycle_count}
                    onChange={(e) =>
                      setNewVariant({ ...newVariant, battery_cycle_count: e.target.value })
                    }
                  />
                  <small>Optional · 0 or more</small>
                </label>
                <label>
                  Delivery
                  <select
                    value={newVariant.delivery_scope}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        delivery_scope: e.target.value,
                      })
                    }
                  >
                    <option value="">Unresolved</option>
                    <option value="karachi_only">Karachi only</option>
                    <option value="nationwide">Nationwide</option>
                  </select>
                </label>
                <button
                  className="admin-primary"
                  disabled={!productId}
                  onClick={addVariant}
                >
                  <Plus /> Add explicit variant
                </button>
              </div>
              <div className="variant-list">
                {variants.map((v) => (
                  <article key={v.id} className={v.is_active ? undefined : "variant-hidden"}>
                    <div>
                      <strong>
                        {variantIdentity(v)}
                      </strong>
                      <span>{v.is_active ? "Explicit row" : "Hidden from the store"}</span>
                    </div>
                    <code>{v.sku}</code>
                    <div>
                      <label>
                        Price PKR
                        <input
                          inputMode="decimal"
                          value={
                            variantPrices[v.id] ??
                            pkrMajorInputFromMinor(v.price_minor)
                          }
                          onChange={(event) =>
                            setVariantPrices({
                              ...variantPrices,
                              [v.id]: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Compare-at Price PKR
                        <input
                          inputMode="decimal"
                          value={variantCompareAtPrices[v.id] ?? (v.compare_at_price_minor === null ? "" : pkrMajorInputFromMinor(v.compare_at_price_minor))}
                          onChange={(event) =>
                            setVariantCompareAtPrices({
                              ...variantCompareAtPrices,
                              [v.id]: event.target.value,
                            })
                          }
                        />
                      </label>
                      <small>{formatPkrMinor(v.price_minor)}</small>
                      <button
                        className="admin-secondary"
                        onClick={() => saveVariantPrice(v.id)}
                      >
                        Save pricing
                      </button>
                    </div>
                    <span>{ptaLabel(v.pta_status)}</span>
                    <span>{v.quantity ?? 0} units</span>
                    <div className="variant-actions">
                      <button type="button" className="variant-edit" onClick={() => setVariantEditing(editableVariant(v))} aria-label={`Edit variant ${variantIdentity(v)}`}><Pencil /></button>
                      <button type="button" className="variant-delete" onClick={() => setVariantPendingDelete(v)} aria-label={`Delete variant ${variantIdentity(v)}`}><Trash2 /></button>
                    </div>
                    <dl className="variant-facts" aria-label={`Facts for ${v.sku}`}>
                      <div><dt>SKU</dt><dd>{v.sku}</dd></div>
                      {variantFacts(v).map((fact) => (
                        <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "Inventory" && (
            <>
              <div className="editor-section-title">
                <h2>Inventory ledger</h2>
                <p>
                  Record numeric movements. Existing history is never
                  overwritten.
                </p>
              </div>
              <div className="variant-list">
                {variants.map((v) => (
                  <article key={v.id}>
                    <div>
                      <strong>{v.sku}</strong>
                      <span>{v.quantity ?? 0} on hand</span>
                    </div>
                    <input
                      type="number"
                      value={stock[v.id] ?? ""}
                      onChange={(e) =>
                        setStock({ ...stock, [v.id]: e.target.value })
                      }
                      placeholder="Adjustment"
                    />
                    <button
                      className="admin-secondary"
                      onClick={() => adjustStock(v.id)}
                    >
                      Record movement
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "Specifications" && (
            <>
              <div className="editor-section-title">
                <h2>Specifications</h2>
              </div>
              <div className="form-grid">
                <label>
                  Specification Section
                  <input
                    value={newSpec.specification_group}
                    onChange={(e) =>
                      setNewSpec({
                        ...newSpec,
                        specification_group: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Specification Name
                  <input
                    value={newSpec.label}
                    onChange={(e) =>
                      setNewSpec({ ...newSpec, label: e.target.value })
                    }
                  />
                </label>
                <label>
                  Specification Value
                  <input
                    value={newSpec.value}
                    onChange={(e) =>
                      setNewSpec({ ...newSpec, value: e.target.value })
                    }
                  />
                </label>
                <button
                  className="admin-primary"
                  disabled={!productId}
                  onClick={addSpec}
                >
                  <Plus /> Add Specification
                </button>
              </div>
              <div className="variant-list">
                {specs.map((s) => (
                  <article key={s.id}>
                    <div>
                      <strong>{s.label}</strong>
                      <span>{s.specification_group || "General"}</span>
                    </div>
                    <span>{s.value}</span>
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "Media" && <MediaManager productId={productId} />}{" "}
          {tab === "Frequently Bought Together" && (
            <div className="recommendation-editor">
              <div className="editor-section-title">
                <h2>Frequently Bought Together</h2>
                <p>Select products commonly purchased with this item. Add up to four; their order is used on the storefront.</p>
              </div>
              {!productId ? (
                <p>Save this product before adding recommendations.</p>
              ) : (
                <>
                  <label className="recommendation-search">
                    <Search />
                    <input
                      aria-label="Search recommendation products"
                      value={recommendationQuery}
                      onChange={(event) => setRecommendationQuery(event.target.value)}
                      placeholder="Search products by title, brand or slug"
                    />
                  </label>
                  <div className="recommendation-selected">
                    {recommendationIds.map((id, index) => {
                      const item = recommendationOptions.find((option) => option.id === id);
                      if (!item) return null;
                      return (
                        <article key={id}>
                          <div><strong>{item.title}</strong><span>{item.brand?.name ?? "Unbranded"}</span></div>
                          <span>{item.product_variants.length ? formatPkrMinor(Math.min(...item.product_variants.map((variant) => variant.price_minor))) : "No price"}</span>
                          <div className="recommendation-order">
                            <button type="button" disabled={index === 0} onClick={() => setRecommendationIds((items) => items.map((value, itemIndex) => itemIndex === index - 1 ? id : itemIndex === index ? items[index - 1] : value))} aria-label={`Move ${item.title} up`}><ArrowUp /></button>
                            <button type="button" disabled={index === recommendationIds.length - 1} onClick={() => setRecommendationIds((items) => items.map((value, itemIndex) => itemIndex === index + 1 ? id : itemIndex === index ? items[index + 1] : value))} aria-label={`Move ${item.title} down`}><ArrowDown /></button>
                            <button type="button" onClick={() => setRecommendationIds((items) => items.filter((value) => value !== id))} aria-label={`Remove ${item.title}`}><X /></button>
                          </div>
                        </article>
                      );
                    })}
                    {recommendationIds.length === 0 && <p>No recommendations selected.</p>}
                  </div>
                  <div className="recommendation-options">
                    {recommendationOptions
                      .filter((item) => item.data_class === "real" && item.publication_status === "published")
                      .filter((item) => item.id !== productId && !recommendationIds.includes(item.id))
                      .filter((item) => `${item.title} ${item.slug} ${item.brand?.name ?? ""}`.toLowerCase().includes(recommendationQuery.trim().toLowerCase()))
                      .map((item) => (
                        <button type="button" key={item.id} disabled={recommendationIds.length >= 4} onClick={() => setRecommendationIds((items) => items.includes(item.id) ? items : [...items, item.id])}>
                          <span><strong>{item.title}</strong><small>{item.brand?.name ?? "Unbranded"} · {item.publication_status} · {item.data_class}</small></span>
                          <span>{item.product_variants.length ? formatPkrMinor(Math.min(...item.product_variants.map((variant) => variant.price_minor))) : "No price"}</span>
                          <Plus />
                        </button>
                      ))}
                  </div>
                  <p className="recommendation-count">{recommendationIds.length} of 4 selected. Use Save draft or Validate &amp; publish to persist changes.</p>
                </>
              )}
            </div>
          )}
          {tab === "SEO & Publishing" && (
            <div className="form-grid">
              <label className="wide">
                SEO title
                <input
                  maxLength={70}
                  value={draft.seo_title}
                  onChange={(e) =>
                    setDraft({ ...draft, seo_title: e.target.value })
                  }
                />
              </label>
              <label className="wide">
                SEO description
                <textarea
                  maxLength={170}
                  value={draft.seo_description}
                  onChange={(e) =>
                    setDraft({ ...draft, seo_description: e.target.value })
                  }
                />
              </label>
              <div className="validation-callout wide">
                <ShieldCheck />
                <div>
                  <strong>Validated publication only</strong>
                  <p>
                    Real class, active real brand/category, explicit resolved
                    variants, warranty, delivery, and complete primary
                    Cloudinary media are required.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      {variantPendingDelete && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !variantDeleting) setVariantPendingDelete(null);
        }}>
          <section className="admin-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-variant-title" aria-describedby="delete-variant-description">
            <div className="admin-confirm-icon"><Trash2 /></div>
            <h2 id="delete-variant-title">Delete this variant?</h2>
            <p id="delete-variant-description">This permanently removes the explicit variant and its associated inventory records.</p>
            <strong>{variantIdentity(variantPendingDelete)}</strong>
            <div>
              <button type="button" className="admin-secondary" disabled={variantDeleting} onClick={() => setVariantPendingDelete(null)}>Cancel</button>
              <button type="button" className="admin-destructive" disabled={variantDeleting} onClick={() => void deleteVariant()}>{variantDeleting ? "Deleting…" : "Delete variant"}</button>
            </div>
          </section>
        </div>
      )}
      {variantEditing && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !variantSaving) setVariantEditing(null);
        }}>
          <section className="admin-variant-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-variant-title">
            <h2 id="edit-variant-title">Edit explicit variant</h2>
            <p>Update only verified commercial identity fields. Inventory remains in the Inventory tab.</p>
            <div className="form-grid">
              <label className="wide">SKU<input value={variantEditing.sku} readOnly aria-readonly="true" /><small>SKU assigned automatically and cannot be changed.</small></label>
              <label>Storage<input value={variantEditing.storage_display ?? ""} onChange={(event) => setVariantEditing({ ...variantEditing, storage_display: event.target.value || null })} /></label>
              <label>RAM<input value={variantEditing.ram_display ?? ""} onChange={(event) => setVariantEditing({ ...variantEditing, ram_display: event.target.value || null })} /></label>
              <label>Color / finish<input value={variantEditing.color_finish ?? ""} onChange={(event) => setVariantEditing({ ...variantEditing, color_finish: event.target.value || null })} /></label>
              <label>PTA<select value={variantEditing.pta_status} onChange={(event) => setVariantEditing({ ...variantEditing, pta_status: event.target.value })}><option value="unknown">Unknown</option><option value="approved">Approved</option><option value="not_approved">Not approved</option><option value="not_applicable">Not applicable</option></select></label>
              <label>Condition<select value={variantEditing.condition} onChange={(event) => setVariantEditing({ ...variantEditing, condition: event.target.value, condition_grade: event.target.value === "used" ? variantEditing.condition_grade : null })}><option value="unknown">Unknown</option><option value="brand_new">Brand new</option><option value="used">Used</option><option value="open_box">Open box</option><option value="refurbished">Refurbished</option></select></label>
              <label>Condition Grade<select value={variantEditing.condition_grade ?? ""} disabled={variantEditing.condition !== "used"} onChange={(event) => setVariantEditing({ ...variantEditing, condition_grade: event.target.value || null })}><option value="">None</option>{CONDITION_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select><small>Used phones only.</small></label>
              <label>Battery Health %<input type="number" min="1" max="100" step="1" value={variantEditing.batteryHealthInput} onChange={(event) => setVariantEditing({ ...variantEditing, batteryHealthInput: event.target.value })} /><small>Optional · 1–100 · blank stays empty</small></label>
              <label>Battery Cycle Count<input type="number" min="0" step="1" value={variantEditing.cycleCountInput} onChange={(event) => setVariantEditing({ ...variantEditing, cycleCountInput: event.target.value })} /><small>Optional · 0 or more · blank stays empty</small></label>
              <label>Delivery<select value={variantEditing.delivery_scope ?? ""} onChange={(event) => setVariantEditing({ ...variantEditing, delivery_scope: event.target.value || null })}><option value="">Unresolved</option><option value="karachi_only">Karachi only</option><option value="nationwide">Nationwide</option></select></label>
            </div>
            <div><button type="button" className="admin-secondary" disabled={variantSaving} onClick={() => setVariantEditing(null)}>Cancel</button><button type="button" className="admin-primary" disabled={variantSaving} onClick={() => void saveVariantDetails()}>{variantSaving ? "Saving…" : "Save variant"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}
