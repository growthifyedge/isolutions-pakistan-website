import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, ExternalLink, RotateCcw } from "lucide-react";
import { fetchPublicCatalog, primaryMedia } from "../lib/catalog";
import { cloudinaryDeliveryUrl } from "../lib/cloudinary";
import {
  OWNER_PDP_BACKGROUND_COLOR,
  PDP_BACKGROUND_PREVIEW_PARAM,
  PDP_BACKGROUND_PREVIEW_STORAGE_KEY,
  parsePdpGalleryBackground,
  pdpBackgroundStyle,
  samePdpBackground,
  validatePdpGalleryBackground,
  type PdpGalleryBackground,
} from "../lib/pdpGalleryBackground";
import { PdpBackgroundError, fetchPdpBackgroundAdmin, publishPdpBackground } from "../lib/pdpGalleryBackgroundDb";
import { supabaseEnvironmentLabel } from "../lib/supabase";

const CONFIRM = "PUBLISH PDP BACKGROUND";

/** The only setting the Admin edits: one solid colour (Owner decision 2026-11-21). */
const solidColour = (color: string | null): PdpGalleryBackground => ({ mode: "color", color, desktop: null, mobile: null });
const OWNER_DEFAULT = solidColour(OWNER_PDP_BACKGROUND_COLOR);

/** Any stored setting (older "default" / "image" values included) -> the solid-colour editor value. */
const asSolidColour = (value: PdpGalleryBackground | null) => (value?.color ? solidColour(value.color) : OWNER_DEFAULT);

function readBrowserPreview(): PdpGalleryBackground | null {
  try {
    const raw = window.localStorage.getItem(PDP_BACKGROUND_PREVIEW_STORAGE_KEY);
    return raw ? parsePdpGalleryBackground(JSON.parse(raw), { allowLocalPreview: true }) : null;
  } catch {
    return null;
  }
}

function writeBrowserPreview(value: PdpGalleryBackground) {
  try {
    window.localStorage.setItem(PDP_BACKGROUND_PREVIEW_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the inline preview still works; the full-page preview then shows the built-in look.
  }
}

/**
 * Global PDP Background (Admin → Media): one Solid Colour behind the main image on every product page (Owner decision
 * 2026-11-21: Solid Colour only, default #DCEAF9). Colour picker + hex, live preview, full-page browser-only preview,
 * Reset (back to #DCEAF9), Owner-only Publish. Product images are never changed.
 */
export function PdpBackgroundSetting() {
  const [value, setValue] = useState<PdpGalleryBackground>(() => asSolidColour(readBrowserPreview()));
  const [published, setPublished] = useState<PdpGalleryBackground | null>(null);
  // Why the setting can or cannot be saved here: the server's answer decides (never guessed from the hostname).
  const [access, setAccess] = useState<"checking" | "ok" | "not_installed" | "owner_required" | "failed">("checking");
  const installed = access === "ok";
  const [sample, setSample] = useState<{ slug: string; image: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let active = true;
    fetchPdpBackgroundAdmin()
      .then((state) => {
        if (!active) return;
        setAccess("ok");
        setPublished(state.published);
        if (!readBrowserPreview()) setValue(asSolidColour(state.draft ?? state.published));
      })
      .catch((error) => {
        if (!active) return;
        const code = error instanceof PdpBackgroundError ? error.code : "failed";
        setAccess(code === "not_installed" || code === "owner_required" ? code : "failed");
        if (code === "failed" || code === "invalid") setMessage(error instanceof Error ? error.message : "Could not load the setting.");
      });
    fetchPublicCatalog({ limit: 12 })
      .then((products) => {
        const product = products.find((item) => primaryMedia(item));
        const media = product ? primaryMedia(product) : null;
        if (active && product && media) setSample({ slug: product.slug, title: product.title, image: cloudinaryDeliveryUrl(media.publicId, 700) || media.url });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Browser-only preview: every change is visible at once in an open "Preview in this browser" tab (storage event).
  useEffect(() => writeBrowserPreview(value), [value]);

  const errors = validatePdpGalleryBackground(value);
  const style = useMemo(() => pdpBackgroundStyle(value, undefined), [value]);
  const unchanged = published !== null && samePdpBackground(value, published);
  const blocker = access === "checking"
    ? "Checking access…"
    : access === "owner_required"
      ? `Only the Owner account can publish. The signed-in account is not set as Owner on ${supabaseEnvironmentLabel} (server check), so nothing can be saved from it.`
      : access === "not_installed"
        ? "Publishing is not available yet: the database update (migration 202611200001) is not applied on this database."
        : access === "failed"
          ? "The setting could not be loaded; publishing is disabled."
          : errors.length
      ? errors[0]
      : unchanged
        ? "This is already the published setting."
        : typed.trim() !== CONFIRM
          ? `Type ${CONFIRM} to confirm.`
          : null;

  const setColour = (color: string | null) => setValue(solidColour(color));

  function resetToDefault() {
    setValue(OWNER_DEFAULT);
    setTyped("");
    setMessage(
      installed
        ? `Reset to Default (${OWNER_PDP_BACKGROUND_COLOR}) in the editor. Publish to apply it to the live product pages.`
        : `Reset to Default (${OWNER_PDP_BACKGROUND_COLOR}) in this browser's preview; nothing was saved.`,
    );
  }

  async function publish() {
    if (blocker || busy) return;
    setBusy(true);
    try {
      await publishPdpBackground(value);
      setPublished(value);
      setTyped("");
      setMessage("Published: every product page now uses this background colour.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Publish failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const previewHref = sample ? `/product/${sample.slug}?${PDP_BACKGROUND_PREVIEW_PARAM}=1` : null;
  const frame = (kind: "desktop" | "mobile") => (
    <figure className={`pdp-bg-frame is-${kind}`}>
      <div className={`pdp-bg-frame-box${style ? " has-global-background" : ""}`} style={(style ?? undefined) as CSSProperties | undefined}>
        {sample ? <img src={sample.image} alt="" /> : <span>Product image</span>}
      </div>
      <figcaption>{kind === "desktop" ? "Desktop" : "Mobile"}</figcaption>
    </figure>
  );

  return (
    <section className="admin-panel pdp-bg-setting" aria-labelledby="pdp-bg-title">
      <div className="pdp-bg-head">
        <div>
          <span className="admin-kicker">PRODUCT PAGES · GALLERY BACKGROUND · OWNER ONLY</span>
          <h2 id="pdp-bg-title">Global PDP background</h2>
          <p>
            One solid colour behind the main image on every product page. Product images are never cropped, stretched or
            changed; thumbnails, zoom and colour selection stay the same.{" "}
            {access === "not_installed" && <strong>Preview mode: nothing is saved to the database.</strong>}
            {access === "owner_required" && <strong>Read-only: this account is not the Owner on {supabaseEnvironmentLabel}.</strong>}
          </p>
        </div>
        <button type="button" className="admin-secondary" onClick={resetToDefault} disabled={busy}>
          <RotateCcw /> Reset to Default
        </button>
      </div>

      <div className="pdp-bg-grid">
        <div className="pdp-bg-controls">
          <label className="pdp-bg-field">
            Solid colour
            <span className="pdp-bg-color">
              <input type="color" value={value.color ?? OWNER_PDP_BACKGROUND_COLOR} onChange={(event) => setColour(event.target.value.toUpperCase())} disabled={busy} aria-label="Colour picker" />
              <input
                value={value.color ?? ""}
                placeholder={OWNER_PDP_BACKGROUND_COLOR}
                maxLength={7}
                onChange={(event) => setColour(event.target.value.trim() ? event.target.value.trim().toUpperCase() : null)}
                disabled={busy}
                aria-label="Hex colour"
              />
            </span>
            <small className="pdp-bg-hint">Default: {OWNER_PDP_BACKGROUND_COLOR} (Owner-selected).</small>
          </label>

          {errors.length > 0 && <p className="pdp-bg-warning">{errors[0]}</p>}

          <div className="pdp-bg-publish">
            {previewHref && (
              <a className="admin-secondary" href={previewHref} target="_blank" rel="noreferrer">
                <ExternalLink /> Preview in this browser
              </a>
            )}
            <label className="pdp-bg-field">
              Type <code>{CONFIRM}</code> · {supabaseEnvironmentLabel}
              <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" disabled={busy || !installed} />
            </label>
            <button type="button" className="admin-primary" onClick={() => void publish()} disabled={Boolean(blocker) || busy}>
              <CheckCircle2 /> Publish to all product pages
            </button>
            {blocker && <p className="pdp-bg-hint">{blocker}</p>}
            {message && <p className="admin-inline-message" role="status">{message}</p>}
          </div>
        </div>

        <div className="pdp-bg-preview" aria-label="Live preview">
          <span className="pdp-bg-preview-title">Live preview{sample ? ` · ${sample.title}` : ""}</span>
          <div className="pdp-bg-frames">
            {frame("desktop")}
            {frame("mobile")}
          </div>
        </div>
      </div>
    </section>
  );
}
