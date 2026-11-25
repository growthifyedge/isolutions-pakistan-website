import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ExternalLink,
  History,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { validateSourceImage } from "../lib/cloudinary";
import { loadPreviewImageUrls, localPreviewKey, localPreviewSrc, newLocalPreviewKey, putPreviewImage } from "../lib/bannerPreviewStore";
import {
  BANNER_PREVIEW_STORAGE_KEY,
  BANNER_TEXT_LIMITS,
  MAX_HOMEPAGE_BANNERS,
  bannerErrorMessage,
  defaultHomepageBanners,
  isLocalPreviewSrc,
  localPreviewKeys,
  moveBanner,
  newBannerId,
  normalizeBanner,
  parseHomepageContent,
  sameBanners,
  validateHomepageBanners,
  type BannerImage,
  type HomeBanner,
} from "../lib/homepageBanners";
import {
  BannerEditorError,
  checkSiteOwner,
  fetchHomepageBannerAdminState,
  publishHomepageBanners,
  restoreHomepageBannerVersion,
  saveHomepageBannerDraft,
  uploadBannerImage,
  type HomepageBannerAdminState,
} from "../lib/homepageBannersDb";

type Mode = "loading" | "ready" | "preview-only" | "denied" | "error";
type Device = "desktop" | "mobile";
const PREVIEW_SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1440, height: 860 },
  mobile: { width: 390, height: 760 },
};

const HOMEPAGE_PREVIEW_URL = "/?bannerPreview=1";
const PREVIEW_TAB_NAME = "isp-homepage-banner-preview";
const isLocalhost = ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);

function writePreview(banners: readonly HomeBanner[]) {
  try {
    window.localStorage.setItem(BANNER_PREVIEW_STORAGE_KEY, JSON.stringify({ banners: banners.map(normalizeBanner) }));
    return true;
  } catch {
    return false;
  }
}

function readStoredPreview(): HomeBanner[] | null {
  try {
    const raw = window.localStorage.getItem(BANNER_PREVIEW_STORAGE_KEY);
    return raw ? parseHomepageContent(JSON.parse(raw), { allowLocalPreview: true }) : null;
  } catch {
    return null;
  }
}

export const formatTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "—";

/** Website Editor — Homepage Banner & Slider. Owner only (enforced by the database RPCs and the upload Edge Function). */
export function BannerManager() {
  const [mode, setMode] = useState<Mode>("loading");
  const [state, setState] = useState<HomepageBannerAdminState>({ draft: null, published: null, history: [] });
  const [banners, setBanners] = useState<HomeBanner[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [device, setDevice] = useState<Device>("desktop");
  const [previewReload, setPreviewReload] = useState(0);
  // Object URLs of browser-local preview images (key -> url), for the thumbnails in this page.
  const [localUrls, setLocalUrls] = useState<ReadonlyMap<string, string>>(() => new Map());

  // The editor starts from the saved draft, else the published version, else the built-in banners.
  const baseline = state.draft?.banners ?? state.published?.banners ?? defaultHomepageBanners();
  const dirty = mode === "ready" || mode === "preview-only" ? !sameBanners(banners.map(normalizeBanner), baseline) : false;
  const localErrors = useMemo(
    () => validateHomepageBanners(banners.map(normalizeBanner), { allowLocalPreview: mode === "preview-only" }),
    [banners, mode],
  );
  const hasLocalImages = banners.some((banner) => isLocalPreviewSrc(banner.desktop.src) || (banner.mobile ? isLocalPreviewSrc(banner.mobile.src) : false));
  const displayImage = (image: BannerImage | null) => {
    if (!image?.src) return null;
    const key = localPreviewKey(image.src);
    return key ? { ...image, src: localUrls.get(key) ?? "" } : image;
  };

  async function load() {
    try {
      const isOwner = await checkSiteOwner();
      if (!isOwner) {
        setMode("denied");
        return;
      }
      const next = await fetchHomepageBannerAdminState();
      setState(next);
      setBanners(next.draft?.banners ?? next.published?.banners ?? defaultHomepageBanners());
      setMode("ready");
    } catch (error) {
      if (error instanceof BannerEditorError && error.code === "not_installed") {
        // Preview-only: nothing can be saved yet, so unsaved edits are kept in this browser and restored on refresh.
        const stored = readStoredPreview();
        setBanners(stored ?? defaultHomepageBanners());
        if (stored) {
          setLocalUrls(await loadPreviewImageUrls(localPreviewKeys(stored)));
          setMessage("Your unsaved preview edits from this browser were restored.");
        }
        setMode("preview-only");
        return;
      }
      if (error instanceof BannerEditorError && error.code === "owner_required") {
        setMode("denied");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not load banners.");
      setMode("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Live preview: the frame below is the real homepage reading these banners from this browser's storage.
  // Keeps both previews (the frame below and the homepage preview tab) in step with the editor.
  useEffect(() => {
    if (mode !== "ready" && mode !== "preview-only") return;
    writePreview(banners);
  }, [banners, mode]);

  /** Opens the real homepage in preview mode (this browser only; nothing is published). */
  function openHomepagePreview() {
    if (!writePreview(banners)) {
      setMessage("This browser blocks local storage, so the homepage preview cannot be opened.");
      return;
    }
    window.open(HOMEPAGE_PREVIEW_URL, PREVIEW_TAB_NAME);
    setMessage("Homepage preview opened in a new tab. It shows your current edits in this browser only — nothing is published.");
  }

  const update = (index: number, patch: Partial<HomeBanner>) =>
    setBanners((current) => current.map((banner, position) => (position === index ? { ...banner, ...patch } : banner)));

  async function chooseImage(index: number, slot: "desktop" | "mobile", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = await validateSourceImage(file);
    if (problem) {
      setMessage(problem);
      return;
    }
    if (mode === "preview-only") {
      // Not uploaded: kept in this browser only (IndexedDB), because saving is unavailable until the migration is applied.
      const key = newLocalPreviewKey();
      try {
        await putPreviewImage(key, file);
      } catch {
        setMessage("This browser cannot store the preview image locally.");
        return;
      }
      setLocalUrls((current) => new Map(current).set(key, URL.createObjectURL(file)));
      update(index, { [slot]: { src: localPreviewSrc(key), publicId: null } });
      setMessage("Local preview only — this image stays in this browser and is not uploaded. Upload works after the database update is applied.");
      return;
    }
    setBusy(`Uploading ${slot} image…`);
    setMessage("");
    try {
      const image = await uploadBannerImage(file);
      update(index, { [slot]: image });
      setMessage(`${slot === "desktop" ? "Desktop" : "Mobile"} image uploaded. Save Draft to keep it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  }

  function addBanner() {
    if (banners.length >= MAX_HOMEPAGE_BANNERS) return;
    setBanners((current) => [
      ...current,
      { id: newBannerId(), enabled: false, alt: "", heading: null, buttonText: null, link: null, desktop: { src: "", publicId: null }, mobile: null },
    ]);
    setMessage("New banner added at the end (disabled). Upload a desktop image and add an image description.");
  }

  function removeBanner(index: number) {
    const label = banners[index].alt || `Banner ${index + 1}`;
    if (!confirm(`Remove “${label}” from the draft? The live website changes only after Publish.`)) return;
    setBanners((current) => current.filter((_, position) => position !== index));
  }

  async function saveDraft() {
    const normalized = banners.map(normalizeBanner);
    if (localErrors.length) {
      setMessage("Fix the highlighted problems before saving.");
      return false;
    }
    setBusy("Saving draft…");
    setServerErrors([]);
    try {
      await saveHomepageBannerDraft(normalized);
      const next = await fetchHomepageBannerAdminState();
      setState(next);
      setBanners(next.draft?.banners ?? normalized);
      setMessage("Draft saved. The live website is unchanged until you Publish.");
      return true;
    } catch (error) {
      if (error instanceof BannerEditorError && error.code === "invalid") setServerErrors(error.details);
      setMessage(error instanceof Error ? error.message : "Save failed.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!confirm("Publish these banners to the live homepage now?")) return;
    if (dirty || !state.draft) {
      const saved = await saveDraft();
      if (!saved) return;
    }
    setBusy("Publishing…");
    try {
      await publishHomepageBanners();
      const next = await fetchHomepageBannerAdminState();
      setState(next);
      setBanners(next.draft?.banners ?? next.published?.banners ?? defaultHomepageBanners());
      setMessage("Published. The homepage now shows these banners.");
    } catch (error) {
      if (error instanceof BannerEditorError && error.code === "invalid") setServerErrors(error.details);
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
      await restoreHomepageBannerVersion(versionId);
      const next = await fetchHomepageBannerAdminState();
      setState(next);
      setBanners(next.draft?.banners ?? banners);
      setMessage("Version restored into the draft. Review it, then Publish.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setBusy("");
    }
  }

  function loadBuiltIn() {
    if (!confirm("Replace the editor contents with the original 7 built-in banners? Nothing is saved until Save Draft.")) return;
    setBanners(defaultHomepageBanners());
    setMessage("Original built-in banners loaded into the editor.");
  }

  function discardChanges() {
    if (!confirm("Discard unsaved changes?")) return;
    setBanners(baseline);
    setMessage("Unsaved changes discarded.");
  }

  if (mode === "loading") return <div className="admin-auth-state">Checking Owner access…</div>;
  if (mode === "denied")
    return (
      <div className="future-screen">
        <span className="admin-kicker">WEBSITE EDITOR</span>
        <h1>Owner only</h1>
        <p>Homepage banners can be edited by the Owner account only.</p>
      </div>
    );
  if (mode === "error")
    return (
      <div className="future-screen">
        <span className="admin-kicker">WEBSITE EDITOR</span>
        <h1>Banners unavailable</h1>
        <p>{message}</p>
        <button className="admin-secondary" onClick={() => void load()}><RefreshCw /> Try again</button>
      </div>
    );

  const writable = mode === "ready" && !busy;
  const errorCodes = [...new Set([...localErrors, ...serverErrors])];

  return (
    <div className="banner-manager">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">WEBSITE EDITOR · OWNER ONLY</span>
          <h1>Homepage Banners</h1>
          <p>
            Edit the homepage slider. Changes stay in a draft until you Publish. The carousel design, timing and behaviour
            are unchanged.
          </p>
        </div>
      </div>

      {mode === "preview-only" && (
        <p className="banner-notice" role="status">
          <strong>Preview-only mode.</strong> The banner editor database update (migration 202611200001) is not applied on
          this database, so Save Draft, Publish, Restore and uploads are disabled. You can still try every edit and see it in
          the live preview below — nothing is stored or uploaded.
        </p>
      )}

      <section className="admin-panel banner-status" aria-label="Version status">
        <div>
          <span>Live website</span>
          <strong>{state.published ? `Published ${formatTime(state.published.publishedAt)}` : "Built-in banners (nothing published yet)"}</strong>
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
          <button className="admin-secondary" onClick={() => void saveDraft()} disabled={!writable || !!localErrors.length || hasLocalImages}>
            <Save /> Save Draft
          </button>
          <button className="admin-primary" onClick={() => void publish()} disabled={!writable || !!localErrors.length || hasLocalImages || (!dirty && !state.draft)}>
            <Send /> Publish
          </button>
          <button className="admin-secondary" onClick={discardChanges} disabled={!dirty || !!busy}>
            <RotateCcw /> Discard changes
          </button>
          <button className="admin-secondary" onClick={loadBuiltIn} disabled={!!busy}>
            <History /> Load built-in banners
          </button>
          <button className="admin-secondary" onClick={openHomepagePreview} disabled={!!busy} title="Opens the real homepage showing your current edits, in this browser only">
            <ExternalLink /> {isLocalhost ? "Preview on Localhost" : "Preview on homepage"}
          </button>
        </div>
      </section>

      {busy && <p className="admin-inline-message" role="status">{busy}</p>}
      {message && !busy && <p className="admin-inline-message" role="status">{message}</p>}
      {errorCodes.length > 0 && (
        <ul className="banner-errors" aria-label="Problems to fix">
          {errorCodes.map((code) => <li key={code}>{bannerErrorMessage(code)}</li>)}
        </ul>
      )}

      <div className="banner-layout">
        <section className="banner-list" aria-label="Banners">
          {banners.map((banner, index) => (
            <article className={`admin-panel banner-card${banner.enabled ? "" : " is-disabled"}`} key={banner.id}>
              <div className="banner-card-head">
                <strong>Banner {index + 1}</strong>
                <span className={`state ${banner.enabled ? "published" : "draft"}`}>{banner.enabled ? "Enabled" : "Disabled"}</span>
                <div className="banner-card-actions">
                  <button onClick={() => update(index, { enabled: !banner.enabled })} aria-label={banner.enabled ? `Disable banner ${index + 1}` : `Enable banner ${index + 1}`} title={banner.enabled ? "Disable" : "Enable"}>
                    {banner.enabled ? <EyeOff /> : <Eye />}
                  </button>
                  <button onClick={() => setBanners((current) => moveBanner(current, index, -1))} disabled={index === 0} aria-label={`Move banner ${index + 1} up`} title="Move up"><ArrowUp /></button>
                  <button onClick={() => setBanners((current) => moveBanner(current, index, 1))} disabled={index === banners.length - 1} aria-label={`Move banner ${index + 1} down`} title="Move down"><ArrowDown /></button>
                  <button className="danger" onClick={() => removeBanner(index)} disabled={banners.length <= 1} aria-label={`Remove banner ${index + 1}`} title="Remove"><Trash2 /></button>
                </div>
              </div>
              <div className="banner-images">
                <BannerImageSlot
                  label="Desktop image"
                  hint="2000 × 839 recommended"
                  image={displayImage(banner.desktop)}
                  disabled={!!busy}
                  onChoose={(event) => void chooseImage(index, "desktop", event)}
                />
                <BannerImageSlot
                  label="Mobile image"
                  hint="1122 × 1402 recommended · optional (desktop image is used when empty)"
                  image={displayImage(banner.mobile)}
                  disabled={!!busy}
                  onChoose={(event) => void chooseImage(index, "mobile", event)}
                  onRemove={banner.mobile ? () => update(index, { mobile: null }) : undefined}
                />
              </div>
              <div className="form-grid banner-fields">
                <label className="wide">
                  Image description (alt text) *
                  <input value={banner.alt} maxLength={BANNER_TEXT_LIMITS.alt} onChange={(event) => update(index, { alt: event.target.value })} placeholder="Samsung Galaxy S26 Ultra banner" />
                </label>
                <label>
                  Heading <small>optional</small>
                  <input value={banner.heading ?? ""} maxLength={BANNER_TEXT_LIMITS.heading} onChange={(event) => update(index, { heading: event.target.value })} />
                </label>
                <label>
                  Button text <small>optional</small>
                  <input value={banner.buttonText ?? ""} maxLength={BANNER_TEXT_LIMITS.buttonText} onChange={(event) => update(index, { buttonText: event.target.value })} placeholder="Shop now" />
                </label>
                <label className="wide">
                  Link <small>optional · internal page, e.g. /shop or /collections/samsung</small>
                  <input value={banner.link ?? ""} maxLength={BANNER_TEXT_LIMITS.link} onChange={(event) => update(index, { link: event.target.value })} placeholder="/shop" />
                </label>
              </div>
            </article>
          ))}
          <button className="admin-secondary banner-add" onClick={addBanner} disabled={banners.length >= MAX_HOMEPAGE_BANNERS || !!busy}>
            <Plus /> Add banner
          </button>

          {mode === "ready" && (
            <section className="admin-panel banner-history" aria-label="Published versions">
              <h2><History /> Restore a published version</h2>
              {state.history.length ? (
                state.history.map((version) => (
                  <div key={version.id}>
                    <span>
                      {formatTime(version.publishedAt)} · {version.bannerCount} banners
                      {version.status === "published" ? " · live now" : ""}
                    </span>
                    <button className="admin-secondary" onClick={() => void restoreVersion(version.id, version.publishedAt)} disabled={!!busy}>
                      <RotateCcw /> Restore to draft
                    </button>
                  </div>
                ))
              ) : (
                <p>Nothing has been published yet. The live homepage shows the built-in banners.</p>
              )}
            </section>
          )}
        </section>

        <BannerPreview device={device} onDevice={setDevice} reloadKey={previewReload} onReload={() => setPreviewReload((value) => value + 1)} />
      </div>
    </div>
  );
}

export function BannerImageSlot({
  label,
  hint,
  image,
  disabled,
  onChoose,
  onRemove,
}: {
  label: string;
  hint: string;
  image: BannerImage | null;
  disabled: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="banner-image-slot">
      <span>{label}</span>
      <div className="banner-thumb">{image ? <img src={image.src} alt="" /> : <small>No image</small>}</div>
      <small>{hint}</small>
      <div>
        <button type="button" className="admin-secondary" onClick={() => input.current?.click()} disabled={disabled}>
          {image ? <RefreshCw /> : <UploadCloud />} {image ? "Replace" : "Upload"}
        </button>
        {onRemove && <button type="button" className="admin-secondary" onClick={onRemove} disabled={disabled}><Trash2 /> Remove</button>}
      </div>
      <input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={onChoose} />
    </div>
  );
}

/** The real homepage in a frame (same CSS, same carousel), sized like a desktop or a phone and scaled to fit. */
function BannerPreview({ device, onDevice, reloadKey, onReload }: { device: Device; onDevice: (device: Device) => void; reloadKey: number; onReload: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(600);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    // Measured right away too: the observer's first report can arrive late (e.g. in a background tab).
    setAvailable(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element);
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);
  const size = PREVIEW_SIZE[device];
  // Fits the panel width and (side-by-side layout) the screen below the sticky Admin top bar.
  // Panel chrome (~120 px) + top bar offset (88 px) + page bottom padding (80 px): the panel always fits on screen.
  const maxFrameHeight = Math.max(280, viewportHeight - 300);
  const scale = Math.min(1, available / size.width, maxFrameHeight / size.height);
  return (
    <section className="admin-panel banner-preview" aria-label="Homepage preview">
      <div className="banner-preview-head">
        <h2>Preview</h2>
        <div role="group" aria-label="Preview device">
          <button className={device === "desktop" ? "is-active" : ""} onClick={() => onDevice("desktop")} aria-pressed={device === "desktop"}><Monitor /> Desktop</button>
          <button className={device === "mobile" ? "is-active" : ""} onClick={() => onDevice("mobile")} aria-pressed={device === "mobile"}><Smartphone /> Mobile</button>
          <button onClick={onReload} aria-label="Reload preview" title="Reload preview"><RefreshCw /></button>
        </div>
      </div>
      <p>Live preview of your current edits (enabled banners only). Visitors see the published version.</p>
      <div className="banner-preview-holder" ref={holder} style={{ height: size.height * scale }}>
        <iframe
          key={`${device}-${reloadKey}`}
          title={`Homepage ${device} preview`}
          src={`${HOMEPAGE_PREVIEW_URL}&frame=1`}
          style={{ width: size.width, height: size.height, left: Math.max(0, (available - size.width * scale) / 2), transform: `scale(${scale})` }}
        />
      </div>
    </section>
  );
}
