import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Shuffle, TicketPercent, X } from "lucide-react";
import { formatPkrMinor } from "../lib/catalog";
import {
  buildCouponPayload,
  couponFormValuesFrom,
  couponStatus,
  couponStatusLabel,
  couponTypeLabel,
  describeCouponValue,
  generateCouponCode,
  suggestedCouponPrefix,
  type CouponFormValues,
  type CouponRow,
  type CouponStatus,
} from "../lib/coupons";
import { supabase } from "../lib/supabase";

type CouponWithUsage = CouponRow & { coupon_redemptions: { count: number }[] };
type Category = { id: string; name: string; parent_id: string | null };
type ProductOption = { id: string; title: string; publication_status: string };
type FieldErrors = Partial<Record<keyof CouponFormValues, string>>;

const usageOf = (coupon: CouponWithUsage) => Number(coupon.coupon_redemptions?.[0]?.count ?? 0);
const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function validityLabel(coupon: CouponRow) {
  if (!coupon.starts_at && !coupon.ends_at) return "Always";
  if (coupon.starts_at && coupon.ends_at) return `${dateLabel(coupon.starts_at)} – ${dateLabel(coupon.ends_at)}`;
  if (coupon.starts_at) return `From ${dateLabel(coupon.starts_at)}`;
  return `Until ${dateLabel(coupon.ends_at!)}`;
}

function saveErrorMessage(error: { code?: string; message?: string }) {
  if (error.code === "23505") return "This code already exists. Choose another code.";
  if (error.code === "23503") return "This coupon has been used on orders, so it can't be deleted. Disable it instead.";
  if (error.code === "42501") return "Your account is not allowed to manage coupons.";
  if (error.code === "23514") return "Some values are not allowed. Check the highlighted fields and try again.";
  return error.message ?? "The coupon could not be saved. Please try again.";
}

export function AdminPromotions() {
  const [coupons, setCoupons] = useState<CouponWithUsage[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ coupon: CouponWithUsage | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const now = new Date();

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    const client = supabase;
    let active = true;
    Promise.all([
      client.from("coupons").select("*, coupon_redemptions(count)").order("created_at", { ascending: false }),
      client.from("categories").select("id,name,parent_id").eq("data_class", "real").eq("is_active", true).order("sort_order"),
      client.from("products").select("id,title,publication_status").eq("data_class", "real").neq("publication_status", "archived").order("title").range(0, 999),
    ]).then(([couponResult, categoryResult, productResult]) => {
      if (!active) return;
      const failed = [couponResult, categoryResult, productResult].find((result) => result.error);
      if (failed?.error) setError(failed.error.message);
      else {
        setError("");
        setCoupons((couponResult.data ?? []) as unknown as CouponWithUsage[]);
        setCategories((categoryResult.data ?? []) as Category[]);
        setProducts((productResult.data ?? []) as ProductOption[]);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [reloadKey]);
  const reload = () => { setLoading(true); setReloadKey((key) => key + 1); };

  const counts = useMemo(() => {
    const at = new Date();
    const totals: Record<CouponStatus, number> = { active: 0, scheduled: 0, expired: 0, disabled: 0 };
    for (const coupon of coupons) totals[couponStatus(coupon, at)] += 1;
    return totals;
  }, [coupons]);
  const categoryName = (id: string | null) => categories.find((category) => category.id === id)?.name ?? "Unavailable category";
  const productName = (id: string | null) => products.find((product) => product.id === id)?.title ?? "Unavailable product";
  const scopeLabel = (coupon: CouponRow) =>
    coupon.applies_to === "all" ? "All products"
    : coupon.applies_to === "category" ? `Category: ${categoryName(coupon.category_id)}`
    : `Product: ${productName(coupon.product_id)}`;

  const toggleActive = async (coupon: CouponWithUsage) => {
    if (!supabase || busyId) return;
    setBusyId(coupon.id);
    setNotice("");
    const { data, error: updateError } = await supabase.from("coupons").update({ is_active: !coupon.is_active }).eq("id", coupon.id).select("id,is_active");
    if (updateError || !data?.length) setNotice(updateError ? saveErrorMessage(updateError) : "The change was not saved.");
    else {
      setCoupons((current) => current.map((item) => (item.id === coupon.id ? { ...item, is_active: !coupon.is_active } : item)));
      setNotice(`${coupon.code} ${coupon.is_active ? "disabled" : "enabled"}.`);
    }
    setBusyId(null);
  };

  const remove = async (coupon: CouponWithUsage) => {
    if (!supabase || busyId) return;
    if (!window.confirm(`Delete coupon ${coupon.code}? This cannot be undone.`)) return;
    setBusyId(coupon.id);
    setNotice("");
    const { data, error: deleteError } = await supabase.from("coupons").delete().eq("id", coupon.id).select("id");
    if (deleteError || !data?.length) setNotice(deleteError ? saveErrorMessage(deleteError) : "The coupon was not deleted.");
    else {
      setCoupons((current) => current.filter((item) => item.id !== coupon.id));
      setNotice(`${coupon.code} deleted.`);
    }
    setBusyId(null);
  };

  return (
    <div className="promotions">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">MARKETING</span>
          <h1>Promotions</h1>
          <p>Create and manage checkout coupon codes.</p>
        </div>
        <div className="promotions-actions">
          <button type="button" className="admin-secondary" onClick={reload} disabled={loading}>
            <RefreshCw aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="admin-primary" onClick={() => setEditor({ coupon: null })}>
            <Plus aria-hidden="true" /> Create coupon
          </button>
        </div>
      </div>

      {error ? <div className="ops-error" role="alert"><span>Coupons could not be loaded: {error}</span><button type="button" onClick={reload}>Retry</button></div> : null}
      {notice ? <div className="promotions-notice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><X /></button></div> : null}

      <section className="ops-kpis promotions-kpis" aria-label="Coupon status" aria-busy={loading}>
        {(["active", "scheduled", "expired", "disabled"] as const).map((status) => (
          <article className="ops-kpi" key={status}>
            <small>{couponStatusLabel[status]}</small>
            <strong>{loading ? "—" : counts[status]}</strong>
            <span>
              {status === "active" ? "Usable at checkout now"
                : status === "scheduled" ? "Start date in the future"
                : status === "expired" ? "End date has passed"
                : "Switched off by an admin"}
            </span>
          </article>
        ))}
      </section>

      <section className="promotions-table" aria-label="Coupons">
        <div className="promotions-head" aria-hidden="true">
          <span>Code</span><span>Type</span><span>Value</span><span>Applies to</span><span>Usage</span><span>Validity</span><span>Status</span><span>Actions</span>
        </div>
        {loading && !coupons.length ? (
          <p className="promotions-empty">Loading coupons…</p>
        ) : coupons.length ? (
          coupons.map((coupon) => {
            const status = couponStatus(coupon, now);
            const used = usageOf(coupon);
            return (
              <div className="promotions-row" key={coupon.id}>
                <div className="promotions-code"><strong>{coupon.code}</strong><small>{coupon.name}</small></div>
                <span>{couponTypeLabel[coupon.discount_type]}</span>
                <span>{describeCouponValue(coupon)}{coupon.minimum_order_minor ? <small>Min order {formatPkrMinor(coupon.minimum_order_minor)}</small> : null}</span>
                <span className="promotions-scope">{scopeLabel(coupon)}</span>
                <span>
                  {used} / {coupon.total_usage_limit ?? "∞"}
                  {coupon.per_customer_usage_limit ? <small>{coupon.per_customer_usage_limit} per customer</small> : null}
                </span>
                <span className="promotions-validity">{validityLabel(coupon)}</span>
                <span className={`promo-status ${status}`}>{couponStatusLabel[status]}</span>
                <div className="promotions-row-actions">
                  <button type="button" onClick={() => setEditor({ coupon })}>Edit</button>
                  <button type="button" onClick={() => void toggleActive(coupon)} disabled={busyId === coupon.id}>
                    {coupon.is_active ? "Disable" : "Enable"}
                  </button>
                  {used === 0 ? (
                    <button type="button" className="danger" onClick={() => void remove(coupon)} disabled={busyId === coupon.id}>Delete</button>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <div className="promotions-empty">
            <TicketPercent aria-hidden="true" />
            <strong>No coupons yet.</strong>
            <span>Create a coupon code to offer a percentage, fixed amount or free-shipping discount at checkout.</span>
          </div>
        )}
      </section>
      <p className="promotions-footnote">
        Coupons are validated and applied by the database at order creation. Usage is counted per order and is not restored when an order is cancelled.
        Used coupons can be disabled but not deleted.
      </p>

      {editor ? (
        <CouponEditor
          coupon={editor.coupon}
          categories={categories}
          products={products}
          onClose={() => setEditor(null)}
          onSaved={(saved, isNew) => {
            setCoupons((current) => {
              const withUsage = { ...saved, coupon_redemptions: editor.coupon?.coupon_redemptions ?? [{ count: 0 }] };
              return isNew ? [withUsage, ...current] : current.map((item) => (item.id === saved.id ? withUsage : item));
            });
            setNotice(`${saved.code} ${isNew ? "created" : "saved"}.`);
            setEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CouponEditor({
  coupon,
  categories,
  products,
  onClose,
  onSaved,
}: {
  coupon: CouponWithUsage | null;
  categories: Category[];
  products: ProductOption[];
  onClose: () => void;
  onSaved: (coupon: CouponRow, isNew: boolean) => void;
}) {
  const [values, setValues] = useState<CouponFormValues>(() => couponFormValuesFrom(coupon));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const isNew = !coupon;
  const set = <K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const generate = async () => {
    if (!supabase) return;
    setGenerating(true);
    const prefix = suggestedCouponPrefix(values.discountType, values.discountValue);
    let code = generateCouponCode(values.code, prefix);
    // Fill only; uniqueness is re-checked by the database unique index when saving.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data } = await supabase.from("coupons").select("id").eq("code", code).limit(1);
      if (!data?.length) break;
      code = generateCouponCode(values.code, prefix);
    }
    set("code", code);
    setGenerating(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || saving) return;
    const result = buildCouponPayload(values);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    setSaveError("");
    const query = isNew
      ? supabase.from("coupons").insert(result.payload).select("*").single()
      : supabase.from("coupons").update(result.payload).eq("id", coupon!.id).select("*").single();
    const { data, error } = await query;
    setSaving(false);
    if (error || !data) {
      setSaveError(error ? saveErrorMessage(error) : "The coupon was not saved.");
      if (error?.code === "23505") setErrors((current) => ({ ...current, code: "This code already exists." }));
      return;
    }
    onSaved(data as CouponRow, isNew);
  };

  const shownProducts = products.filter(
    (product) => product.id === values.productId || !productQuery.trim() || product.title.toLowerCase().includes(productQuery.trim().toLowerCase()),
  );
  const error = (key: keyof CouponFormValues) => (errors[key] ? <small className="field-error">{errors[key]}</small> : null);
  const parentName = (category: Category) => categories.find((item) => item.id === category.parent_id)?.name;

  return (
    <div className="coupon-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <aside className="coupon-editor" role="dialog" aria-modal="true" aria-labelledby="coupon-editor-title">
        <header>
          <div>
            <span className="admin-kicker">{isNew ? "NEW COUPON" : "EDIT COUPON"}</span>
            <h2 id="coupon-editor-title">{isNew ? "Create coupon" : coupon!.code}</h2>
          </div>
          <button type="button" className="coupon-editor-close" aria-label="Close" onClick={onClose} disabled={saving}><X /></button>
        </header>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="coupon-form">
            <label className="wide">
              Code
              <div className="coupon-code-row">
                <input value={values.code} onChange={(event) => set("code", event.target.value.toUpperCase())} maxLength={32}
                  placeholder="e.g. SAVE10-X7K2" autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.code)} autoFocus />
                <button type="button" className="admin-secondary" onClick={() => void generate()} disabled={generating}>
                  <Shuffle aria-hidden="true" /> {generating ? "Generating…" : "Generate code"}
                </button>
              </div>
              <small className="field-help">Letters, numbers, hyphen or underscore. Customers can type it in any case.</small>
              {error("code")}
            </label>
            <label className="wide">
              Internal name
              <input value={values.name} onChange={(event) => set("name", event.target.value)} maxLength={120} placeholder="e.g. Eid 2026 — 10% off" aria-invalid={Boolean(errors.name)} />
              {error("name")}
            </label>
            <label className="wide">
              Internal note <span className="field-optional">Optional</span>
              <textarea value={values.description} onChange={(event) => set("description", event.target.value)} rows={2} maxLength={1000} />
              {error("description")}
            </label>

            <fieldset className="wide">
              <legend>Discount type</legend>
              <div className="coupon-type-options">
                {(["percentage", "fixed_amount", "free_shipping"] as const).map((type) => (
                  <label key={type} className={values.discountType === type ? "is-selected" : ""}>
                    <input type="radio" name="discountType" value={type} checked={values.discountType === type} onChange={() => set("discountType", type)} />
                    {couponTypeLabel[type]}
                  </label>
                ))}
              </div>
            </fieldset>

            {values.discountType !== "free_shipping" ? (
              <label>
                {values.discountType === "percentage" ? "Discount (%)" : "Discount amount (Rs)"}
                <input value={values.discountValue} onChange={(event) => set("discountValue", event.target.value)} inputMode="decimal"
                  placeholder={values.discountType === "percentage" ? "10" : "500"} aria-invalid={Boolean(errors.discountValue)} />
                {error("discountValue")}
              </label>
            ) : (
              <p className="coupon-type-note">Removes the Standard or Fast delivery charge. Product prices are unchanged.</p>
            )}
            {values.discountType === "percentage" ? (
              <label>
                Max discount (Rs) <span className="field-optional">Optional</span>
                <input value={values.maximumDiscount} onChange={(event) => set("maximumDiscount", event.target.value)} inputMode="decimal" placeholder="No cap" aria-invalid={Boolean(errors.maximumDiscount)} />
                {error("maximumDiscount")}
              </label>
            ) : null}
            <label>
              Minimum order (Rs) <span className="field-optional">Optional</span>
              <input value={values.minimumOrder} onChange={(event) => set("minimumOrder", event.target.value)} inputMode="decimal" placeholder="No minimum" aria-invalid={Boolean(errors.minimumOrder)} />
              <small className="field-help">Compared with the cart subtotal before discount, excluding delivery.</small>
              {error("minimumOrder")}
            </label>

            <label>
              Starts <span className="field-optional">Optional</span>
              <input type="datetime-local" value={values.startsAt} onChange={(event) => set("startsAt", event.target.value)} aria-invalid={Boolean(errors.startsAt)} />
              {error("startsAt")}
            </label>
            <label>
              Ends <span className="field-optional">Optional</span>
              <input type="datetime-local" value={values.endsAt} onChange={(event) => set("endsAt", event.target.value)} aria-invalid={Boolean(errors.endsAt)} />
              {error("endsAt")}
            </label>
            <label>
              Total usage limit <span className="field-optional">Optional</span>
              <input value={values.totalUsageLimit} onChange={(event) => set("totalUsageLimit", event.target.value)} inputMode="numeric" placeholder="Unlimited" aria-invalid={Boolean(errors.totalUsageLimit)} />
              {error("totalUsageLimit")}
            </label>
            <label>
              Per-customer limit <span className="field-optional">Optional</span>
              <input value={values.perCustomerUsageLimit} onChange={(event) => set("perCustomerUsageLimit", event.target.value)} inputMode="numeric" placeholder="Unlimited" aria-invalid={Boolean(errors.perCustomerUsageLimit)} />
              <small className="field-help">Counted by the customer’s phone number.</small>
              {error("perCustomerUsageLimit")}
            </label>

            <label>
              Applies to
              <select value={values.appliesTo} onChange={(event) => set("appliesTo", event.target.value as CouponFormValues["appliesTo"])}>
                <option value="all">All products</option>
                <option value="category">One category</option>
                <option value="product">One product</option>
              </select>
            </label>
            {values.appliesTo === "category" ? (
              <label>
                Category
                <select value={values.categoryId} onChange={(event) => set("categoryId", event.target.value)} aria-invalid={Boolean(errors.categoryId)}>
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{parentName(category) ? `${parentName(category)} › ${category.name}` : category.name}</option>
                  ))}
                </select>
                <small className="field-help">Includes its sub-categories.</small>
                {error("categoryId")}
              </label>
            ) : null}
            {values.appliesTo === "product" ? (
              <label className="wide">
                Product
                <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search products" aria-label="Search products" />
                <select value={values.productId} onChange={(event) => set("productId", event.target.value)} aria-invalid={Boolean(errors.productId)}>
                  <option value="">{shownProducts.length ? "Choose a product" : "No matching products"}</option>
                  {shownProducts.map((product) => (
                    <option key={product.id} value={product.id}>{product.title}{product.publication_status === "draft" ? " (draft)" : ""}</option>
                  ))}
                </select>
                {error("productId")}
              </label>
            ) : null}

            <label className="coupon-active-toggle wide">
              <input type="checkbox" checked={values.isActive} onChange={(event) => set("isActive", event.target.checked)} />
              <span>
                <strong>Active</strong>
                <small>Inactive coupons are rejected at checkout.</small>
              </span>
            </label>
          </div>
          {saveError ? <p className="coupon-save-error" role="alert">{saveError}</p> : null}
          <footer>
            <button type="button" className="admin-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="admin-primary" disabled={saving}>{saving ? "Saving…" : isNew ? "Create coupon" : "Save changes"}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
