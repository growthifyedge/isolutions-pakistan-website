import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { CheckCircle2, ExternalLink, ImagePlus, RefreshCw, Trash2, X } from "lucide-react";
import { loadPreviewImageUrls, localPreviewSrc, newLocalPreviewKey, putPreviewImage } from "../lib/bannerPreviewStore";
import {
  EMPTY_PROMO_POPUP,
  PROMO_POPUP_IMAGE_TYPES,
  PROMO_POPUP_PREVIEW_PARAM,
  PROMO_POPUP_PREVIEW_STORAGE_KEY,
  PROMO_POPUP_SESSION_KEY,
  parsePromoPopup,
  promoPopupFileProblem,
  promoPopupImageUrl,
  promoPopupPreviewKey,
  samePromoPopup,
  toInternalPath,
  validatePromoPopup,
  type PromoPopup,
} from "../lib/promoPopup";
import { PromoPopupError, fetchPromoPopupAdmin, savePromoPopup, uploadPromoPopupImage } from "../lib/promoPopupDb";
import { supabaseEnvironmentLabel } from "../lib/supabase";
import "../promoPopup.css";
import "./promoPopupAdmin.css";

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
/** Typed confirmation only where it matters: saving on the live (Production) website. */
const CONFIRM = "SAVE POPUP";
const needsTypedConfirmation = supabaseEnvironmentLabel === "Production";
/**
 * The storefront sizes (promoPopup.css) scaled into the preview frames: the desktop frame stands for a 1440 px wide
 * screen (popup up to 900 px, 92% side limit, 48 px height margin), the mobile frame for a 375 px phone (94% width).
 */
const FRAME_SIZES = {
  // Heights leave room for the 22 px control strip above the image (promoPopup.css, .is-frame).
  desktop: { "--promo-target": "253px", "--promo-side": "92%", "--promo-max-h": "208px" },
  mobile: { "--promo-target": "94%", "--promo-side": "94%", "--promo-max-h": "307px" },
} as const;

function readBrowserPreview(): PromoPopup | null {
  try {
    const raw = window.localStorage.getItem(PROMO_POPUP_PREVIEW_STORAGE_KEY);
    return raw ? parsePromoPopup(JSON.parse(raw), { allowLocalPreview: true }) : null;
  } catch {
    return null;
  }
}

function writeBrowserPreview(value: PromoPopup) {
  try {
    window.localStorage.setItem(PROMO_POPUP_PREVIEW_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the previews on this page still work; the homepage preview then shows nothing.
  }
}

/**
 * Promotional Popup (Admin Studio → Marketing). One image + one internal destination link + ON/OFF, desktop and mobile
 * preview, Owner-only Save (saves and publishes; OFF hides the popup). Prices, stock, checkout and banners untouched.
 */
export function PromoPopupSetting() {
  const [value, setValue] = useState<PromoPopup>(() => readBrowserPreview() ?? EMPTY_PROMO_POPUP);
  const [linkText, setLinkText] = useState(() => value.link ?? "");
  const [published, setPublished] = useState<PromoPopup | null>(null);
  const [access, setAccess] = useState<"checking" | "ok" | "not_installed" | "owner_required" | "failed">("checking");
  const [localUrls, setLocalUrls] = useState<Map<string, string>>(new Map());
  const [ratio, setRatio] = useState(1);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [typed, setTyped] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const installed = access === "ok";

  useEffect(() => {
    let active = true;
    fetchPromoPopupAdmin()
      .then((state) => {
        if (!active) return;
        setAccess("ok");
        setPublished(state.published);
        // When saving is available the saved setting is the starting point (a browser-only preview from earlier is
        // replaced, so the page never shows something different from what is saved).
        const stored = state.draft ?? state.published ?? EMPTY_PROMO_POPUP;
        setValue(stored);
        setLinkText(stored.link ?? "");
      })
      .catch((error) => {
        if (!active) return;
        const code = error instanceof PromoPopupError ? error.code : "failed";
        setAccess(code === "not_installed" || code === "owner_required" ? code : "failed");
        if (code === "failed" || code === "invalid") setMessage(error instanceof Error ? error.message : "Could not load the setting.");
      });
    return () => {
      active = false;
    };
  }, []);

  // Unsaved setting -> this browser only, for "Preview on homepage" (never sent to the database).
  useEffect(() => writeBrowserPreview(value), [value]);

  // Object URL for a browser-only preview image (IndexedDB).
  const previewKey = promoPopupPreviewKey(value);
  useEffect(() => {
    if (!previewKey || localUrls.has(previewKey)) return;
    let active = true;
    void loadPreviewImageUrls([previewKey]).then((urls) => active && setLocalUrls((current) => new Map([...current, ...urls])));
    return () => {
      active = false;
    };
  }, [previewKey, localUrls]);

  const errors = validatePromoPopup(value, { allowLocalPreview: true });
  const usesLocalImage = Boolean(previewKey);
  const unchanged = published !== null ? samePromoPopup(value, published) : samePromoPopup(value, EMPTY_PROMO_POPUP);
  const blocker = access === "checking"
    ? "Checking access…"
    : access === "owner_required"
      ? `Only the Owner account can save. The signed-in account is not set as Owner on ${supabaseEnvironmentLabel} (server check).`
      : access === "not_installed"
        ? "Saving is not available yet: the database update (migration 202611230001) is not applied on this database. You can still try everything here and preview it in this browser."
        : access === "failed"
          ? "The setting could not be loaded; saving is disabled."
          : errors.length
            ? errors[0]
            : usesLocalImage
              ? "This image is a browser-only preview. Upload it again (image upload must be available) before saving."
              : unchanged
                ? "This is already the saved setting."
                : needsTypedConfirmation && typed.trim() !== CONFIRM
                  ? `Type ${CONFIRM} to confirm.`
                  : null;

  const imageUrl = value.image ? promoPopupImageUrl(value.image, 1080, CLOUDINARY_CLOUD_NAME, localUrls) : null;

  async function keepInBrowser(file: File, reason: string) {
    const key = newLocalPreviewKey();
    await putPreviewImage(key, file);
    setLocalUrls((current) => new Map(current).set(key, URL.createObjectURL(file)));
    setValue((current) => ({ ...current, image: { src: localPreviewSrc(key), publicId: null } }));
    setMessage(`${reason} The image is kept in this browser for preview only; it is not uploaded or saved.`);
  }

  async function onChoose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = promoPopupFileProblem(file);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy("Uploading image…");
    try {
      if (!installed) {
        await keepInBrowser(file, "Saving is not available on this database yet.");
        return;
      }
      try {
        const image = await uploadPromoPopupImage(file);
        setValue((current) => ({ ...current, image }));
        setMessage("Image uploaded. Save to apply it.");
      } catch (error) {
        if (error instanceof PromoPopupError && error.code === "upload_unavailable") await keepInBrowser(file, error.message);
        else throw error;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed. Nothing was changed.");
    } finally {
      setBusy("");
    }
  }

  function applyLink(text: string) {
    setLinkText(text);
    const path = toInternalPath(text);
    setValue((current) => ({ ...current, link: path ? path : null }));
  }

  async function save() {
    if (blocker || busy) return;
    setBusy("Saving…");
    try {
      await savePromoPopup(value);
      setPublished(value);
      setTyped("");
      setMessage(value.enabled ? "Saved: the popup is ON. New visitors see it on the homepage after 3 seconds." : "Saved: the popup is OFF and hidden from the homepage.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed. Nothing was changed.");
    } finally {
      setBusy("");
    }
  }

  function resetSessionForPreview() {
    try {
      window.sessionStorage.removeItem(PROMO_POPUP_SESSION_KEY);
    } catch {
      // ignore
    }
  }

  const frame = (kind: "desktop" | "mobile") => (
    <figure className={`promo-admin-frame is-${kind}`}>
      <div className="promo-admin-screen">
        <div className="promo-admin-page" aria-hidden="true">
          <span className="promo-admin-page-bar" />
          <span className="promo-admin-page-hero" />
          <span className="promo-admin-page-row" />
          <span className="promo-admin-page-row short" />
        </div>
        {imageUrl ? (
          <div className="promo-popup-backdrop is-frame">
            <div className="promo-popup" style={{ ...FRAME_SIZES[kind], "--promo-ratio": ratio } as Record<string, string | number> as CSSProperties}>
              <span className="promo-popup-link">
                <img src={imageUrl} alt="" onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
                }} />
              </span>
              <span className="promo-popup-close" aria-hidden="true">
                <X />
              </span>
            </div>
          </div>
        ) : (
          <span className="promo-admin-empty">Upload an image to see the popup</span>
        )}
      </div>
      <figcaption>
        {kind === "desktop" ? "Desktop" : "Mobile"}
        {!value.enabled && imageUrl ? " · popup is OFF (preview only)" : ""}
      </figcaption>
    </figure>
  );

  const liveStatus = published && published.enabled && published.image && published.link ? "ON" : "OFF";

  return (
    <section className="admin-panel promo-admin" aria-labelledby="promo-admin-title">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">MARKETING · PROMOTIONAL POPUP · OWNER ONLY</span>
          <h1 id="promo-admin-title">Promotional popup</h1>
          <p>
            One promotional image shown on the homepage 3 seconds after a customer's first visit in a browser session.
            Clicking the image opens the page you choose; × closes it and it does not show again in that session.{" "}
            {installed && <strong>Live now: {liveStatus}.</strong>}
            {access === "not_installed" && <strong>Preview mode: nothing is saved to the database.</strong>}
            {access === "owner_required" && <strong>Read-only: this account is not the Owner on {supabaseEnvironmentLabel}.</strong>}
          </p>
        </div>
      </div>

      <div className="promo-admin-grid">
        <div className="promo-admin-controls">
          <div className="promo-admin-field">
            <span className="promo-admin-label">1. Popup image</span>
            <div className="promo-admin-image-row">
              <button type="button" className="admin-secondary" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                {value.image ? <RefreshCw /> : <ImagePlus />} {value.image ? "Replace image" : "Upload image"}
              </button>
              {value.image && (
                <button type="button" className="admin-secondary" onClick={() => setValue((current) => ({ ...current, image: null, enabled: false }))} disabled={Boolean(busy)}>
                  <Trash2 /> Remove
                </button>
              )}
            </div>
            <input ref={fileInput} hidden type="file" accept={PROMO_POPUP_IMAGE_TYPES.join(",")} onChange={(event) => void onChoose(event)} />
            <small className="promo-admin-hint">JPG, PNG or WebP, up to 10 MB. Shown whole (never cropped); a square or portrait image works best on phones.</small>
          </div>

          <label className="promo-admin-field">
            <span className="promo-admin-label">2. Destination link</span>
            <input
              value={linkText}
              onChange={(event) => applyLink(event.target.value)}
              placeholder="/product/apple-iphone-17-pro-max"
              maxLength={260}
              disabled={Boolean(busy)}
              spellCheck={false}
              autoComplete="off"
            />
            <small className="promo-admin-hint">
              A page of this website: a product (/product/…), a collection or deals page (/collections/…). A copied
              isolutionspakistan.com address is accepted too.
            </small>
          </label>

          <div className="promo-admin-field">
            <span className="promo-admin-label">3. Show popup</span>
            <label className="promo-admin-switch">
              <input
                type="checkbox"
                role="switch"
                checked={value.enabled}
                onChange={(event) => setValue((current) => ({ ...current, enabled: event.target.checked }))}
                disabled={Boolean(busy)}
              />
              <span className="promo-admin-switch-track" aria-hidden="true" />
              <strong>{value.enabled ? "ON" : "OFF"}</strong>
            </label>
          </div>

          {errors.length > 0 && <p className="promo-admin-warning">{errors[0]}</p>}

          <div className="promo-admin-save">
            <a className="admin-secondary" href={`/?${PROMO_POPUP_PREVIEW_PARAM}=1`} target="_blank" rel="noreferrer" onClick={resetSessionForPreview}>
              <ExternalLink /> Preview on homepage (this browser)
            </a>
            {needsTypedConfirmation && (
              <label className="promo-admin-field">
                Type <code>{CONFIRM}</code> · {supabaseEnvironmentLabel}
                <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" disabled={Boolean(busy) || !installed} />
              </label>
            )}
            <button type="button" className="admin-primary" onClick={() => void save()} disabled={Boolean(blocker) || Boolean(busy)}>
              <CheckCircle2 /> {busy === "Saving…" ? "Saving…" : "Save"}
            </button>
            {busy && busy !== "Saving…" && <p className="promo-admin-hint">{busy}</p>}
            {blocker && <p className="promo-admin-hint">{blocker}</p>}
            {message && <p className="admin-inline-message" role="status">{message}</p>}
          </div>
        </div>

        <div className="promo-admin-preview" aria-label="Popup preview">
          <span className="promo-admin-label">4. Preview</span>
          <div className="promo-admin-frames">
            {frame("desktop")}
            {frame("mobile")}
          </div>
        </div>
      </div>
    </section>
  );
}
