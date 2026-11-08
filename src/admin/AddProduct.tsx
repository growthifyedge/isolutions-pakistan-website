import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { commercialWriteTarget } from "../lib/commercialDefaults";
import { loadAddProductContext, manualCreateDbDeps } from "../lib/manualProductDb";
import { CONDITION_GRADES, SIM_CONFIGURATIONS, conditionLabel, ptaLabel } from "../lib/variantFacts";
import {
  IPHONE_NEW_WARRANTIES,
  KIND_PROFILES,
  SPEC_SECTION_OPTIONS,
  checkManualProduct,
  emptyManualVariant,
  kindProfile,
  runManualCreate,
  type ExistingCatalogProduct,
  type KindProfile,
  type ManualCreateResult,
  type ManualProductInput,
  type ManualSpecInput,
  type ManualVariantInput,
} from "../lib/manualProduct";

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const PROD = target.environment === "production";
const CONFIRM_PHRASE = "CREATE PRODUCT";

const emptyInput = (): ManualProductInput => ({ category: "", title: "", brandName: "", content: "", shortDescription: "", productCondition: "", connectivity: "", variants: [emptyManualVariant()], specs: [] });
const row = { display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", alignItems: "end" } as const;
const fixed = (rule: unknown) => (rule && typeof rule === "object" && "fixed" in (rule as object) ? (rule as { fixed: string }).fixed : null);
const groups = [...new Set(KIND_PROFILES.map((profile) => profile.group))];
const Locked = ({ label, value }: { label: string; value: string }) => (
  <label>
    {label}
    <input value={value} readOnly aria-readonly="true" />
    <small>Set by the category rule</small>
  </label>
);

/**
 * Add Product: create ONE product of any category without Excel. Nothing is saved until "Create product"; the form is
 * checked first (category rules, required facts, prices, stock, duplicate products and variants), then ONE call to the
 * existing apply_catalog_bulk_import_v2 creates it as a Draft with its variants, stock and specifications. Images and
 * Validate & publish follow in the product editor (the server checks every publish rule).
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

  const profile: KindProfile | null = kindProfile(input.category);
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

  const locked = busy || Boolean(result?.productId);
  const isGadgetLike = profile?.kind === "gadgets" || profile?.kind === "mobile-accessories";
  const ptaFixed = fixed(profile?.pta);
  const conditionFixed = fixed(profile?.condition);
  const warrantyFixed = fixed(profile?.warranty);
  const productConditionLabel = input.productCondition ? conditionLabel(input.productCondition) : "Choose New / Used above";

  const ptaField = (variant: ManualVariantInput, index: number) => {
    if (!profile) return null;
    if (ptaFixed) return <Locked label="PTA" value={ptaLabel(ptaFixed)} />;
    if (profile.pta === "by-connectivity" && input.connectivity !== "cellular")
      return <Locked label="PTA" value={input.connectivity === "wifi" ? ptaLabel("not_applicable") : "Choose connectivity above"} />;
    const both = profile.pta === "approved-or-non" || profile.pta === "by-connectivity";
    return (
      <label>
        PTA
        <select value={variant.pta} onChange={(event) => setVariant(index, { pta: event.target.value })}>
          <option value="">{profile.pta === "optional" ? "Not set" : "Select"}</option>
          {!both && <option value="not_applicable">Not applicable</option>}
          <option value="approved">PTA Approved</option>
          <option value="not_approved">Non-PTA</option>
        </select>
      </label>
    );
  };
  const conditionField = (variant: ManualVariantInput, index: number) => {
    if (!profile) return null;
    if (conditionFixed) return <Locked label="Condition" value={conditionLabel(conditionFixed)} />;
    if (profile.condition === "by-product") return <Locked label="Condition" value={productConditionLabel} />;
    return (
      <label>
        Condition
        <select value={variant.condition} onChange={(event) => setVariant(index, { condition: event.target.value })}>
          <option value="">{profile.condition === "optional" ? "Not set" : "Select"}</option>
          <option value="brand_new">Brand new</option>
          <option value="open_box">Open box</option>
          <option value="refurbished">Refurbished</option>
          <option value="used">Used</option>
        </select>
      </label>
    );
  };
  const warrantyField = (variant: ManualVariantInput, index: number) => {
    if (!profile || profile.warranty === "hidden") return null;
    if (warrantyFixed) return <Locked label="Warranty" value={warrantyFixed} />;
    if (profile.warranty === "required")
      return (
        <label>
          Warranty
          <select value={variant.warranty} onChange={(event) => setVariant(index, { warranty: event.target.value })}>
            <option value="">Select</option>
            {IPHONE_NEW_WARRANTIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      );
    return <label>Warranty<input value={variant.warranty} onChange={(event) => setVariant(index, { warranty: event.target.value })} placeholder="Optional, e.g. 1 Year" /></label>;
  };

  return (
    <section className="spec-upload add-product">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">CATALOG · ADD PRODUCT</span>
          <h1>Add a product</h1>
          <p>
            Create one product of any category without Excel. It is saved as a <strong>Draft</strong> with its variants, prices, stock and
            specifications; then add images and Validate &amp; publish in the product editor. Category rules (PTA, condition, warranty, delivery) are
            applied for you and shown as locked. An existing product (same name and brand, or same web address) is never created again — edit it in
            Catalog instead. Blank facts stay empty. Connected to {supabaseEnvironmentLabel}.
          </p>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>1 · Product</h3>
        <div className="form-grid">
          <label>
            What are you adding?
            <select value={input.category} disabled={locked} onChange={(event) => set({ category: event.target.value as ManualProductInput["category"] })}>
              <option value="">Select</option>
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {KIND_PROFILES.filter((entry) => entry.group === group).map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {profile?.brand === "apple" ? (
            <Locked label="Brand" value="Apple" />
          ) : (
            <label>
              Brand
              <select value={input.brandName} disabled={locked} onChange={(event) => set({ brandName: event.target.value })}>
                <option value="">{profile?.brand === "optional" || !profile ? "No brand" : "Select"}</option>
                {brands.filter((name) => profile?.brand !== "not-apple" || name.toLowerCase() !== "apple").map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          {profile?.usedTitle === "by-condition" && (
            <label>
              New or Used
              <select value={input.productCondition ?? ""} disabled={locked} onChange={(event) => set({ productCondition: event.target.value as ManualProductInput["productCondition"] })}>
                <option value="">Select</option>
                <option value="brand_new">New</option>
                <option value="used">Used</option>
              </select>
            </label>
          )}
          {profile?.kind === "tablet" && (
            <label>
              Connectivity
              <select value={input.connectivity ?? ""} disabled={locked} onChange={(event) => set({ connectivity: event.target.value as ManualProductInput["connectivity"] })}>
                <option value="">Select</option>
                <option value="wifi">Wi-Fi only (PTA Not Applicable)</option>
                <option value="cellular">Cellular (PTA Approved / Non-PTA)</option>
              </select>
            </label>
          )}
          <label className="wide">
            Product name
            <input value={input.title} disabled={locked} onChange={(event) => set({ title: event.target.value })} placeholder={profile?.kind === "iphone-used" ? "e.g. Apple iPhone 15 Pro Max" : "e.g. Xiaomi Redmi Buds 8"} />
            <small>Saved as: {check.title || "—"} · Web address: {check.slug ? `/product/${check.slug}` : "—"}</small>
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
        <h3>2 · Variants</h3>
        <p className="stock-hint">
          One row per {profile?.storage ? "storage / colour" : "colour"}. SKUs are assigned automatically.
          {profile && !isGadgetLike && " Delivery is Karachi only for this category."}
          {profile?.kind === "iphone-used" && " Battery health, cycles and grade are optional — enter them only when known."}
        </p>
        {isGadgetLike && (
          <div className="spec-upload-actions">
            <button type="button" disabled={locked} onClick={fillCommon}>Fill empty: PTA Not applicable · Brand new · Nationwide</button>
          </div>
        )}
        {input.variants.map((variant, index) => (
          <fieldset key={index} className="add-product-variant" style={{ border: "1px solid var(--admin-line, #ddd)", borderRadius: 10, padding: 12, marginTop: 10 }} disabled={locked}>
            <legend>Variant {index + 1}</legend>
            <div style={row}>
              {profile?.ram && <label>RAM<input value={variant.ram ?? ""} onChange={(event) => setVariant(index, { ram: event.target.value })} placeholder="Optional, e.g. 8 GB" /></label>}
              {profile?.storage && <label>Storage<input value={variant.storage ?? ""} onChange={(event) => setVariant(index, { storage: event.target.value })} placeholder="e.g. 256 GB" /></label>}
              <label>Colour<input value={variant.color} onChange={(event) => setVariant(index, { color: event.target.value })} placeholder="Optional" /></label>
              <label>Price PKR<input inputMode="decimal" value={variant.price} onChange={(event) => setVariant(index, { price: event.target.value })} /></label>
              <label>Compare-at PKR<input inputMode="decimal" value={variant.compareAt} onChange={(event) => setVariant(index, { compareAt: event.target.value })} placeholder="Optional" /></label>
              <label>Stock<input inputMode="numeric" value={variant.stock} onChange={(event) => setVariant(index, { stock: event.target.value })} /></label>
              {ptaField(variant, index)}
              {conditionField(variant, index)}
              {profile?.delivery === "karachi_only" ? (
                <Locked label="Delivery" value="Karachi only" />
              ) : (
                <label>
                  Delivery
                  <select value={variant.delivery} onChange={(event) => setVariant(index, { delivery: event.target.value })}>
                    <option value="">Select</option>
                    <option value="nationwide">Nationwide</option>
                    <option value="karachi_only">Karachi only</option>
                  </select>
                </label>
              )}
              {warrantyField(variant, index)}
              {profile?.sim && (
                <label>
                  SIM
                  <select value={variant.sim ?? ""} onChange={(event) => setVariant(index, { sim: event.target.value })}>
                    <option value="">Not set</option>
                    {SIM_CONFIGURATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              )}
              {profile?.usedFacts && (
                <>
                  <label>
                    Grade
                    <select value={variant.grade ?? ""} onChange={(event) => setVariant(index, { grade: event.target.value })}>
                      <option value="">None</option>
                      {CONDITION_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                    </select>
                  </label>
                  <label>Battery health %<input inputMode="numeric" value={variant.batteryHealth ?? ""} onChange={(event) => setVariant(index, { batteryHealth: event.target.value })} placeholder="Optional" /></label>
                  <label>Cycle count<input inputMode="numeric" value={variant.cycleCount ?? ""} onChange={(event) => setVariant(index, { cycleCount: event.target.value })} placeholder="Optional" /></label>
                </>
              )}
              {input.variants.length > 1 && (
                <button type="button" className="admin-secondary" onClick={() => set({ variants: input.variants.filter((_, at) => at !== index) })} aria-label={`Remove variant ${index + 1}`}>
                  <Trash2 /> Remove
                </button>
              )}
            </div>
          </fieldset>
        ))}
        <div className="spec-upload-actions" style={{ marginTop: 10 }}>
          <button type="button" disabled={locked} onClick={() => set({ variants: [...input.variants, emptyManualVariant()] })}><Plus /> Add another variant</button>
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
        {check.warnings.length > 0 && !result?.productId && (
          <ul className="stock-hint" aria-label="Warnings">
            {check.warnings.map((message) => <li key={message}><AlertTriangle /> {message}</li>)}
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
