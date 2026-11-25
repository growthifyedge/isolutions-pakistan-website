import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { History, RefreshCw, RotateCcw, Save, Send } from "lucide-react";
import { validateSourceImage } from "../lib/cloudinary";
import { localPreviewSrc, newLocalPreviewKey } from "../lib/bannerPreviewStore";
import { isLocalPreviewSrc } from "../lib/homepageBanners";
import { BannerEditorError, uploadBannerImage } from "../lib/homepageBannersDb";
import {
  BUILT_IN_BUNDLE_PROMO_IMAGE,
  BUILT_IN_BUNDLE_TILES,
  BUNDLE_PROMO_RECOMMENDED,
  BUNDLE_TILE_RECOMMENDED,
  bundleOfferImageUrl,
  defaultBundleOffers,
  normalizeBundleOffers,
  resolveBundleOffers,
  sameBundleOffers,
  validateBundleOffers,
  type BundleOfferImage,
  type BundleOffersContent,
} from "../lib/bundleOffers";
import {
  BundleOffersError,
  fetchBundleOffersAdmin,
  publishBundleOffers,
  restoreBundleOffersVersion,
  saveBundleOffersDraft,
  type BundleOffersAdminState,
} from "../lib/bundleOffersDb";
import { BannerImageSlot, formatTime } from "./BannerManager";

type Mode = "loading" | "ready" | "preview-only" | "denied" | "error";
type Slot = { kind: "tile"; index: number } | { kind: "promo" };

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const EMPTY_STATE: BundleOffersAdminState = { draft: null, published: null, history: [] };
const tileHint = `${BUNDLE_TILE_RECOMMENDED.width} × ${BUNDLE_TILE_RECOMMENDED.height} px recommended (4:3) · JPG, PNG, WebP or AVIF`;
const promoHint = `${BUNDLE_PROMO_RECOMMENDED.width} × ${BUNDLE_PROMO_RECOMMENDED.height} px recommended (about 1.1 : 1) · JPG, PNG, WebP or AVIF`;

/**
 * Website Editor — Homepage Bundle Offers: replace the four bundle tile images and the large promotional banner, edit
 * their links; Save Draft / Publish / Restore. Owner only (database RPCs + upload Edge Function). Layout unchanged.
 */
export function BundleOffersEditor() {
  const [mode, setMode] = useState<Mode>("loading");
  const [state, setState] = useState<BundleOffersAdminState>(EMPTY_STATE);
  const [content, setContent] = useState<BundleOffersContent>(defaultBundleOffers);
  const [localUrls, setLocalUrls] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const baseline = state.draft?.content ?? state.published?.content ?? defaultBundleOffers();
  const dirty = (mode === "ready" || mode === "preview-only") && !sameBundleOffers(normalizeBundleOffers(content), baseline);
  const errors = useMemo(() => validateBundleOffers(normalizeBundleOffers(content), { allowLocalPreview: mode === "preview-only" }), [content, mode]);
  const hasLocalImages = [...content.tiles.map((tile) => tile.image), content.promo.image].some((image) => image && isLocalPreviewSrc(image.src));
  const resolved = resolveBundleOffers(content, CLOUD_NAME, localUrls);

  async function load() {
    try {
      const next = await fetchBundleOffersAdmin();
      setState(next);
      setContent(next.draft?.content ?? next.published?.content ?? defaultBundleOffers());
      setMode("ready");
    } catch (error) {
      if (error instanceof BundleOffersError && error.code === "not_installed") {
        setMode("preview-only");
        return;
      }
      if (error instanceof BundleOffersError && error.code === "owner_required") {
        setMode("denied");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not load bundle offers.");
      setMode("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const setImage = (slot: Slot, image: BundleOfferImage | null) =>
    setContent((current) =>
      slot.kind === "promo"
        ? { ...current, promo: { ...current.promo, image } }
        : { ...current, tiles: current.tiles.map((tile, index) => (index === slot.index ? { ...tile, image } : tile)) },
    );
  const setTileLink = (index: number, link: string) =>
    setContent((current) => ({ ...current, tiles: current.tiles.map((tile, position) => (position === index ? { ...tile, link } : tile)) }));

  async function chooseImage(slot: Slot, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = await validateSourceImage(file);
    if (problem) {
      setMessage(problem);
      return;
    }
    if (mode === "preview-only") {
      // Not uploaded: shown in this editor only, because saving is unavailable until the migration is applied.
      const key = newLocalPreviewKey();
      setLocalUrls((current) => new Map(current).set(key, URL.createObjectURL(file)));
      setImage(slot, { src: localPreviewSrc(key), publicId: null });
      setMessage("Local preview only — this image is shown in this editor and is not uploaded. Upload works after the database update is applied.");
      return;
    }
    setBusy("Uploading image…");
    setMessage("");
    try {
      // Same signed Cloudinary siteAsset upload as the Homepage Banner editor (no separate upload code).
      setImage(slot, await uploadBannerImage(file));
      setMessage("Image uploaded. Save Draft to keep it.");
    } catch (error) {
      setMessage(error instanceof BannerEditorError || error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function refresh(fallback: BundleOffersContent) {
    const next = await fetchBundleOffersAdmin();
    setState(next);
    setContent(next.draft?.content ?? next.published?.content ?? fallback);
  }

  async function saveDraft() {
    if (errors.length) {
      setMessage("Fix the problems listed before saving.");
      return false;
    }
    const normalized = normalizeBundleOffers(content);
    setBusy("Saving draft…");
    try {
      await saveBundleOffersDraft(normalized);
      await refresh(normalized);
      setMessage("Draft saved. The live website is unchanged until you Publish.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!confirm("Publish these bundle offers to the live homepage now?")) return;
    if (dirty || !state.draft) {
      if (!(await saveDraft())) return;
    }
    setBusy("Publishing…");
    try {
      await publishBundleOffers();
      await refresh(content);
      setMessage("Published. The homepage Bundle Offers section now shows these images and links.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setBusy("");
    }
  }

  async function restoreVersion(versionId: string, publishedAt: string | null) {
    if (dirty && !confirm("Unsaved changes will be replaced. Continue?")) return;
    if (!confirm(`Copy the version published ${formatTime(publishedAt)} into the draft? It goes live only after Publish.`)) return;
    setBusy("Restoring…");
    try {
      await restoreBundleOffersVersion(versionId);
      await refresh(content);
      setMessage("Version restored into the draft. Review it, then Publish.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setBusy("");
    }
  }

  if (mode === "loading") return <div className="admin-auth-state">Checking Owner access…</div>;
  if (mode === "denied")
    return (
      <div className="future-screen">
        <span className="admin-kicker">WEBSITE EDITOR</span>
        <h1>Owner only</h1>
        <p>Bundle offers can be edited by the Owner account only.</p>
      </div>
    );
  if (mode === "error")
    return (
      <div className="future-screen">
        <span className="admin-kicker">WEBSITE EDITOR</span>
        <h1>Bundle offers unavailable</h1>
        <p>{message}</p>
        <button className="admin-secondary" onClick={() => void load()}><RefreshCw /> Try again</button>
      </div>
    );

  const writable = mode === "ready" && !busy;
  /** Thumbnail: the custom image (Cloudinary resize / local preview) or the built-in artwork. */
  const shown = (image: BundleOfferImage | null, builtIn: string, width: number) =>
    ({ src: bundleOfferImageUrl(image, width, CLOUD_NAME, localUrls) ?? builtIn, publicId: image?.publicId ?? null });

  return (
    <div className="banner-manager bundle-offers-editor">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">WEBSITE EDITOR · OWNER ONLY</span>
          <h1>Bundle Offers</h1>
          <p>
            Replace the images and links of the homepage Bundle Offers section: four bundle tiles and the large promotional
            banner. Changes stay in a draft until you Publish. Layout, sizes and mobile behaviour are unchanged.
          </p>
        </div>
      </div>

      {mode === "preview-only" && (
        <p className="banner-notice" role="status">
          <strong>Preview-only mode.</strong> The Bundle Offers database update (migration 202611250002) is not applied on
          this database, so Save Draft, Publish, Restore and uploads are disabled. You can still choose images and edit links
          and see them in the preview — nothing is stored or uploaded.
        </p>
      )}

      <section className="admin-panel banner-status" aria-label="Version status">
        <div>
          <span>Live website</span>
          <strong>{state.published ? `Published ${formatTime(state.published.publishedAt)}` : "Built-in bundle offers (nothing published yet)"}</strong>
        </div>
        <div>
          <span>Draft</span>
          <strong>{state.draft ? `Saved ${formatTime(state.draft.updatedAt)}` : "No saved draft"}</strong>
        </div>
        <div>
          <span>Editor</span>
          <strong className={dirty ? "is-dirty" : ""}>{dirty ? "Unsaved changes" : "No unsaved changes"}</strong>
        </div>
        <div className="banner-toolbar">
          <button className="admin-secondary" onClick={() => void saveDraft()} disabled={!writable || !!errors.length || hasLocalImages}>
            <Save /> Save Draft
          </button>
          <button className="admin-primary" onClick={() => void publish()} disabled={!writable || !!errors.length || hasLocalImages || (!dirty && !state.draft)}>
            <Send /> Publish
          </button>
          <button className="admin-secondary" onClick={() => { if (confirm("Discard unsaved changes?")) setContent(baseline); }} disabled={!dirty || !!busy}>
            <RotateCcw /> Discard changes
          </button>
          <button className="admin-secondary" onClick={() => { if (confirm("Load the original built-in images and links into the editor? Nothing is saved until Save Draft.")) setContent(defaultBundleOffers()); }} disabled={!!busy}>
            <History /> Load built-in
          </button>
        </div>
      </section>

      {busy && <p className="admin-inline-message" role="status">{busy}</p>}
      {message && !busy && <p className="admin-inline-message" role="status">{message}</p>}
      {errors.length > 0 && (
        <ul className="banner-errors" aria-label="Problems to fix">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}

      <div className="banner-layout">
        <section className="banner-list" aria-label="Bundle offer images and links">
          {content.tiles.map((tile, index) => (
            <article className="admin-panel banner-card" key={BUILT_IN_BUNDLE_TILES[index].href}>
              <div className="banner-card-head">
                <strong>Tile {index + 1} · {BUILT_IN_BUNDLE_TILES[index].title}</strong>
                <span className={`state ${tile.image ? "published" : "draft"}`}>{tile.image ? "Custom image" : "Built-in image"}</span>
              </div>
              <div className="banner-images bundle-offer-images">
                <BannerImageSlot
                  label="Tile image"
                  hint={tileHint}
                  image={shown(tile.image, BUILT_IN_BUNDLE_TILES[index].image, 600)}
                  disabled={!!busy}
                  onChoose={(event) => void chooseImage({ kind: "tile", index }, event)}
                  onRemove={tile.image ? () => setImage({ kind: "tile", index }, null) : undefined}
                />
              </div>
              <div className="form-grid banner-fields">
                <label className="wide">
                  Destination link * <small>internal page, e.g. {BUILT_IN_BUNDLE_TILES[index].href}</small>
                  <input value={tile.link} maxLength={200} onChange={(event) => setTileLink(index, event.target.value)} placeholder={BUILT_IN_BUNDLE_TILES[index].href} />
                </label>
              </div>
            </article>
          ))}

          <article className="admin-panel banner-card">
            <div className="banner-card-head">
              <strong>Large promotional banner</strong>
              <span className={`state ${content.promo.image ? "published" : "draft"}`}>{content.promo.image ? "Custom image" : "Built-in image"}</span>
            </div>
            <div className="banner-images bundle-offer-images">
              <BannerImageSlot
                label="Banner image"
                hint={promoHint}
                image={shown(content.promo.image, BUILT_IN_BUNDLE_PROMO_IMAGE, 800)}
                disabled={!!busy}
                onChoose={(event) => void chooseImage({ kind: "promo" }, event)}
                onRemove={content.promo.image ? () => setImage({ kind: "promo" }, null) : undefined}
              />
            </div>
            <div className="form-grid banner-fields">
              <label className="wide">
                Destination link <small>optional · internal page, e.g. /collections/bundle-offers · empty = not clickable (as today)</small>
                <input
                  value={content.promo.link ?? ""}
                  maxLength={200}
                  onChange={(event) => setContent((current) => ({ ...current, promo: { ...current.promo, link: event.target.value } }))}
                  placeholder="/collections/bundle-offers"
                />
              </label>
            </div>
          </article>

          {mode === "ready" && (
            <section className="admin-panel banner-history" aria-label="Published versions">
              <h2><History /> Restore a published version</h2>
              {state.history.length ? (
                state.history.map((version) => (
                  <div key={version.id}>
                    <span>{formatTime(version.publishedAt)}{version.status === "published" ? " · live now" : ""}</span>
                    <button className="admin-secondary" onClick={() => void restoreVersion(version.id, version.publishedAt)} disabled={!!busy}>
                      <RotateCcw /> Restore to draft
                    </button>
                  </div>
                ))
              ) : (
                <p>Nothing has been published yet. The live homepage shows the built-in bundle offers.</p>
              )}
            </section>
          )}
        </section>

        <section className="admin-panel banner-preview" aria-label="Bundle Offers preview">
          <div className="banner-preview-head"><h2>Preview</h2></div>
          <p>Same arrangement and proportions as the homepage section (desktop). Links open in this tab.</p>
          <div className="bundle-offers-preview">
            <div className="bundle-offers-preview-grid">
              {resolved.tiles.map((tile) => (
                <a href={tile.href} key={tile.title} title={tile.href}><img src={tile.image} alt={tile.title} /></a>
              ))}
            </div>
            {resolved.promo.href ? (
              <a className="bundle-offers-preview-promo" href={resolved.promo.href} title={resolved.promo.href}>
                <img src={resolved.promo.image ?? BUILT_IN_BUNDLE_PROMO_IMAGE} alt="Bundle Offers promotional banner" />
              </a>
            ) : (
              <div className="bundle-offers-preview-promo">
                <img src={resolved.promo.image ?? BUILT_IN_BUNDLE_PROMO_IMAGE} alt="Bundle Offers promotional banner" />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
