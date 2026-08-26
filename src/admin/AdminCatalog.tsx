import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  formatPkrMinor,
  parsePkrMajorToMinor,
  pkrMajorInputFromMinor,
} from "../lib/money";
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
  default_delivery_scope: "" | "karachi_only" | "nationwide";
  seo_title: string;
  seo_description: string;
  publication_status: "draft" | "published" | "archived";
  data_class: "development" | "real";
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
  quantity?: number;
};
type Specification = {
  id: string;
  specification_group: string | null;
  label: string;
  value: string;
  sort_order: number;
};
const emptyDraft: Draft = {
  title: "",
  slug: "",
  brand_id: "",
  category_id: "",
  short_description: "",
  content: "",
  default_warranty: "",
  default_delivery_scope: "",
  seo_title: "",
  seo_description: "",
  publication_status: "draft",
  data_class: "development",
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
        "id,title,slug,publication_status,data_class,brand:brands(name),category:categories(name),product_variants(id)",
      )
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setProducts((data ?? []) as unknown as ProductRow[]);
      });
  }, []);
  const shown = products.filter((p) =>
    `${p.title} ${p.slug} ${p.brand?.name ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
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
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [message, setMessage] = useState("");
  const [newVariant, setNewVariant] = useState({
    sku: "",
    ram_display: "",
    storage_display: "",
    color_finish: "",
    price: "",
    pta_status: "unknown",
    condition: "unknown",
    delivery_scope: "",
  });
  const [stock, setStock] = useState<Record<string, string>>({});
  const [newSpec, setNewSpec] = useState({
    specification_group: "",
    label: "",
    value: "",
  });
  const load = useCallback(async () => {
    if (!supabase) return;
    const [b, c] = await Promise.all([
      supabase
        .from("brands")
        .select("id,name,slug,data_class,is_active")
        .order("name"),
      supabase
        .from("categories")
        .select("id,name,slug,data_class,is_active")
        .order("name"),
    ]);
    setBrands((b.data ?? []) as Option[]);
    setCategories((c.data ?? []) as Option[]);
    if (!productId) return;
    const [p, v, s, i] = await Promise.all([
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
    ]);
    if (p.error) {
      setMessage(p.error.message);
      return;
    }
    setDraft({
      ...emptyDraft,
      ...p.data,
      short_description: p.data.short_description ?? "",
      content: p.data.content ?? "",
      default_warranty: p.data.default_warranty ?? "",
      default_delivery_scope: p.data.default_delivery_scope ?? "",
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
    setSpecs((s.data ?? []) as Specification[]);
  }, [productId]);
  useEffect(() => {
    load();
  }, [load]);
  const persistChangedVariantPrices = async () => {
    if (!supabase) return "Supabase is not configured.";

    for (const variant of variants) {
      let priceMinor: number;
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

      if (priceMinor === variant.price_minor) continue;
      const { error } = await supabase
        .from("product_variants")
        .update({ price_minor: priceMinor })
        .eq("id", variant.id);
      if (error) return error.message;
    }
    return null;
  };
  const save = async () => {
    if (!supabase) return;
    if (
      !draft.title.trim() ||
      !draft.slug.trim() ||
      !draft.brand_id ||
      !draft.category_id
    ) {
      setMessage("Title, slug, brand, and category are required.");
      return;
    }
    const payload = {
      ...draft,
      title: draft.title.trim(),
      slug: draft.slug.trim(),
      short_description: draft.short_description || null,
      content: draft.content || null,
      default_warranty: draft.default_warranty || null,
      default_delivery_scope: draft.default_delivery_scope || null,
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
      const variantPriceError = await persistChangedVariantPrices();
      if (variantPriceError) {
        setMessage(variantPriceError);
        return;
      }
      setMessage("Draft saved.");
      await load();
    }
  };
  const publish = async () => {
    if (!supabase || !productId) return;
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
      .update({ publication_status: "published" })
      .eq("id", productId);
    setMessage(error?.message ?? "Published successfully.");
    if (!error) await load();
  };
  const addVariant = async () => {
    if (!supabase || !productId) return;
    let priceMinor: number;
    try {
      priceMinor = parsePkrMajorToMinor(newVariant.price);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Enter a valid PKR price.",
      );
      return;
    }
    const { error } = await supabase.from("product_variants").insert({
      product_id: productId,
      sku: newVariant.sku.trim(),
      ram_display: newVariant.ram_display || null,
      storage_display: newVariant.storage_display || null,
      color_finish: newVariant.color_finish || null,
      price_minor: priceMinor,
      pta_status: newVariant.pta_status,
      condition: newVariant.condition,
      delivery_scope: newVariant.delivery_scope || null,
    });
    setMessage(error?.message ?? "Explicit variant added.");
    if (!error) {
      setNewVariant({
        sku: "",
        ram_display: "",
        storage_display: "",
        color_finish: "",
        price: "",
        pta_status: "unknown",
        condition: "unknown",
        delivery_scope: "",
      });
      await load();
    }
  };
  const saveVariantPrice = async (variantId: string) => {
    if (!supabase) return;
    if (!variants.some((item) => item.id === variantId)) return;
    const error = await persistChangedVariantPrices();
    setMessage(error ?? "Variant price saved exactly.");
    if (!error) await load();
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
                  <option value="">Select</option>
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
                  <input
                    value={newVariant.sku}
                    onChange={(e) =>
                      setNewVariant({ ...newVariant, sku: e.target.value })
                    }
                  />
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
                  <article key={v.id}>
                    <div>
                      <strong>
                        {[v.storage_display, v.ram_display, v.color_finish]
                          .filter(Boolean)
                          .join(" / ") || v.sku}
                      </strong>
                      <span>Explicit row</span>
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
                      <small>{formatPkrMinor(v.price_minor)}</small>
                      <button
                        className="admin-secondary"
                        onClick={() => saveVariantPrice(v.id)}
                      >
                        Save price
                      </button>
                    </div>
                    <span>{v.pta_status}</span>
                    <span>{v.quantity ?? 0} units</span>
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
                  Group
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
                  Label
                  <input
                    value={newSpec.label}
                    onChange={(e) =>
                      setNewSpec({ ...newSpec, label: e.target.value })
                    }
                  />
                </label>
                <label>
                  Value
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
                  <Plus /> Add specification
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
    </>
  );
}
