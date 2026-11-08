import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { commercialWriteTarget } from "../lib/commercialDefaults";
import { loadAddProductContext, manualCreateDbDeps } from "../lib/manualProductDb";
import {
  MANUAL_CATEGORIES,
  SPEC_SECTION_OPTIONS,
  checkManualProduct,
  emptyManualVariant,
  runManualCreate,
  type ExistingCatalogProduct,
  type ManualCreateResult,
  type ManualProductInput,
  type ManualSpecInput,
  type ManualVariantInput,
} from "../lib/manualProduct";

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const PROD = target.environment === "production";
const CONFIRM_PHRASE = "CREATE PRODUCT";

const emptyInput = (): ManualProductInput => ({ category: "", title: "", brandName: "", content: "", shortDescription: "", variants: [emptyManualVariant()], specs: [] });
const row = { display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", alignItems: "end" } as const;

/**
 * Add Product: create ONE Gadget or Mobile Accessory without Excel. Nothing is saved until "Create product"; the form is
 * checked first (required fields, prices, stock, duplicates), then ONE call to the existing apply_catalog_bulk_import_v2
 * creates the product as a Draft with its variants, stock and specifications. Images and publishing follow in the editor.
 */
export function AddProduct() {
  const [input, setInput] = useState<ManualProductInput>(emptyInput);
  const [catalog, setCatalog] = useState<ExistingCatalogProduct[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualCreateResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    loadAddProductContext(supabase)
      .then((context) => {
        if (!active) return;
        setCatalog(context.catalog);
        setBrands(context.brands);
      })
      .catch((reason) => active && setLoadError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const check = useMemo(() => checkManualProduct(input, catalog, brands), [input, catalog, brands]);
  const set = (patch: Partial<ManualProductInput>) => {
    setInput((current) => ({ ...current, ...patch }));
    setTyped("");
  };
  const setVariant = (index: number, patch: Partial<ManualVariantInput>) =>
    set({ variants: input.variants.map((variant, at) => (at === index ? { ...variant, ...patch } : variant)) });
  const setSpec = (index: number, patch: Partial<ManualSpecInput>) => set({ specs: input.specs.map((spec, at) => (at === index ? { ...spec, ...patch } : spec)) });
  const fillCommon = () =>
    set({
      variants: input.variants.map((variant) => ({
        ...variant,
        pta: variant.pta || "not_applicable",
        condition: variant.condition || "brand_new",
        delivery: variant.delivery || "nationwide",
      })),
    });

  const blocker = !target.allowed
    ? target.reason ?? "Blocked: unknown environment."
    : loading
      ? "Loading the catalog…"
      : loadError
        ? loadError
        : result && result.productId
          ? "Created. Open the product to add images."
          : !check.ok
            ? "Fix the problems listed above."
            : PROD && typed !== CONFIRM_PHRASE
              ? `Type ${CONFIRM_PHRASE} to create it in PRODUCTION.`
              : null;

  const create = async () => {
    setShowErrors(true);
    if (!supabase || blocker || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runManualCreate(
        check,
        { supabaseUrl: import.meta.env.VITE_SUPABASE_URL, buildMode: BUILD_MODE, ...manualCreateDbDeps(supabase) },
        commercialWriteTarget,
      );
      setResult(outcome);
      setTyped("");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const isAccessory = input.category === "mobile-accessories";
  const locked = busy || Boolean(result?.productId);

  return (
    <section className="spec-upload add-product">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">CATALOG · ADD PRODUCT</span>
          <h1>Add a Gadget or Mobile Accessory</h1>
          <p>
            Create one product without Excel. It is saved as a <strong>Draft</strong> with its variants, prices, stock and specifications; then add images
            and Validate &amp; publish in the product editor. An existing product (same name and brand, or same web address) is never created again —
            edit it in Catalog instead. Blank facts stay empty. Connected to {supabaseEnvironmentLabel}.
          </p>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>1 · Product</h3>
        <div className="form-grid">
          <label>
            Category
            <select value={input.category} disabled={locked} onChange={(event) => set({ category: event.target.value as ManualProductInput["category"] })}>
              <option value="">Select</option>
              {MANUAL_CATEGORIES.map((entry) => <option key={entry.slug} value={entry.slug}>{entry.label}</option>)}
            </select>
          </label>
          <label>
            Brand
            <select value={input.brandName} disabled={locked} onChange={(event) => set({ brandName: event.target.value })}>
              <option value="">No brand</option>
              {brands.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="wide">
            Product name
            <input value={input.title} disabled={locked} onChange={(event) => set({ title: event.target.value })} placeholder="e.g. Xiaomi Redmi Buds 8" />
            <small>Web address: {check.slug ? `/product/${check.slug}` : "—"}</small>
          </label>
          <label className="wide">
            Description (Product content)
            <textarea value={input.content} disabled={locked} onChange={(event) => set({ content: event.target.value })} rows={6} placeholder="Leave a blank line between paragraphs. Optional." />
          </label>
          <label className="wide">
            Short description (optional)
            <textarea value={input.shortDescription} disabled={locked} onChange={(event) => set({ shortDescription: event.target.value })} rows={2} />
          </label>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>2 · Variants (colour, price, stock)</h3>
        <p className="stock-hint">
          One row per colour. SKUs are assigned automatically. {isAccessory ? "Accessories need PTA status and condition to be published." : "Gadgets need a price and delivery area to be published."}
        </p>
        <div className="spec-upload-actions">
          <button type="button" disabled={locked} onClick={fillCommon}>Fill empty: PTA Not applicable · Brand new · Nationwide</button>
        </div>
        {input.variants.map((variant, index) => (
          <fieldset key={index} className="add-product-variant" style={{ border: "1px solid var(--admin-line, #ddd)", borderRadius: 10, padding: 12, marginTop: 10 }} disabled={locked}>
            <legend>Variant {index + 1}</legend>
            <div style={row}>
              <label>Colour<input value={variant.color} onChange={(event) => setVariant(index, { color: event.target.value })} placeholder="Optional" /></label>
              <label>Price PKR<input inputMode="decimal" value={variant.price} onChange={(event) => setVariant(index, { price: event.target.value })} /></label>
              <label>Compare-at PKR<input inputMode="decimal" value={variant.compareAt} onChange={(event) => setVariant(index, { compareAt: event.target.value })} placeholder="Optional" /></label>
              <label>Stock<input inputMode="numeric" value={variant.stock} onChange={(event) => setVariant(index, { stock: event.target.value })} /></label>
              <label>
                PTA
                <select value={variant.pta} onChange={(event) => setVariant(index, { pta: event.target.value })}>
                  <option value="">{isAccessory ? "Select" : "Not set"}</option>
                  <option value="not_applicable">Not applicable</option>
                  <option value="approved">Approved</option>
                  <option value="not_approved">Not approved</option>
                </select>
              </label>
              <label>
                Condition
                <select value={variant.condition} onChange={(event) => setVariant(index, { condition: event.target.value })}>
                  <option value="">{isAccessory ? "Select" : "Not set"}</option>
                  <option value="brand_new">Brand new</option>
                  <option value="open_box">Open box</option>
                  <option value="refurbished">Refurbished</option>
                  <option value="used">Used</option>
                </select>
              </label>
              <label>
                Delivery
                <select value={variant.delivery} onChange={(event) => setVariant(index, { delivery: event.target.value })}>
                  <option value="">Select</option>
                  <option value="nationwide">Nationwide</option>
                  <option value="karachi_only">Karachi only</option>
                </select>
              </label>
              <label>Warranty<input value={variant.warranty} onChange={(event) => setVariant(index, { warranty: event.target.value })} placeholder="Optional, e.g. 1 Year" /></label>
              {input.variants.length > 1 && (
                <button type="button" className="admin-secondary" onClick={() => set({ variants: input.variants.filter((_, at) => at !== index) })} aria-label={`Remove variant ${index + 1}`}>
                  <Trash2 /> Remove
                </button>
              )}
            </div>
          </fieldset>
        ))}
        <div className="spec-upload-actions" style={{ marginTop: 10 }}>
          <button type="button" disabled={locked} onClick={() => set({ variants: [...input.variants, emptyManualVariant()] })}><Plus /> Add another colour</button>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>3 · Technical specifications (optional)</h3>
        <p className="stock-hint">Only verified facts. Leave out anything unknown. More can be added later in the editor or with Spec Upload.</p>
        {input.specs.map((spec, index) => (
          <div key={index} style={{ ...row, marginTop: 8 }}>
            <label>
              Section
              <select value={spec.section} disabled={locked} onChange={(event) => setSpec(index, { section: event.target.value })}>
                <option value="">General</option>
                {SPEC_SECTION_OPTIONS.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
            <label>Name<input value={spec.label} disabled={locked} onChange={(event) => setSpec(index, { label: event.target.value })} /></label>
            <label>Value<input value={spec.value} disabled={locked} onChange={(event) => setSpec(index, { value: event.target.value })} /></label>
            <button type="button" className="admin-secondary" disabled={locked} onClick={() => set({ specs: input.specs.filter((_, at) => at !== index) })} aria-label={`Remove specification ${index + 1}`}>
              <Trash2 /> Remove
            </button>
          </div>
        ))}
        <div className="spec-upload-actions" style={{ marginTop: 10 }}>
          <button type="button" disabled={locked} onClick={() => set({ specs: [...input.specs, { section: "", label: "", value: "" }] })}><Plus /> Add specification</button>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>4 · Create product (Draft)</h3>
        {(showErrors || check.errors.length <= 3) && check.errors.length > 0 && !result?.productId && (
          <ul className="admin-error" aria-label="Problems to fix">
            {check.errors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}
        <div className="spec-upload-actions">
          {PROD && !result?.productId && (
            <input type="text" value={typed} placeholder={CONFIRM_PHRASE} onChange={(event) => setTyped(event.target.value)} disabled={busy || !check.ok} aria-label="PRODUCTION confirmation" />
          )}
          <button type="button" className="admin-primary" disabled={Boolean(blocker) || busy} onClick={() => void create()}>
            {busy ? "Creating…" : `Create product in ${target.environment ? target.environment.toUpperCase() : "—"}`}
          </button>
        </div>
        {blocker && <small>{blocker}</small>}
        {result && (
          <div className="spec-upload-result">
            <p className={result.status === "created" ? "" : "admin-error"}>
              {result.status === "created" ? <CheckCircle2 /> : result.status === "created_with_problems" ? <AlertTriangle /> : <XCircle />} {result.message}
            </p>
            {result.checks.length > 0 && <ul>{result.checks.map((entry) => <li key={entry.name}>{entry.ok ? "✓" : "✗"} {entry.name} — {entry.detail}</li>)}</ul>}
            {result.productId && (
              <div className="spec-upload-actions">
                <a className="admin-primary" href={`/admin/products/${result.productId}?tab=media`}>Open product → add images</a>
                <a className="admin-secondary" href="/admin/products/add">Add another product</a>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
