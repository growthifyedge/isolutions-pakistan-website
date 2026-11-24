/**
 * Promotional Popup on the homepage (Admin Studio → Marketing → Promotional Popup). Loaded as its own small chunk by
 * App.tsx on "/" only, after the page has rendered; it never blocks loading or touches cart / checkout.
 *
 * Shown 3 seconds after the first homepage visit of a browser session, when the published popup is ON with an image and
 * a link and the image has loaded. Shown once per session (sessionStorage); × / Esc / backdrop close it. Clicking the
 * image opens the configured page. ?promoPopupPreview=1 shows this browser's unsaved Admin setting instead (labelled,
 * ignores the session rule, never saved).
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { loadPreviewImageUrls } from "./lib/bannerPreviewStore";
import {
  PROMO_POPUP_DELAY_MS,
  PROMO_POPUP_GIVE_UP_MS,
  PROMO_POPUP_PREVIEW_PARAM,
  PROMO_POPUP_PREVIEW_STORAGE_KEY,
  PROMO_POPUP_SESSION_KEY,
  isPromoPopupShowable,
  parsePromoPopup,
  promoPopupImageSources,
  promoPopupPreviewKey,
  type PromoPopup as PromoPopupSetting,
} from "./lib/promoPopup";
import { fetchPublishedPromoPopup } from "./lib/promoPopupDb";
import "./promoPopup.css";

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const SIZES = "(max-width: 600px) 94vw, min(900px, 92vw)";

/** ratio = the image's own width / height; the popup box takes these proportions (promoPopup.css). */
type Ready = { src: string; srcSet?: string; link: string; ratio: number };

const seenThisSession = () => {
  try {
    return window.sessionStorage.getItem(PROMO_POPUP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
};
const markSeen = () => {
  try {
    window.sessionStorage.setItem(PROMO_POPUP_SESSION_KEY, "1");
  } catch {
    // Storage blocked: the popup may show again on the next homepage visit; nothing else is affected.
  }
};

async function readPreviewSetting(): Promise<{ setting: PromoPopupSetting | null; localUrls: Map<string, string> }> {
  try {
    const raw = window.localStorage.getItem(PROMO_POPUP_PREVIEW_STORAGE_KEY);
    const setting = raw ? parsePromoPopup(JSON.parse(raw), { allowLocalPreview: true }) : null;
    const key = promoPopupPreviewKey(setting);
    return { setting, localUrls: key ? await loadPreviewImageUrls([key]) : new Map() };
  } catch {
    return { setting: null, localUrls: new Map() };
  }
}

/**
 * Resolves with the image's width / height once it is downloaded (so the popup never opens empty and is sized to the
 * image's real proportions); rejects on a broken image.
 */
function preload({ src, srcSet }: { src: string; srcSet?: string }) {
  return new Promise<number>((resolve, reject) => {
    const image = new Image();
    image.onload = () => (image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve(image.naturalWidth / image.naturalHeight) : reject(new Error("image_failed")));
    image.onerror = () => reject(new Error("image_failed"));
    if (srcSet) {
      image.sizes = SIZES;
      image.srcset = srcSet;
    }
    image.src = src;
  });
}

export default function PromoPopup() {
  const [preview] = useState(() => new URLSearchParams(window.location.search).get(PROMO_POPUP_PREVIEW_PARAM) === "1");
  const [ready, setReady] = useState<Ready | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!preview && seenThisSession()) return;
    let active = true;
    // performance.now() counts from the start of the page visit, so "3 seconds" is measured from the visit itself,
    // not from when this chunk arrived (it is loaded only after the homepage has finished loading).
    const openedAt = 0;
    let timer: number | undefined;
    (async () => {
      const { setting, localUrls } = preview ? await readPreviewSetting() : { setting: await fetchPublishedPromoPopup(), localUrls: undefined };
      if (!active || !isPromoPopupShowable(setting)) return;
      const sources = promoPopupImageSources(setting.image, CLOUDINARY_CLOUD_NAME, localUrls);
      if (!sources) return;
      const ratio = await preload(sources);
      const elapsed = performance.now() - openedAt;
      if (!active || elapsed > PROMO_POPUP_GIVE_UP_MS) return;
      timer = window.setTimeout(() => {
        if (!active || (!preview && seenThisSession())) return;
        if (!preview) markSeen();
        setReady({ ...sources, link: setting.link, ratio });
      }, Math.max(0, PROMO_POPUP_DELAY_MS - elapsed));
    })().catch(() => undefined); // Any failure = no popup; the homepage is unaffected.
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [preview]);

  useEffect(() => {
    if (!ready) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus moves to × for keyboard / screen-reader users without drawing a focus ring on phones (the ring appears once
    // the keyboard is used; browsers without the focusVisible option draw the subtle white ring from promoPopup.css).
    closeButton.current?.focus({ focusVisible: false } as FocusOptions);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReady(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [ready]);

  if (!ready) return null;
  return (
    <div className="promo-popup-backdrop" onClick={(event) => event.target === event.currentTarget && setReady(null)}>
      <div className="promo-popup" role="dialog" aria-modal="true" aria-label="Special offer" style={{ "--promo-ratio": ready.ratio } as CSSProperties}>
        <a className="promo-popup-link" href={ready.link}>
          <img src={ready.src} srcSet={ready.srcSet} sizes={ready.srcSet ? SIZES : undefined} alt="Special offer — open the offer" />
        </a>
        {preview && <span className="promo-popup-preview-tag">Preview · not published</span>}
        <button ref={closeButton} type="button" className="promo-popup-close" aria-label="Close" onClick={() => setReady(null)}>
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
