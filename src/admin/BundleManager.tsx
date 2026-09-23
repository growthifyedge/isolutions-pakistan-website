import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, RefreshCw, Trash2, UploadCloud, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchPublicCatalog, formatPkrMinor, productPrice } from "../lib/catalog";
import { validateSourceImage } from "../lib/cloudinary";

type UploadSignature = {
  cloudName: string;
  apiKey: string;
  signature: string;
  signedParameters: Record<string, string | number>;
};

type ProductOption = {
  id: string;
  title: string;
  brand: string;
  priceMinor: number | null;
};
type BundleItemDraft = { product_id: string; quantity: number };
type BundleRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  bundle_price_minor: number;
  is_active: boolean;
  is_featured: boolean;
  bundle_image_url: string | null;
  bundle_image_public_id: string | null;
  bundle_items: BundleItemDraft[];
};

const emptyDraft = {
  id: "",
  title: "",
  slug: "",
  description: "",
  price: "",
  is_active: false,
  is_featured: false,
  bundle_image_url: null as string | null,
  bundle_image_public_id: null as string | null,
  items: [] as BundleItemDraft[],
};

export function BundleManager() {
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);

  async function load() {
    if (!supabase) return;
    const [bundleResult, productResult] = await Promise.allSettled([
      supabase
        .from("bundles")
        .select("id,title,slug,description,bundle_price_minor,is_active,is_featured,bundle_image_url,bundle_image_public_id,bundle_items(product_id,quantity)")
        .order("updated_at", { ascending: false }),
      fetchPublicCatalog({ limit: 100 }),
    ]);
    const errors: string[] = [];
    if (bundleResult.status === "fulfilled" && !bundleResult.value.error) {
      setBundles((bundleResult.value.data ?? []) as BundleRow[]);
    } else {
      errors.push(bundleResult.status === "rejected" ? String(bundleResult.reason) : bundleResult.value.error?.message ?? "Unable to load bundles.");
    }
    if (productResult.status === "fulfilled") {
      setProducts(productResult.value.map((product) => ({
        id: product.id,
        title: product.title,
        brand: product.brand?.name ?? "No brand",
        priceMinor: productPrice(product),
      })));
    } else {
      errors.push("Unable to load published catalog products.");
    }
    setMessage(errors.join(" "));
  }

  useEffect(() => {
    void load();
  }, []);

  function startCreate() {
    setDraft(emptyDraft);
    clearPendingImage();
    setMessage("");
    setEditing(true);
  }

  function startEdit(bundle: BundleRow) {
    setDraft({
      id: bundle.id,
      title: bundle.title,
      slug: bundle.slug,
      description: bundle.description ?? "",
      price: (bundle.bundle_price_minor / 100).toString(),
      is_active: bundle.is_active,
      is_featured: bundle.is_featured,
      bundle_image_url: bundle.bundle_image_url,
      bundle_image_public_id: bundle.bundle_image_public_id,
      items: bundle.bundle_items.map((item) => ({ ...item })),
    });
    clearPendingImage();
    setMessage("");
    setEditing(true);
  }

  function toggleProduct(productId: string) {
    const exists = draft.items.some((item) => item.product_id === productId);
    setDraft({
      ...draft,
      items: exists
        ? draft.items.filter((item) => item.product_id !== productId)
        : [...draft.items, { product_id: productId, quantity: 1 }],
    });
  }

  function clearPendingImage() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingImage(null);
    setPendingPreview("");
    if (imageInput.current) imageInput.current.value = "";
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = await validateSourceImage(file);
    if (validation) {
      setMessage(validation);
      event.target.value = "";
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingImage(file);
    setPendingPreview(URL.createObjectURL(file));
    setMessage("");
  }

  async function uploadBundleImage(bundleId: string, file: File, hasExistingImage: boolean) {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.functions.invoke<UploadSignature>("cloudinary-upload-signature", { body: { bundleId } });
    if (error || !data) throw new Error(error?.message ?? "Upload authorization failed.");
    const form = new FormData();
    form.set("file", file);
    form.set("api_key", data.apiKey);
    form.set("signature", data.signature);
    for (const [key, value] of Object.entries(data.signedParameters)) form.set(key, String(value));
    const response = await fetch(`https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`, { method: "POST", body: form });
    const result = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    if (!response.ok || !result.secure_url || !result.public_id) throw new Error(result.error?.message ?? "Cloudinary upload failed.");
    if (hasExistingImage) {
      const { error: deleteError } = await supabase.functions.invoke("cloudinary-delete-media", { body: { bundleId } });
      if (deleteError) throw new Error("The new image uploaded, but the previous bundle image could not be removed.");
    }
    const { error: updateError } = await supabase.from("bundles").update({
      bundle_image_url: result.secure_url,
      bundle_image_public_id: result.public_id,
    }).eq("id", bundleId);
    if (updateError) throw updateError;
  }

  async function removeBundleImage() {
    if (!supabase || !draft.id || !draft.bundle_image_public_id || !confirm("Remove this bundle image? Product-image composition will be used instead.")) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("cloudinary-delete-media", { body: { bundleId: draft.id } });
    if (error) setMessage(error.message);
    else {
      setDraft({ ...draft, bundle_image_url: null, bundle_image_public_id: null });
      setMessage("Bundle image removed.");
      await load();
    }
    setBusy(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    const title = draft.title.trim();
    const slug = draft.slug.trim().toLowerCase();
    const priceMinor = Math.round(Number(draft.price) * 100);
    if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setMessage("Enter a title and a lowercase URL slug.");
      return;
    }
    if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) {
      setMessage("Enter a valid bundle price.");
      return;
    }
    if (draft.items.length < 2) {
      setMessage("Select at least two products.");
      return;
    }
    setBusy(true);
    setMessage("");
    const payload = {
      title,
      slug,
      description: draft.description.trim() || null,
      bundle_price_minor: priceMinor,
      is_active: draft.is_active,
      is_featured: draft.is_featured,
    };
    const bundleResult = draft.id
      ? await supabase.from("bundles").update(payload).eq("id", draft.id).select("id").single()
      : await supabase.from("bundles").insert(payload).select("id").single();
    if (bundleResult.error) {
      setMessage(bundleResult.error.message);
      setBusy(false);
      return;
    }
    const bundleId = bundleResult.data.id;
    if (draft.id) {
      const { error } = await supabase.from("bundle_items").delete().eq("bundle_id", bundleId);
      if (error) {
        setMessage(error.message);
        setBusy(false);
        return;
      }
    }
    const { error: itemError } = await supabase.from("bundle_items").insert(
      draft.items.map((item, index) => ({
        bundle_id: bundleId,
        product_id: item.product_id,
        quantity: item.quantity,
        sort_order: index,
      })),
    );
    if (itemError) {
      setMessage(itemError.message);
      setBusy(false);
      return;
    }
    if (pendingImage) {
      try {
        await uploadBundleImage(bundleId, pendingImage, Boolean(draft.bundle_image_public_id));
      } catch (error) {
        setDraft({ ...draft, id: bundleId });
        setMessage(error instanceof Error ? error.message : "Bundle image upload failed.");
        setBusy(false);
        return;
      }
    }
    setEditing(false);
    setDraft(emptyDraft);
    clearPendingImage();
    setMessage("Bundle saved.");
    await load();
    setBusy(false);
  }

  async function remove(bundle: BundleRow) {
    if (!supabase || !confirm(`Delete “${bundle.title}”? This cannot be undone.`)) return;
    const { error } = await supabase.from("bundles").delete().eq("id", bundle.id);
    setMessage(error?.message ?? "Bundle deleted.");
    if (!error) await load();
  }

  return (
    <div className="bundle-manager">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">HOMEPAGE MERCHANDISING</span>
          <h1>Bundle Offers</h1>
          <p>Create offers from existing catalog products without duplicating product records.</p>
        </div>
        <button className="admin-primary" onClick={startCreate}><Plus /> New bundle</button>
      </div>
      {message && <p className="admin-inline-message" role="status">{message}</p>}
      <section className="admin-panel bundle-list">
        {bundles.length ? bundles.map((bundle) => (
          <article key={bundle.id}>
            <div>
              <strong>{bundle.title}</strong>
              <span>{bundle.bundle_items.length} products · Rs. {(bundle.bundle_price_minor / 100).toLocaleString("en-PK")}</span>
            </div>
            <span className={`state ${bundle.is_active ? "published" : "draft"}`}>{bundle.is_active ? "Active" : "Inactive"}</span>
            <span className={`state ${bundle.is_featured ? "published" : "draft"}`}>{bundle.is_featured ? "Homepage" : "Hidden"}</span>
            <button aria-label={`Edit ${bundle.title}`} onClick={() => startEdit(bundle)}><Pencil /></button>
            <button aria-label={`Delete ${bundle.title}`} onClick={() => void remove(bundle)}><Trash2 /></button>
          </article>
        )) : <p className="bundle-empty">No bundles have been created.</p>}
      </section>

      {editing && (
        <section className="admin-panel bundle-editor" aria-label="Bundle editor">
          <div className="panel-title">
            <div><span className="admin-kicker">{draft.id ? "EDIT BUNDLE" : "NEW BUNDLE"}</span><h2>Bundle details</h2></div>
            <button aria-label="Close bundle editor" onClick={() => setEditing(false)}><X /></button>
          </div>
          <form onSubmit={save}>
            <div className="form-grid">
              <label>Bundle title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
              <label>Slug<input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="phone-essentials" required /></label>
              <label className="wide">Description<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              <label>Bundle price (PKR)<input type="number" min="0.01" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} required /></label>
              <div className="bundle-switches">
                <label className="admin-checkbox"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /><span>Active</span></label>
                <label className="admin-checkbox"><input type="checkbox" checked={draft.is_featured} onChange={(e) => setDraft({ ...draft, is_featured: e.target.checked })} /><span>Show on homepage</span></label>
              </div>
            </div>
            <section className="bundle-image-editor" aria-labelledby="bundle-image-title">
              <div>
                <h3 id="bundle-image-title">Bundle Image</h3>
                <p>Optional. Upload a professionally designed image for this bundle. If no image is uploaded, product images will be composed automatically.</p>
                <small>PNG, JPG, WebP or AVIF · square or near-square artwork with safe margins works best.</small>
              </div>
              <div className="bundle-image-preview">
                {pendingPreview || draft.bundle_image_url ? <img src={pendingPreview || draft.bundle_image_url || ""} alt={`${draft.title || "Bundle"} preview`} /> : <span><ImagePlus /><small>Automatic composition</small></span>}
              </div>
              <div className="bundle-image-actions">
                <button type="button" onClick={() => imageInput.current?.click()} disabled={busy} className="admin-secondary">
                  {pendingPreview || draft.bundle_image_url ? <RefreshCw /> : <UploadCloud />}
                  {pendingPreview || draft.bundle_image_url ? "Replace image" : "Upload image"}
                </button>
                {pendingPreview && <button type="button" onClick={clearPendingImage} disabled={busy}>Remove selected</button>}
                {!pendingPreview && draft.bundle_image_url && <button type="button" className="danger" onClick={() => void removeBundleImage()} disabled={busy}><Trash2 /> Remove image</button>}
                <input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void chooseImage(event)} />
              </div>
            </section>
            <fieldset className="bundle-products">
              <legend>Products <small>Select at least two</small></legend>
              {products.map((product) => {
                const item = draft.items.find((entry) => entry.product_id === product.id);
                return <div key={product.id}>
                  <label><input type="checkbox" checked={Boolean(item)} onChange={() => toggleProduct(product.id)} /><span>{product.title}<small>{product.brand}{product.priceMinor !== null ? ` · ${formatPkrMinor(product.priceMinor)}` : ""}</small></span></label>
                  {item && <label>Qty<input aria-label={`${product.title} quantity`} type="number" min="1" step="1" value={item.quantity} onChange={(e) => setDraft({ ...draft, items: draft.items.map((entry) => entry.product_id === product.id ? { ...entry, quantity: Math.max(1, Number(e.target.value) || 1) } : entry) })} /></label>}
                </div>;
              })}
            </fieldset>
            <button className="admin-primary" disabled={busy}>{busy ? "Saving…" : "Save bundle"}</button>
          </form>
        </section>
      )}
    </div>
  );
}
