import { useEffect, useRef, useState } from "react";
import { Lottie } from "lottie-react";
import {
  ArrowRight,
  MapPinned,
  Landmark,
  History,
  Banknote,
  Cable,
  Clock3,
  FileText,
  House,
  Info,
  Laptop,
  Mail,
  PackageOpen,
  Target,
  Eye,
  ThumbsUp,
  Handshake,
  Gem,
  ChartNoAxesCombined,
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  Menu,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Star,
  Tag,
  Truck,
  User,
  Zap,
  X,
} from "lucide-react";
import {
  fetchHomepageFeaturedProducts,
  fetchPublicCatalog,
  fetchPublicTaxonomy,
  fetchFrequentlyBoughtTogether,
  formatPkrMinor,
  hasVariablePrice,
  primaryMedia,
  productPrice,
  validCompareAt,
  type CatalogFilters,
  type CatalogProduct,
  type CatalogVariant,
  type FrequentlyBoughtTogetherProduct,
} from "./lib/catalog";
import { parsePkrMajorToMinor } from "./lib/money";
import { cloudinaryDeliveryUrl } from "./lib/cloudinary";
import { supabase } from "./lib/supabase";
import { fetchHomepageBundles, type HomepageBundle } from "./lib/bundles";
import {
  addStorefrontCartItem,
  clearStorefrontCart,
  decrementStorefrontCartItem,
  removeStorefrontCartItem,
  storefrontCartItemQuantity,
  storefrontCartItems,
  storefrontCartTotalQuantity,
  type StorefrontCartItem,
} from "./lib/cart";
import {
  MAX_ORDER_LINE_QUANTITY,
  PHONE_VALIDATION_MESSAGE,
  cartLineLimit,
  isValidOrderPhone,
} from "./lib/orderRules";
import { RATE_LIMIT_MESSAGE, isRateLimitError } from "./lib/rateLimit";
import {
  hasStorefrontWishlistItem,
  removeStorefrontWishlistItem,
  storefrontWishlistItems,
  storefrontWishlistTotal,
  toggleStorefrontWishlistItem,
  type StorefrontWishlistItem,
} from "./lib/wishlist";
import deliveryAnimation from "../public/assets/animations/delivery.json";
import warrantyAnimation from "../public/assets/animations/warranty.json";
import authenticAnimation from "../public/assets/animations/authentic.json";
import trustedAnimation from "../public/assets/animations/trusted.json";
import {
  primaryMobileBrands,
  resolveCollection,
  type ResolvedCollection,
} from "./lib/collections";
import { storefrontContact } from "./lib/storefrontContact";
import {
  createStorefrontOrder,
  readStorefrontOrderConfirmation,
  saveStorefrontOrderConfirmation,
  calculateDeliveryFeeMinor,
  FREE_STANDARD_DELIVERY_THRESHOLD_MINOR,
  STANDARD_DELIVERY_FEE_MINOR,
  FAST_DELIVERY_SURCHARGE_MINOR,
  type ShippingMethod,
} from "./lib/orders";

type Taxonomy = Awaited<ReturnType<typeof fetchPublicTaxonomy>>;

const SEARCH_HISTORY_STORAGE_KEY = "isolutions-storefront-search-history";
const SEARCH_HISTORY_LIMIT = 5;

function readStorefrontSearchHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((term): term is string => typeof term === "string" && term.trim().length > 0).slice(0, SEARCH_HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function saveStorefrontSearchHistory(term: string): string[] {
  const normalized = term.trim();
  if (!normalized) return readStorefrontSearchHistory();
  const nextHistory = [
    normalized,
    ...readStorefrontSearchHistory().filter((entry) => entry.toLocaleLowerCase() !== normalized.toLocaleLowerCase()),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
  return nextHistory;
}

type FlashSaleTime = {
  hours: number;
  minutes: number;
  seconds: number;
};

const pakistanTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pakistanFlashSaleTime(now = new Date()): FlashSaleTime {
  const parts = pakistanTimeFormatter.formatToParts(now);
  const value = (type: "hour" | "minute" | "second") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  const remainingSeconds = (8 - (hour % 8)) * 3_600 - minute * 60 - second;

  return {
    hours: Math.floor(remainingSeconds / 3_600),
    minutes: Math.floor((remainingSeconds % 3_600) / 60),
    seconds: remainingSeconds % 60,
  };
}

function FlashSaleCountdown() {
  const [time, setTime] = useState<FlashSaleTime>(() => pakistanFlashSaleTime());

  useEffect(() => {
    const interval = window.setInterval(() => setTime(pakistanFlashSaleTime()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const segments = [
    { value: time.hours, label: "HRS" },
    { value: time.minutes, label: "MIN" },
    { value: time.seconds, label: "SEC" },
  ];
  const description = segments
    .map(({ value, label }) => `${String(value).padStart(2, "0")} ${label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="home-flash-countdown" aria-label={`Flash Sale ends in ${description}`}>
      <span className="home-flash-countdown-label"><Clock3 aria-hidden="true" />Ends in:</span>
      <div className="home-flash-timer" aria-hidden="true">
        {segments.map(({ value, label }, index) => (
          <span className="home-flash-timer-part" key={label}>
            <span className="home-flash-timer-value">
              <span className="home-flash-timer-unit">
                <b>{String(value).padStart(2, "0")}</b>
                <small>{label}</small>
              </span>
              <small className="home-flash-timer-mobile-label">{label}</small>
            </span>
            {index < segments.length - 1 && <span className="home-flash-timer-separator">:</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

function ServiceCardAnimation({ animation, reducedMotion }: { animation: object; reducedMotion: boolean }) {
  return (
    <div className="pdp-service-animation" aria-hidden="true">
      <Lottie src={animation} autoplay={!reducedMotion} loop={!reducedMotion} renderer="svg" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

type NavbarMegaMenuProps = {
  label: string;
  href: string;
  heading: string;
  links?: Array<{ label: string; href: string }>;
  groups?: Array<{
    heading: string;
    href: string;
    links: Array<{ label: string; href: string }>;
  }>;
  promoImage?: string;
  promoBackground?: string;
  promoFit?: "contain" | "cover";
  promoWidth?: number;
  promoHeight?: number;
  showHeading?: boolean;
  groupColumns?: number;
  groupColumnGap?: number;
};

function NavbarMegaMenu({
  label,
  href,
  heading,
  links = [],
  groups,
  promoImage,
  promoBackground,
  promoFit = "contain",
  promoWidth,
  promoHeight,
  showHeading = true,
  groupColumns,
  groupColumnGap = 64,
}: NavbarMegaMenuProps) {
  const isCurrent = location.pathname === href || location.pathname.startsWith(`${href}/`);
  return (
    <div className="navbar-mega-menu">
      <a className="navbar-mega-trigger" href={href} aria-current={isCurrent ? "page" : undefined}>{label}</a>
      <div className="navbar-mega-panel" aria-label={`${heading} collections`}>
        <div className="navbar-mega-inner">
          <div className="navbar-mega-links">
            {showHeading && <h2>{heading}</h2>}
            {groups ? (
              <div
                className="navbar-mega-groups"
                style={groupColumns ? {
                  display: "grid",
                  gridTemplateColumns: Array.from({ length: groupColumns }, () => "max-content").join(" "),
                  columnGap: `${groupColumnGap}px`,
                  justifyContent: "start",
                  alignItems: "start",
                } : undefined}
              >
                {groups.map((group) => (
                  <section key={group.heading}>
                    <h3><a href={group.href}>{group.heading}</a></h3>
                    {group.links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
                  </section>
                ))}
              </div>
            ) : links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </div>
          {promoImage && (
            <div
              className="navbar-mega-visual"
              style={{
                background: promoBackground,
                width: promoWidth,
                maxWidth: promoWidth,
                height: promoHeight,
              }}
              aria-hidden="true"
            >
              <img src={promoImage} style={{ objectFit: promoFit }} alt="" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawerCategory({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Smartphone;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const submenuId = `drawer-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="drawer-category" data-open={expanded}>
      <button
        className="drawer-category-trigger"
        type="button"
        aria-expanded={expanded}
        aria-controls={submenuId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="drawer-category-label"><Icon aria-hidden="true" />{label}</span>
        <span className="drawer-expand-icon" aria-hidden="true"><Plus className="is-closed" /><Minus className="is-open" /></span>
      </button>
      <div className="drawer-submenu" id={submenuId} data-open={expanded} aria-hidden={!expanded}>
        <div className="drawer-submenu-inner">{children}</div>
      </div>
    </div>
  );
}

function StorefrontCartDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StorefrontCartItem[]>(() => storefrontCartItems());
  const [inventoryByVariant, setInventoryByVariant] = useState<Record<string, number>>({});
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const syncCart = () => setItems(storefrontCartItems());
    syncCart();
    window.addEventListener("isolutions:cart-updated", syncCart);
    return () => window.removeEventListener("isolutions:cart-updated", syncCart);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchPublicCatalog({ limit: 100 })
      .then((products) => {
        if (!active) return;
        setInventoryByVariant(Object.fromEntries(
          products.flatMap((product) => product.variants.map((variant) => [variant.id, variant.quantity])),
        ));
      })
      .catch(() => {
        if (active) setInventoryByVariant({});
      });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  const subtotal = items.reduce((total, item) => total + item.priceMinor * item.quantity, 0);
  const increaseQuantity = (item: StorefrontCartItem) => {
    const inventoryLimit = inventoryByVariant[item.variantId];
    if (typeof inventoryLimit !== "number" || item.quantity >= cartLineLimit(inventoryLimit)) return;
    addStorefrontCartItem({ ...item, quantity: 1 }, inventoryLimit);
  };

  return (
    <>
      <button
        className={`storefront-cart-backdrop${open ? " is-open" : ""}`}
        type="button"
        onClick={onClose}
        aria-label="Close shopping cart"
      />
      <aside
        className={`storefront-cart-drawer${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-labelledby="storefront-cart-title"
      >
        <header className="storefront-cart-drawer-head">
          <div>
            <h2 id="storefront-cart-title">Shopping Cart</h2>
            {items.length > 0 && <span>{items.reduce((total, item) => total + item.quantity, 0)} items</span>}
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close shopping cart">
            <X aria-hidden="true" />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="storefront-cart-empty">
            <PackageOpen aria-hidden="true" />
            <p>Your cart is empty.</p>
            <button type="button" onClick={onClose}>Continue Shopping</button>
          </div>
        ) : (
          <>
            <div className="storefront-cart-items">
              {items.map((item) => {
                const inventoryLimit = inventoryByVariant[item.variantId];
                const cannotIncrease = typeof inventoryLimit !== "number" || item.quantity >= cartLineLimit(inventoryLimit);
                return (
                  <article className="storefront-cart-item" key={item.variantId}>
                    <div className="storefront-cart-item-image">
                      {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <PackageOpen aria-hidden="true" />}
                    </div>
                    <div className="storefront-cart-item-details">
                      <h3>{item.productTitle}</h3>
                      {item.sku && <p>SKU: {item.sku}</p>}
                      <strong>{formatPkrMinor(item.priceMinor)}</strong>
                      <div className="storefront-cart-item-controls">
                        <div className="storefront-cart-quantity" aria-label={`Quantity for ${item.productTitle}`}>
                          <button type="button" onClick={() => decrementStorefrontCartItem(item.variantId)} aria-label={`Decrease ${item.productTitle} quantity`}><Minus aria-hidden="true" /></button>
                          <output>{item.quantity}</output>
                          <button type="button" onClick={() => increaseQuantity(item)} disabled={cannotIncrease} aria-label={`Increase ${item.productTitle} quantity`}><Plus aria-hidden="true" /></button>
                        </div>
                        <button className="storefront-cart-remove" type="button" onClick={() => removeStorefrontCartItem(item.variantId)}>Remove</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="storefront-cart-drawer-foot">
              <div className="storefront-cart-subtotal"><span>Subtotal</span><strong>{formatPkrMinor(subtotal)}</strong></div>
              <button className="storefront-cart-continue" type="button" onClick={onClose}>Continue Shopping</button>
              <button className="storefront-cart-checkout" type="button" onClick={() => window.location.assign("/checkout")}>Checkout</button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

function SearchSuggestionCard({ product, onOpen }: { product: CatalogProduct; onOpen: () => void }) {
  const [wishlisted, setWishlisted] = useState(() => hasStorefrontWishlistItem(product.id));
  const media = primaryMedia(product);
  const variant = [...product.variants].sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const compareAt = variant ? validCompareAt(variant) : null;
  const discount = variant && compareAt ? Math.round(((compareAt - variant.priceMinor) / compareAt) * 100) : null;
  const toggleSuggestionWishlist = () => {
    setWishlisted(toggleStorefrontWishlistItem({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      imageUrl: media?.url ?? null,
    }));
  };

  return (
    <article className="storefront-search-suggestion">
      <a className="storefront-search-suggestion-image" href={`/product/${product.slug}`} onClick={onOpen}>
        {media ? <img src={cloudinaryDeliveryUrl(media.publicId, 360) || media.url} alt={media.alt} loading="lazy" /> : <PackageOpen aria-hidden="true" />}
        {discount !== null && <span>Sale · {discount}%</span>}
      </a>
      <button className={wishlisted ? "is-saved" : ""} type="button" onClick={toggleSuggestionWishlist} aria-label={wishlisted ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`} aria-pressed={wishlisted}><Heart aria-hidden="true" /></button>
      <a className="storefront-search-suggestion-copy" href={`/product/${product.slug}`} onClick={onOpen}>
        <small>{product.brand?.name ?? product.category.name}</small>
        <strong>{product.title}</strong>
        {variant && <span><b>{formatPkrMinor(variant.priceMinor)}</b>{compareAt && <del>{formatPkrMinor(compareAt)}</del>}</span>}
      </a>
    </article>
  );
}

function StorefrontSearchPanel({
  open,
  initialQuery,
  onClose,
  onSearch,
}: {
  open: boolean;
  initialQuery: string;
  onClose: () => void;
  onSearch: (term: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [history, setHistory] = useState<string[]>(() => readStorefrontSearchHistory());
  const [suggestions, setSuggestions] = useState<CatalogProduct[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setHistory(readStorefrontSearchHistory());
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchPublicCatalog({ limit: 6 })
      .then((products) => { if (active) setSuggestions(products); })
      .catch(() => { if (active) setSuggestions([]); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  const submitSearch = (term = query) => {
    const normalized = term.trim();
    if (normalized) setHistory(saveStorefrontSearchHistory(normalized));
    onSearch(normalized);
  };

  return (
    <>
      <button className={`storefront-search-panel-backdrop${open ? " is-open" : ""}`} type="button" onClick={onClose} aria-label="Close search" />
      <aside className={`storefront-search-panel${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-hidden={!open} aria-labelledby="storefront-search-title">
        <header>
          <h2 id="storefront-search-title">Search Your Favorite Product</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close search"><X aria-hidden="true" /></button>
        </header>
        <form role="search" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, brands and categories" aria-label="Search products" />
          <button type="submit" aria-label="Search"><Search aria-hidden="true" /></button>
        </form>
        <section className="storefront-search-history" aria-labelledby="storefront-search-history-title">
          <div><h3 id="storefront-search-history-title">Search History</h3>{history.length > 0 && <button type="button" onClick={() => { localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY); setHistory([]); }}>Clear History</button>}</div>
          {history.length > 0 ? <nav aria-label="Recent searches">{history.map((term) => <button key={term} type="button" onClick={() => submitSearch(term)}>{term}<ArrowRight aria-hidden="true" /></button>)}</nav> : <p>Your recent searches will appear here.</p>}
        </section>
        <section className="storefront-search-suggestions" aria-labelledby="storefront-search-suggestions-title">
          <h3 id="storefront-search-suggestions-title">Suggestions For You</h3>
          {suggestions.length > 0 ? <div>{suggestions.map((product) => <SearchSuggestionCard key={product.id} product={product} onOpen={onClose} />)}</div> : <p>Suggestions are being prepared.</p>}
        </section>
      </aside>
    </>
  );
}

function StorefrontWishlistDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StorefrontWishlistItem[]>(() => storefrontWishlistItems());
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const syncWishlist = () => setItems(storefrontWishlistItems());
    syncWishlist();
    window.addEventListener("isolutions:wishlist-updated", syncWishlist);
    return () => window.removeEventListener("isolutions:wishlist-updated", syncWishlist);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  return (
    <>
      <button className={`storefront-wishlist-backdrop${open ? " is-open" : ""}`} type="button" onClick={onClose} aria-label="Close wishlist" />
      <aside className={`storefront-wishlist-drawer${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-hidden={!open} aria-labelledby="storefront-wishlist-title">
        <header className="storefront-wishlist-drawer-head">
          <div>
            <h2 id="storefront-wishlist-title">Wishlist</h2>
            {items.length > 0 && <span>{items.length} item{items.length === 1 ? "" : "s"}</span>}
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close wishlist"><X aria-hidden="true" /></button>
        </header>
        {items.length === 0 ? (
          <div className="storefront-wishlist-empty">
            <Heart aria-hidden="true" />
            <p>Your wishlist is empty.</p>
            <button type="button" onClick={onClose}>Continue Shopping</button>
          </div>
        ) : (
          <div className="storefront-wishlist-items">
            {items.map((item) => (
              <article className="storefront-wishlist-item" key={item.productId}>
                <a className="storefront-wishlist-item-image" href={`/product/${item.productSlug}`} onClick={onClose}>
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <PackageOpen aria-hidden="true" />}
                </a>
                <div className="storefront-wishlist-item-details">
                  <a href={`/product/${item.productSlug}`} onClick={onClose}>{item.productTitle}</a>
                  <div>
                    <a className="storefront-wishlist-open" href={`/product/${item.productSlug}`} onClick={onClose}>View product <ArrowRight aria-hidden="true" /></a>
                    <button type="button" onClick={() => removeStorefrontWishlistItem(item.productId)}>Remove</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}

function Header({ taxonomy }: { taxonomy: Taxonomy }) {
  const [open, setOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [cartDrawerMounted, setCartDrawerMounted] = useState(false);
  const [wishlistDrawerOpen, setWishlistDrawerOpen] = useState(false);
  const [wishlistDrawerMounted, setWishlistDrawerMounted] = useState(false);
  const [cartQuantity, setCartQuantity] = useState(0);
  const [wishlistQuantity, setWishlistQuantity] = useState(0);
  const [cartFeedback, setCartFeedback] = useState("");
  const [accountFeedback, setAccountFeedback] = useState("");
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  const [searchPanelMounted, setSearchPanelMounted] = useState(false);
  const drawerMotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerFrame = useRef<number | null>(null);
  const cartDrawerMotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cartDrawerFrame = useRef<number | null>(null);
  const wishlistDrawerMotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wishlistDrawerFrame = useRef<number | null>(null);
  const searchPanelMotionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchPanelFrame = useRef<number | null>(null);
  const cartFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState(
    new URLSearchParams(location.search).get("q") ?? "",
  );
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    location.href = `/shop${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`;
  };
  const openDrawer = () => {
    if (drawerMotionTimer.current) clearTimeout(drawerMotionTimer.current);
    if (drawerFrame.current) cancelAnimationFrame(drawerFrame.current);
    setDrawerMounted(true);
    drawerFrame.current = requestAnimationFrame(() => {
      drawerFrame.current = requestAnimationFrame(() => setOpen(true));
    });
  };
  const closeDrawer = () => {
    if (drawerFrame.current) cancelAnimationFrame(drawerFrame.current);
    setOpen(false);
    if (drawerMotionTimer.current) clearTimeout(drawerMotionTimer.current);
    drawerMotionTimer.current = setTimeout(() => setDrawerMounted(false), 450);
  };
  const openCartDrawer = () => {
    if (cartDrawerMotionTimer.current) clearTimeout(cartDrawerMotionTimer.current);
    if (cartDrawerFrame.current) cancelAnimationFrame(cartDrawerFrame.current);
    setCartDrawerMounted(true);
    cartDrawerFrame.current = requestAnimationFrame(() => {
      cartDrawerFrame.current = requestAnimationFrame(() => setCartDrawerOpen(true));
    });
  };
  const closeCartDrawer = () => {
    if (cartDrawerFrame.current) cancelAnimationFrame(cartDrawerFrame.current);
    setCartDrawerOpen(false);
    if (cartDrawerMotionTimer.current) clearTimeout(cartDrawerMotionTimer.current);
    cartDrawerMotionTimer.current = setTimeout(() => setCartDrawerMounted(false), 340);
  };
  useEffect(() => {
    if (new URLSearchParams(location.search).get("cart") === "open") openCartDrawer();
  }, []);
  const openWishlistDrawer = () => {
    if (wishlistDrawerMotionTimer.current) clearTimeout(wishlistDrawerMotionTimer.current);
    if (wishlistDrawerFrame.current) cancelAnimationFrame(wishlistDrawerFrame.current);
    setWishlistDrawerMounted(true);
    wishlistDrawerFrame.current = requestAnimationFrame(() => {
      wishlistDrawerFrame.current = requestAnimationFrame(() => setWishlistDrawerOpen(true));
    });
  };
  const closeWishlistDrawer = () => {
    if (wishlistDrawerFrame.current) cancelAnimationFrame(wishlistDrawerFrame.current);
    setWishlistDrawerOpen(false);
    if (wishlistDrawerMotionTimer.current) clearTimeout(wishlistDrawerMotionTimer.current);
    wishlistDrawerMotionTimer.current = setTimeout(() => setWishlistDrawerMounted(false), 340);
  };
  const openDesktopSearch = () => {
    if (searchPanelMotionTimer.current) clearTimeout(searchPanelMotionTimer.current);
    if (searchPanelFrame.current) cancelAnimationFrame(searchPanelFrame.current);
    setSearchPanelMounted(true);
    searchPanelFrame.current = requestAnimationFrame(() => {
      searchPanelFrame.current = requestAnimationFrame(() => setDesktopSearchOpen(true));
    });
  };
  const closeSearchPanel = () => {
    if (searchPanelFrame.current) cancelAnimationFrame(searchPanelFrame.current);
    setDesktopSearchOpen(false);
    if (searchPanelMotionTimer.current) clearTimeout(searchPanelMotionTimer.current);
    searchPanelMotionTimer.current = setTimeout(() => setSearchPanelMounted(false), 330);
  };
  const showAccountFeedback = () => {
    setAccountFeedback("Customer accounts coming soon");
    if (accountFeedbackTimer.current) clearTimeout(accountFeedbackTimer.current);
    accountFeedbackTimer.current = setTimeout(() => setAccountFeedback(""), 2_500);
  };
  useEffect(() => {
    if (!drawerMounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerMounted]);
  useEffect(() => () => {
    if (drawerMotionTimer.current) clearTimeout(drawerMotionTimer.current);
    if (drawerFrame.current) cancelAnimationFrame(drawerFrame.current);
    if (cartDrawerMotionTimer.current) clearTimeout(cartDrawerMotionTimer.current);
    if (cartDrawerFrame.current) cancelAnimationFrame(cartDrawerFrame.current);
    if (wishlistDrawerMotionTimer.current) clearTimeout(wishlistDrawerMotionTimer.current);
    if (wishlistDrawerFrame.current) cancelAnimationFrame(wishlistDrawerFrame.current);
    if (searchPanelMotionTimer.current) clearTimeout(searchPanelMotionTimer.current);
    if (searchPanelFrame.current) cancelAnimationFrame(searchPanelFrame.current);
    if (cartFeedbackTimer.current) clearTimeout(cartFeedbackTimer.current);
    if (accountFeedbackTimer.current) clearTimeout(accountFeedbackTimer.current);
  }, []);
  useEffect(() => {
    const syncCartQuantity = () => setCartQuantity(storefrontCartTotalQuantity());
    const showCartFeedback = (event: Event) => {
      const title = (event as CustomEvent<{ title?: string }>).detail?.title;
      setCartFeedback(title ? `${title} added to cart` : "Added to cart");
      if (cartFeedbackTimer.current) clearTimeout(cartFeedbackTimer.current);
      cartFeedbackTimer.current = setTimeout(() => setCartFeedback(""), 2_500);
    };
    syncCartQuantity();
    window.addEventListener("isolutions:cart-updated", syncCartQuantity);
    window.addEventListener("isolutions:cart-feedback", showCartFeedback);
    return () => {
      window.removeEventListener("isolutions:cart-updated", syncCartQuantity);
      window.removeEventListener("isolutions:cart-feedback", showCartFeedback);
    };
  }, []);
  useEffect(() => {
    const syncWishlistQuantity = () => setWishlistQuantity(storefrontWishlistTotal());
    syncWishlistQuantity();
    window.addEventListener("isolutions:wishlist-updated", syncWishlistQuantity);
    return () => window.removeEventListener("isolutions:wishlist-updated", syncWishlistQuantity);
  }, []);
  const canonicalMenuLinks = (
    type: string,
    candidates: Array<{ label: string; slug: string; aliases?: string[] }>,
  ) => candidates.flatMap((candidate) => {
    const aliases = candidate.aliases ?? [candidate.slug];
    const exists = taxonomy.brands.some((brand) =>
      aliases.some((alias) =>
        [brand.slug, brand.name].some((value) =>
          value.toLowerCase().replace(/[^a-z0-9]+/g, "") ===
          alias.toLowerCase().replace(/[^a-z0-9]+/g, ""),
        ),
      ),
    );
    return exists ? [{
      label: candidate.label,
      href: `/collections/laptops-tablets?type=${type}&brand=${candidate.slug}`,
    }] : [];
  });
  return (
    <>
      <div
        className="trustbar"
        aria-label="Technology chosen for modern life. Product details you can trust. Premium devices for everyday use. Support you can rely on every day."
      >
        <div className="trust-ticker-track" aria-hidden="true">
          <div className="trust-ticker-group">
            <span>Technology chosen for modern life</span><i>•</i>
            <span>Product details you can trust</span><i>•</i>
            <span>Premium devices for everyday use</span><i>•</i>
            <span>Support you can rely on every day</span><i>•</i>
          </div>
          <div className="trust-ticker-group">
            <span>Technology chosen for modern life</span><i>•</i>
            <span>Product details you can trust</span><i>•</i>
            <span>Premium devices for everyday use</span><i>•</i>
            <span>Support you can rely on every day</span><i>•</i>
          </div>
        </div>
      </div>
      <header className="storefront-navbar">
        <a className="wordmark" href="/" aria-label="iSolutions Pakistan home">
          <img className="storefront-brand-logo" src="/assets/branding/isolutions-pakistan-logo-v2.png" alt="" />
          <span className="storefront-brand-name">
            <strong>iSolutions</strong> <span>Pakistan</span>
          </span>
        </a>

        <nav className="navbar-links" aria-label="Primary navigation">
          <a href="/" aria-current={location.pathname === "/" ? "page" : undefined}>Home</a>
          <NavbarMegaMenu
            label="Mobile Phones"
            href="/collections/mobile-phones"
            heading="Mobile Phones"
            links={[
              { label: "Samsung", href: "/collections/mobile-phones/samsung" },
              { label: "Infinix", href: "/collections/mobile-phones/infinix" },
              { label: "Oppo", href: "/collections/mobile-phones/oppo" },
              { label: "Vivo", href: "/collections/mobile-phones/vivo" },
              { label: "Tecno", href: "/collections/mobile-phones/tecno" },
              { label: "iPhone", href: "/collections/mobile-phones/iphone" },
            ]}
            promoImage="/assets/phone-main.jpg"
          />
          <NavbarMegaMenu
            label="Mobile Accessories"
            href="/collections/mobile-accessories"
            heading="Mobile Accessories"
            groups={[
              { heading: "Mobile Cases", href: "/collections/mobile-accessories?type=mobile-cases", links: [
                { label: "Apple", href: "/collections/mobile-accessories?type=mobile-cases&brand=apple" },
                { label: "Samsung", href: "/collections/mobile-accessories?type=mobile-cases&brand=samsung" },
              ] },
              { heading: "Chargers", href: "/collections/mobile-accessories?type=chargers", links: [
                { label: "Apple", href: "/collections/mobile-accessories?type=chargers&brand=apple" },
                { label: "Samsung", href: "/collections/mobile-accessories?type=chargers&brand=samsung" },
                { label: "Xiaomi", href: "/collections/mobile-accessories?type=chargers&brand=xiaomi" },
              ] },
              { heading: "Cables", href: "/collections/mobile-accessories?type=cables", links: [
                { label: "Apple", href: "/collections/mobile-accessories?type=cables&brand=apple" },
                { label: "Samsung", href: "/collections/mobile-accessories?type=cables&brand=samsung" },
                { label: "Xiaomi", href: "/collections/mobile-accessories?type=cables&brand=xiaomi" },
              ] },
              { heading: "Power Banks", href: "/collections/mobile-accessories?type=power-banks", links: [
                { label: "Apple", href: "/collections/mobile-accessories?type=power-banks&brand=apple" },
                { label: "Samsung", href: "/collections/mobile-accessories?type=power-banks&brand=samsung" },
                { label: "Xiaomi", href: "/collections/mobile-accessories?type=power-banks&brand=xiaomi" },
              ] },
              { heading: "Car Chargers", href: "/collections/mobile-accessories?type=car-chargers", links: [
                { label: "Xiaomi", href: "/collections/mobile-accessories?type=car-chargers&brand=xiaomi" },
              ] },
              { heading: "Audio", href: "/collections/mobile-accessories?type=audio", links: [
                { label: "Xiaomi", href: "/collections/mobile-accessories?type=audio&brand=xiaomi" },
                { label: "Apple", href: "/collections/mobile-accessories?type=audio&brand=apple" },
                { label: "JBL", href: "/collections/mobile-accessories?type=audio&brand=jbl" },
              ] },
              { heading: "PC Gadgets", href: "/collections/mobile-accessories?type=pc-gadgets", links: [
                { label: "Xiaomi", href: "/collections/mobile-accessories?type=pc-gadgets&brand=xiaomi" },
                { label: "Apple", href: "/collections/mobile-accessories?type=pc-gadgets&brand=apple" },
              ] },
            ]}
            promoImage="/assets/headphones.jpg"
            promoBackground="#FFCC00"
            promoFit="contain"
            promoWidth={300}
            promoHeight={200}
            showHeading={false}
          />
          <NavbarMegaMenu
            label="Laptops & Tablets"
            href="/collections/laptops-tablets"
            heading="Laptops & Tablets"
            groups={[
              { heading: "iPad", href: "/collections/laptops-tablets?type=ipad", links: canonicalMenuLinks("ipad", [
                { label: "Apple", slug: "apple", aliases: ["apple", "iphone"] },
              ]) },
              { heading: "Android Tablets", href: "/collections/laptops-tablets?type=android-tablets", links: canonicalMenuLinks("android-tablets", [
                { label: "Samsung", slug: "samsung" },
                { label: "Xiaomi", slug: "xiaomi" },
              ]) },
              { heading: "Laptops", href: "/collections/laptops-tablets?type=laptops", links: canonicalMenuLinks("laptops", [
                { label: "Apple", slug: "apple", aliases: ["apple", "iphone"] },
                { label: "Acer", slug: "acer" },
                { label: "HP", slug: "hp" },
                { label: "Dell", slug: "dell" },
                { label: "Lenovo", slug: "lenovo" },
              ]) },
            ]}
            promoImage="/assets/studio-laptop.jpg"
            promoFit="contain"
            promoWidth={300}
            promoHeight={200}
            showHeading={false}
            groupColumns={3}
          />
          <NavbarMegaMenu
            label="Home Gadgets"
            href="/collections/home-gadgets"
            heading="Home Gadgets"
            groups={[
              { heading: "Smart Home", href: "/collections/home-gadgets?type=smart-home", links: [] },
              { heading: "Routers", href: "/collections/home-gadgets?type=routers", links: [] },
              { heading: "Cameras", href: "/collections/home-gadgets?type=cameras", links: [] },
              { heading: "Home Appliances", href: "/collections/home-gadgets?type=home-appliances", links: [] },
              { heading: "Personal Care", href: "/collections/home-gadgets?type=personal-care", links: [] },
              { heading: "Smart TVs", href: "/collections/home-gadgets?type=smart-tvs", links: [] },
            ]}
            promoImage="/assets/home-gadgets.png"
            promoFit="contain"
            promoWidth={300}
            promoHeight={200}
            showHeading={false}

            groupColumns={6}
            groupColumnGap={56}
          />
          <a className="navbar-deals" href="/collections/deals" aria-current={location.pathname === "/collections/deals" ? "page" : undefined}><span aria-hidden="true">🔥</span>Deals</a>
        </nav>

        <div className="navbar-actions" aria-label="Storefront actions">
          <button type="button" className="navbar-search-button" onClick={openDesktopSearch} aria-label="Search products" aria-expanded={desktopSearchOpen}>
            <Search />
          </button>
          <button type="button" className="navbar-wishlist-button" onClick={openWishlistDrawer} aria-label={wishlistQuantity ? `Wishlist, ${wishlistQuantity} items` : "Wishlist"}>
            <Heart />
            {wishlistQuantity > 0 && <span className="navbar-wishlist-count" aria-hidden="true">{wishlistQuantity > 99 ? "99+" : wishlistQuantity}</span>}
          </button>
          <button type="button" className="navbar-cart-button" onClick={openCartDrawer} aria-label={cartQuantity ? `Cart, ${cartQuantity} items` : "Cart"}>
            <ShoppingCart />
            {cartQuantity > 0 && <span className="navbar-cart-count" aria-hidden="true">{cartQuantity > 99 ? "99+" : cartQuantity}</span>}
          </button>
          <button type="button" onClick={showAccountFeedback} aria-label="Customer accounts coming soon">
            <User />
          </button>
        </div>

        <div className="mobile-header-left-actions">
          <button
            className="menu"
            onClick={openDrawer}
            aria-label="Open menu"
          >
            <Menu />
          </button>
          <button className="mobile-search-trigger" type="button" onClick={openDesktopSearch} aria-label="Search products">
            <Search />
          </button>
        </div>

        <form className="search mobile-header-search" onSubmit={submit}>
          <Search size={18} />
          <input
            aria-label="Search products"
            value={search}
            onFocus={openDesktopSearch}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products brands and categories"
          />
        </form>
      </header>
      {searchPanelMounted && <StorefrontSearchPanel open={desktopSearchOpen} initialQuery={search} onClose={closeSearchPanel} onSearch={(term) => { setSearch(term); location.href = `/shop${term ? `?q=${encodeURIComponent(term)}` : ""}`; }} />}
      {cartFeedback && (
        <div className="storefront-cart-feedback" role="status" aria-live="polite">
          <ShoppingCart aria-hidden="true" />
          <span>{cartFeedback}</span>
        </div>
      )}
      {accountFeedback && <div className="storefront-account-feedback" role="status">{accountFeedback}</div>}
      {cartDrawerMounted && <StorefrontCartDrawer open={cartDrawerOpen} onClose={closeCartDrawer} />}
      {wishlistDrawerMounted && <StorefrontWishlistDrawer open={wishlistDrawerOpen} onClose={closeWishlistDrawer} />}
      {drawerMounted && (
        <>
        <button className={`drawer-backdrop${open ? " is-open" : ""}`} type="button" onClick={closeDrawer} aria-label="Close menu" />
        <aside className={`drawer${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-hidden={!open} aria-label="Storefront navigation">
          <div className="drawer-head">
            <span className="wordmark">
              <img className="storefront-brand-logo" src="/assets/branding/isolutions-pakistan-logo-v2.png" alt="iSolutions Pakistan" />
              <span className="storefront-brand-name">
                <strong>iSolutions</strong> <span>Pakistan</span>
              </span>
            </span>
            <button onClick={closeDrawer} aria-label="Close menu">
              <X />
            </button>
          </div>
          <div className="drawer-scroll-area">
            <a className="drawer-promo" href="/collections/mobile-phones/samsung" aria-label="Shop Samsung mobile phones">
              <img src="/assets/banners/banner-samsung-galaxy-s26-ultra-desktop.png" alt="Samsung Galaxy S26 Ultra" />
            </a>

            <form className="mobile-search search" onSubmit={submit}>
              <Search aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the catalog"
                aria-label="Search products"
              />
            </form>

            <a className="drawer-deals" href="/collections/deals">
              <span className="drawer-deals-icon" aria-hidden="true">🔥</span>
              <span><strong>Deals</strong><small>View latest offers</small></span>
              <ArrowRight aria-hidden="true" />
            </a>

            <section className="drawer-section" aria-labelledby="drawer-categories-title">
              <h2 id="drawer-categories-title">Categories</h2>
              <nav className="drawer-collection-nav" aria-label="Product categories">
                <DrawerCategory label="Mobile Phones" icon={Smartphone}>
                  <a href="/collections/mobile-phones">All mobile phones</a>
                  {primaryMobileBrands.map((brand) => (
                    <a href={`/collections/mobile-phones/${brand.slug}`} key={brand.slug}>{brand.label}</a>
                  ))}
                </DrawerCategory>
                <DrawerCategory label="Mobile Accessories" icon={Cable}>
                  <a href="/collections/mobile-accessories">All mobile accessories</a>
                  <a href="/collections/mobile-accessories?type=mobile-cases">Mobile Cases</a>
                  <a href="/collections/mobile-accessories?type=chargers">Chargers</a>
                  <a href="/collections/mobile-accessories?type=cables">Cables</a>
                  <a href="/collections/mobile-accessories?type=power-banks">Power Banks</a>
                  <a href="/collections/mobile-accessories?type=car-chargers">Car Chargers</a>
                  <a href="/collections/mobile-accessories?type=audio">Audio</a>
                  <a href="/collections/mobile-accessories?type=pc-gadgets">PC Gadgets</a>
                </DrawerCategory>
                <DrawerCategory label="Laptops &amp; Tablets" icon={Laptop}>
                  <a href="/collections/laptops-tablets">All laptops &amp; tablets</a>
                  <a href="/collections/laptops-tablets?type=ipad">iPad</a>
                  <a href="/collections/laptops-tablets?type=android-tablets">Android Tablets</a>
                  <a href="/collections/laptops-tablets?type=laptops">Laptops</a>
                </DrawerCategory>
                <DrawerCategory label="Home Gadgets" icon={House}>
                  <a href="/collections/home-gadgets">All home gadgets</a>
                  <a href="/collections/home-gadgets?type=smart-home">Smart Home</a>
                  <a href="/collections/home-gadgets?type=routers">Routers</a>
                  <a href="/collections/home-gadgets?type=cameras">Cameras</a>
                  <a href="/collections/home-gadgets?type=home-appliances">Home Appliances</a>
                  <a href="/collections/home-gadgets?type=personal-care">Personal Care</a>
                  <a href="/collections/home-gadgets?type=smart-tvs">Smart TVs</a>
                </DrawerCategory>
              </nav>
            </section>

            <section className="drawer-section drawer-utility" aria-labelledby="drawer-support-title">
              <h2 id="drawer-support-title">Support</h2>
              <nav aria-label="Customer support">
                <a href="/shipping-cancellation-policy"><FileText aria-hidden="true" />Shipping &amp; Cancellation Policy<ChevronRight aria-hidden="true" /></a>
                <a href="/contact"><Mail aria-hidden="true" />Contact Us<ChevronRight aria-hidden="true" /></a>
                <a href="/about"><Info aria-hidden="true" />About iSolutions<ChevronRight aria-hidden="true" /></a>
              </nav>
            </section>

          </div>
        </aside>
        </>
      )}
    </>
  );
}

function Footer() {
  const footerBrandSlugs = new Set(["apple", "samsung", "xiaomi", "motorola", "honor", "nothing"]);
  const exploreBrands = homepageBrands.filter((brand) => footerBrandSlugs.has(brand.slug));
  const customerCareItems = ["My Account", "Contact Us", "How to Order", "FAQs"];
  const paymentMethods = [
    { title: "Credit / Debit Card", src: "/assets/payment-methods/credit-debit-card.svg" },
    { title: "Bank Transfer", src: "/assets/payment-methods/bank-transfer.svg" },
    { title: "Cash on Delivery", src: "/assets/payment-methods/cash-on-delivery.svg" },
    { title: "Installments", src: "/assets/payment-methods/installments.svg" },
  ] as const;

  return (
    <footer className="storefront-footer">
      <div className="storefront-footer-inner">
        <section className="storefront-footer-newsletter" aria-labelledby="footer-newsletter-title">
          <div>
            <h2 id="footer-newsletter-title">Stay updated with iSolutions Pakistan</h2>
            <p>Get product updates, offers and important announcements.</p>
          </div>
          <form onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="storefront-footer-email">Email address</label>
            <input id="storefront-footer-email" type="email" placeholder="Enter your email address" autoComplete="email" />
            <button type="submit" disabled aria-describedby="storefront-footer-newsletter-note">Subscribe</button>
            <span id="storefront-footer-newsletter-note">Subscriptions coming soon.</span>
          </form>
        </section>

        <div className="storefront-footer-grid">
          <section className="storefront-footer-brand" aria-label="iSolutions Pakistan">
            <a className="wordmark" href="/" aria-label="iSolutions Pakistan home">
              <img className="storefront-brand-logo" src="/assets/branding/isolutions-pakistan-logo-v2.png" alt="" />
            </a>
            <address>Karachi, Pakistan</address>
            <a className="storefront-footer-contact" href={storefrontContact.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp: {storefrontContact.phoneDisplay}</a>
            <p>Product guidance available before you buy.</p>
          </section>

          <nav className="storefront-footer-links" aria-labelledby="footer-explore-title">
            <h2 id="footer-explore-title">Explore More</h2>
            {exploreBrands.map((brand) => (
              <a href={`/shop?brand=${encodeURIComponent(brand.slug)}`} key={brand.slug}>{brand.name}</a>
            ))}
          </nav>

          <nav className="storefront-footer-links" aria-labelledby="footer-care-title">
            <h2 id="footer-care-title">Customer Care</h2>
            <span>{customerCareItems[0]}</span>
            <a href="/contact">Contact Us</a>
            <a href="/about">About Us</a>
            <a href="/how-to-order">How to Order</a>
            <a href="/faqs">FAQs</a>
          </nav>

          <nav className="storefront-footer-links" aria-labelledby="footer-policies-title">
            <h2 id="footer-policies-title">Policies</h2>
            <a href="/shipping-cancellation-policy">Shipping &amp; Cancellation Policy</a>
            <a href="/return-policy">Return Policy</a>
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms-and-conditions">Terms &amp; Conditions</a>
          </nav>

          <section className="storefront-footer-connect" aria-label="Social media and payment methods">
            <div>
              <h2>Follow Us On</h2>
              <div className="storefront-footer-socials">
                <a href="https://www.facebook.com/isolutionPakistan/" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8.5V6.8c0-.8.5-1 1-1h2.8V2.2L15.1 2C11.8 2 10 4 10 6.5v2H7v4h3V22h4v-9.5h3.4l.6-4H14Z" /></svg>
                </a>
                <a href="https://www.instagram.com/isolutionspakistan" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.1" /><circle cx="17.4" cy="6.7" r="1" className="is-filled" /></svg>
                </a>
                <a href="https://www.youtube.com/@iSolutionOfficial" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8.1a3 3 0 0 0-2.1-2.2C17 5.4 12 5.4 12 5.4s-5 0-6.9.5A3 3 0 0 0 3 8.1a31 31 0 0 0-.5 3.9 31 31 0 0 0 .5 3.9 3 3 0 0 0 2.1 2.2c1.9.5 6.9.5 6.9.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.2 31 31 0 0 0 .5-3.9 31 31 0 0 0-.5-3.9Z" /><path d="m10 15.2 5-3.2-5-3.2v6.4Z" className="is-filled" /></svg>
                </a>
                <a href="https://www.tiktok.com/@isolution_pakistan" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3c.4 2.2 1.7 3.6 4 4v3.5a8.3 8.3 0 0 1-4-1.3V16a6 6 0 1 1-5-5.9v3.7a2.5 2.5 0 1 0 1.5 2.2V3H15Z" /></svg>
                </a>
              </div>
            </div>
            <div className="storefront-footer-payments">
              <h2>Payment Methods</h2>
              <div>
                {paymentMethods.map((method) => (
                  <span className="storefront-payment-badge" key={method.title}>
                    <img src={method.src} alt={method.title} />
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className="storefront-footer-about" aria-labelledby="footer-about-title">
          <h2 id="footer-about-title">About iSolutions Pakistan</h2>
          <p>Explore technology with clear product details, availability information and thoughtful guidance before you buy.</p>
        </section>

        <div className="storefront-footer-bottom">
          <span>© 2026 iSolutions Pakistan. All rights reserved.</span>
          <span>Powered by <strong>GrowthifyEdge</strong></span>
        </div>
      </div>
    </footer>
  );
}

function Layout({
  children,
  taxonomy,
}: {
  children: React.ReactNode;
  taxonomy: Taxonomy;
}) {
  return (
    <>
      <Header taxonomy={taxonomy} />
      <main>{children}</main>
      <Footer />
      <a
        className="storefront-whatsapp-contact"
        href={storefrontContact.whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with iSolutions Pakistan on WhatsApp"
      >
        <span className="storefront-whatsapp-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <path d="M16 3.2A12.72 12.72 0 0 0 5.16 22.58L3.35 28.65l6.22-1.75A12.8 12.8 0 1 0 16 3.2Zm0 23.28c-2.08 0-4.1-.56-5.87-1.62l-.42-.25-3.69 1.04 1.07-3.59-.27-.43A10.63 10.63 0 1 1 16 26.48Zm5.83-7.97c-.32-.16-1.9-.94-2.19-1.05-.3-.1-.52-.16-.74.16-.22.32-.85 1.05-1.04 1.26-.19.21-.38.24-.7.08a8.76 8.76 0 0 1-2.58-1.59 9.72 9.72 0 0 1-1.8-2.24c-.19-.32-.02-.49.14-.64.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.74-1.78-1.01-2.44-.27-.64-.54-.55-.74-.56h-.63c-.22 0-.57.08-.87.4-.3.32-1.14 1.11-1.14 2.71s1.17 3.15 1.33 3.37c.16.21 2.29 3.5 5.54 4.91.77.33 1.38.53 1.85.68.78.25 1.49.21 2.05.13.63-.1 1.9-.78 2.16-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37Z" />
          </svg>
        </span>
        <span className="storefront-whatsapp-label" aria-hidden="true">Chat with us</span>
      </a>
    </>
  );
}

function CatalogEmpty({
  title = "No published products yet.",
}: {
  title?: string;
}) {
  return (
    <div className="catalog-empty">
      <span className="eyebrow accent">REAL CATALOG</span>
      <h2>{title}</h2>
      <p>
        Our latest selection is being prepared. Please check back shortly.
      </p>
    </div>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  const media = primaryMedia(product);
  const pricedVariant = [...product.variants]
    .sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const price = pricedVariant?.priceMinor ?? productPrice(product);
  const compareAt = pricedVariant ? validCompareAt(pricedVariant) : null;
  const inStock = product.variants.some((variant) => variant.quantity > 0);
  return (
    <article className="product-card">
      <a className="product-image" href={`/product/${product.slug}`}>
        {media ? (
          <img
            src={cloudinaryDeliveryUrl(media.publicId, 800, { trim: true }) || media.url}
            alt={media.alt}
          />
        ) : null}
        <button aria-label={`Save ${product.title}`} className="save">
          <Heart size={18} />
        </button>
      </a>
      <div className="product-copy">
        <span className="eyebrow">
          {product.brand ? `${product.brand.name} · ` : ""}{product.category.name}
        </span>
        <h3>
          <a href={`/product/${product.slug}`}>{product.title}</a>
        </h3>
        <p className="detail">
          {product.short_description ?? "View verified product details"}
        </p>
        <div className="price">
          {price !== null && (
            <strong>
              {hasVariablePrice(product)
                ? `From ${formatPkrMinor(price)}`
                : formatPkrMinor(price)}
            </strong>
          )}
          {compareAt !== null && <del>{formatPkrMinor(compareAt)}</del>}
        </div>
        <div className="status">
          <span className={`dot${inStock ? "" : " unavailable"}`} />
          {inStock ? "In stock" : "Out of stock"}
        </div>
      </div>
    </article>
  );
}

type HomeHeroSlide = {
  desktopSrc: string;
  mobileSrc?: string;
  alt: string;
};

const homeHeroSlides: readonly HomeHeroSlide[] = [
  {
    desktopSrc: "/assets/banners/banner-apple-01-desktop.png",
    mobileSrc: "/assets/banners/banner-apple-01-mobile.png",
    alt: "Apple products banner",
  },
  {
    desktopSrc: "/assets/banners/banner-redmi-note-15-pro-desktop.png",
    mobileSrc: "/assets/banners/banner-redmi-note-15-pro-mobile.png",
    alt: "Redmi Note 15 Pro banner",
  },
  {
    desktopSrc: "/assets/banners/banner-tecno-camon-50-pro-desktop-v2.png",
    mobileSrc: "/assets/banners/banner-tecno-camon-50-pro-mobile.png",
    alt: "Tecno Camon 50 Pro banner",
  },
  {
    desktopSrc: "/assets/banners/banner-samsung-galaxy-s26-ultra-desktop.png",
    mobileSrc: "/assets/banners/banner-samsung-galaxy-s26-ultra-mobile.png",
    alt: "Samsung Galaxy S26 Ultra banner",
  },
  {
    desktopSrc: "/assets/banners/banner-xiaomi-tv-a-series-2026-desktop.png",
    mobileSrc: "/assets/banners/banner-xiaomi-tv-a-series-2026-mobile.png",
    alt: "Xiaomi TV A Series 2026 banner",
  },
  {
    desktopSrc: "/assets/banners/banner-xiaomi-eco-accessories-desktop.png",
    mobileSrc: "/assets/banners/banner-xiaomi-eco-accessories-mobile.png",
    alt: "Xiaomi ecosystem accessories banner",
  },
  {
    desktopSrc: "/assets/banners/banner-iphone-18-pro-max-desktop.png",
    mobileSrc: "/assets/banners/banner-iphone-18-pro-max-mobile.png",
    alt: "iPhone 18 Pro Max banner",
  },
] as const;

function HomeHeroCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const pointerStartX = useRef<number | null>(null);

  useEffect(() => {
    if (isPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      setActiveSlide((current) => (current + 1) % homeHeroSlides.length);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [activeSlide, isPaused]);

  const showPrevious = () => {
    setActiveSlide((current) => (current - 1 + homeHeroSlides.length) % homeHeroSlides.length);
  };
  const showNext = () => {
    setActiveSlide((current) => (current + 1) % homeHeroSlides.length);
  };
  const finishSwipe = (clientX: number) => {
    if (pointerStartX.current === null) return;
    const distance = clientX - pointerStartX.current;
    pointerStartX.current = null;
    if (Math.abs(distance) < 45) return;
    if (distance > 0) showPrevious();
    else showNext();
  };

  return (
    <section
      className="home-banner-carousel"
      aria-roledescription="carousel"
      aria-label="Featured products"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsPaused(false);
      }}
      onPointerDown={(event) => { pointerStartX.current = event.clientX; }}
      onPointerUp={(event) => finishSwipe(event.clientX)}
      onPointerCancel={() => { pointerStartX.current = null; }}
    >
      <div className="home-banner-track">
        {homeHeroSlides.map((slide, index) => (
          <div
            className={`home-banner-slide${index === activeSlide ? " is-active" : ""}`}
            aria-hidden={index !== activeSlide}
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${homeHeroSlides.length}`}
            key={`${slide.desktopSrc}-${index}`}
          >
            <picture>
              {slide.mobileSrc ? <source media="(max-width: 600px)" srcSet={slide.mobileSrc} /> : null}
              <img src={slide.desktopSrc} alt={index === activeSlide ? slide.alt : ""} loading={index === 0 ? "eager" : "lazy"} draggable="false" />
            </picture>
          </div>
        ))}
      </div>
      <button className="home-banner-arrow is-previous" type="button" onClick={showPrevious} aria-label="Previous banner">
        <ChevronLeft aria-hidden="true" />
      </button>
      <button className="home-banner-arrow is-next" type="button" onClick={showNext} aria-label="Next banner">
        <ChevronRight aria-hidden="true" />
      </button>
      <div className="home-banner-dots" aria-label="Choose banner slide">
        {homeHeroSlides.map((slide, index) => (
          <button
            className={index === activeSlide ? "is-active" : ""}
            type="button"
            onClick={() => setActiveSlide(index)}
            aria-label={`Show banner ${index + 1}`}
            aria-current={index === activeSlide ? "true" : undefined}
            key={`${slide.mobileSrc ?? slide.desktopSrc}-${index}`}
          />
        ))}
      </div>
    </section>
  );
}

const homepageTrustBenefits = [
  { title: "Warranty", subtitle: "Warranty Clearly Mentioned", icon: ShieldCheck, animation: "is-warranty" },
  { title: "COD", subtitle: "Cash On Delivery", icon: Truck, animation: "is-cod" },
  { title: "PTA Status", subtitle: "Clearly Mentioned", icon: BadgeCheck, animation: "is-pta" },
] as const;

function HomepageTrustBenefits() {
  return (
    <section className="home-trust-benefits" aria-label="Shopping information">
      {homepageTrustBenefits.map((benefit) => {
        const Icon = benefit.icon;
        return (
          <article className={`home-trust-benefit ${benefit.animation}`} key={benefit.title}>
            <span className="home-trust-benefit-icon" aria-hidden="true"><Icon /></span>
            <span className="home-trust-benefit-copy">
              <strong>{benefit.title}</strong>
              <small>{benefit.subtitle}</small>
            </span>
          </article>
        );
      })}
    </section>
  );
}

function Home({ taxonomy }: { taxonomy: Taxonomy }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [bundles, setBundles] = useState<HomepageBundle[]>([]);
  const [bundlesLoading, setBundlesLoading] = useState(true);
  const [featuredProducts, setFeaturedProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchPublicCatalog({ limit: 100 })
      .then(setProducts)
      .catch(() => setError("The published catalog is temporarily unavailable."))
      .finally(() => setLoading(false));
  }, []);
  const dealProducts = products.filter((product) => product.is_flash_sale === true);
  useEffect(() => {
    // Dedicated server-side read: any eligible featured product qualifies regardless of age.
    fetchHomepageFeaturedProducts()
      .then(setFeaturedProducts)
      .catch(() => setFeaturedProducts([]));
  }, []);
  useEffect(() => {
    fetchHomepageBundles(4)
      .then(setBundles)
      .catch(() => setBundles([]))
      .finally(() => setBundlesLoading(false));
  }, []);
  return (
    <Layout taxonomy={taxonomy}>
      <div className="home-page">
        <HomeHeroCarousel />
        <HomepageTrustBenefits />
        <ShopByCategory />
        <FlashSale products={dealProducts} loading={loading} />
        {featuredProducts.length > 0 && <FeaturedProducts products={featuredProducts} />}
        <AccessoriesSection taxonomy={taxonomy} />
        <BundleOffers bundles={bundles} products={products} loading={bundlesLoading} />
        <BestSellerSection products={products} loading={loading} />
        <ShopByPrice />
        <ShopByBrands />
        <CustomerReviewsIntro />
        <CustomerReviewsCarousel />
        <section className="home-arrivals home-best-sellers">
          <div className="home-arrivals-head">
            <div><span className="eyebrow accent">JUST IN</span><h2>New arrivals.</h2></div>
            <a href="/shop">View the complete collection <ArrowRight /></a>
          </div>
          <div className="home-accessories-grid">
            {products.slice(0, 2).map((product) => (
              <AccessoryProductCard product={product} key={product.id} />
            ))}
          </div>
          {!loading && !error && products.length === 0 && <CatalogEmpty />}
          {error && <CatalogEmpty title={error} />}
        </section>
        <HomepageAbout />
      </div>
    </Layout>
  );
}
const homepageCategories: ReadonlyArray<{ label: string; href: string; image?: string }> = [
  { label: "iPhone New", href: "/collections/mobile-phones/iphone/new", image: "/assets/categories/iphone-new-v2.png" },
  { label: "iPhone Used", href: "/collections/mobile-phones/iphone/used", image: "/assets/categories/iphone-used-v2.png" },
  { label: "Android Phones", href: "/collections/mobile-phones/android", image: "/assets/categories/android-phones-v2.png" },
  { label: "MacBook", href: "/collections/macbook", image: "/assets/categories/macbook-v2.png" },
  { label: "iPad & Tablets", href: "/collections/laptops-tablets", image: "/assets/categories/ipad-tablets-v2.png" },
  { label: "Mobile Cases", href: "/collections/mobile-accessories?type=mobile-cases", image: "/assets/categories/mobile-cases-v2.png" },
  { label: "Chargers", href: "/collections/mobile-accessories?type=chargers", image: "/assets/categories/chargers-v2.png" },
  { label: "Cables", href: "/collections/mobile-accessories?type=cables", image: "/assets/categories/cables-v2.png" },
  { label: "Power Banks", href: "/collections/mobile-accessories?type=power-banks", image: "/assets/categories/power-banks-v2.png" },
  { label: "Audio & Earbuds", href: "/collections/mobile-accessories?type=audio", image: "/assets/categories/audio-earbuds-v2.png" },
  { label: "Smart Watches & Bands", href: "/collections/home-gadgets?type=smart-watches-bands", image: "/assets/categories/smart-watches-bands-v2.png" },
  { label: "Home Gadgets", href: "/collections/home-gadgets", image: "/assets/categories/home-gadgets.png" },
] as const;

function HomepageProductActions({ product }: { product: CatalogProduct }) {
  const defaultVariant = product.variants.length === 1 ? product.variants[0] : null;
  const inStock = product.variants.some((variant) => variant.quantity > 0);
  const needsOptions = product.variants.length > 1;
  const media = primaryMedia(product);
  const unavailable = !inStock;

  const addOrChooseProduct = () => {
    if (unavailable) return;
    if (needsOptions) {
      window.location.assign(`/product/${product.slug}`);
      return;
    }
    if (!defaultVariant) return;
    const currentQuantity = storefrontCartItemQuantity(defaultVariant.id);
    const nextQuantity = addStorefrontCartItem({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      variantId: defaultVariant.id,
      sku: defaultVariant.sku,
      quantity: 1,
      priceMinor: defaultVariant.priceMinor,
      imageUrl: media ? cloudinaryDeliveryUrl(media.publicId, 320) || media.url : null,
    }, defaultVariant.quantity);
    if (nextQuantity > currentQuantity) {
      window.dispatchEvent(new CustomEvent("isolutions:cart-feedback", {
        detail: { title: product.title },
      }));
    }
  };

  return (
    <>
      <button
        type="button"
        className={`home-product-cart-button${unavailable ? " is-unavailable" : ""}${needsOptions ? " needs-options" : ""}`}
        disabled={unavailable}
        onClick={addOrChooseProduct}
        aria-label={unavailable ? `${product.title} is out of stock` : needsOptions ? `Choose options for ${product.title}` : `Add ${product.title} to cart`}
        title={unavailable ? "Out of stock" : needsOptions ? "Choose options" : "Add to cart"}
      >
        <ShoppingCart aria-hidden="true" />
      </button>
      <div className="home-product-card-actions">
        <button type="button" className="home-product-add-action" disabled={unavailable} onClick={addOrChooseProduct}>
          <ShoppingCart aria-hidden="true" />{needsOptions ? "Choose options" : "Add to cart"}
        </button>
        <button type="button" className="home-product-buy-action" disabled={unavailable} onClick={addOrChooseProduct}>
          Buy it now
        </button>
      </div>
    </>
  );
}

function FlashSaleCard({ product }: { product: CatalogProduct }) {
  const dealVariants = product.variants
    .filter((variant) => validCompareAt(variant) !== null)
    .sort((left, right) => left.priceMinor - right.priceMinor);
  const variant = dealVariants[0] ?? [...product.variants].sort(
    (left, right) => left.priceMinor - right.priceMinor,
  )[0];
  const compareAt = variant ? validCompareAt(variant) : null;
  if (!variant) return null;
  const discount = compareAt
    ? Math.round(((compareAt - variant.priceMinor) / compareAt) * 100)
    : null;
  const stockVariants = dealVariants.length > 0 ? dealVariants : product.variants;
  const inStock = stockVariants.some((item) => item.quantity > 0);
  const media = primaryMedia(product);
  const secondaryMedia = media
    ? product.media.find((item) => item.id !== media.id && Boolean(item.publicId || item.url)) ?? null
    : null;

  return (
    <article className="home-flash-card">
      <div className={`home-flash-image${secondaryMedia ? " has-secondary" : ""}`}>
        <a className="home-flash-image-link" href={`/product/${product.slug}`} aria-label={`View ${product.title}`}>
        {media && (
          <img
            className="home-flash-image-primary"
            src={cloudinaryDeliveryUrl(media.publicId, 600) || media.url}
            alt={media.alt}
            loading="lazy"
          />
        )}
        {secondaryMedia && (
          <img
            className="home-flash-image-secondary"
            src={cloudinaryDeliveryUrl(secondaryMedia.publicId, 600) || secondaryMedia.url}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        )}
        {discount !== null && <span className="home-flash-badge">-{discount}%</span>}
        {!inStock && <span className="home-flash-sold-out">Sold Out</span>}
        </a>
        <HomepageProductActions product={product} />
      </div>
      <a className="home-flash-copy" href={`/product/${product.slug}`}>
        <span className="home-flash-brand">{product.brand?.name ?? "No brand"}</span>
        <strong>{product.title}</strong>
        <span className="home-flash-price">
          <b>{formatPkrMinor(variant.priceMinor)}</b>
          {compareAt !== null && <del>{formatPkrMinor(compareAt)}</del>}
        </span>
        <span className={`home-flash-status${inStock ? "" : " unavailable"}`}>
          <i />{inStock ? "In stock" : "Out of stock"}
        </span>
      </a>
    </article>
  );
}

function FlashSale({ products, loading }: { products: CatalogProduct[]; loading: boolean }) {
  const visibleDeals = products.slice(0, 4);
  return (
    <section className="home-flash-sale" aria-labelledby="flash-sale-title">
      <div className="home-flash-head">
        <div className="home-flash-title-group">
          <span className="home-flash-icon" aria-hidden="true"><Zap /></span>
          <div>
            <h2 id="flash-sale-title">Flash Sale</h2>
            <p>Don&apos;t miss out on these deals!</p>
          </div>
        </div>
        <FlashSaleCountdown />
      </div>
      {loading ? (
        <div className="home-flash-empty"><p>Checking current offers…</p></div>
      ) : visibleDeals.length > 0 ? (
        <div className="home-flash-grid">
          {visibleDeals.map((product) => <FlashSaleCard product={product} key={product.id} />)}
        </div>
      ) : (
        <div className="home-flash-empty">
          <p>No flash deals are available right now.</p>
          <a href="/shop">View all products <ArrowRight /></a>
        </div>
      )}
      {visibleDeals.length > 0 && <a className="home-flash-view-all" href="/collections/deals">View All</a>}
    </section>
  );
}
const featuredPromoImage = "/assets/home-gadgets.png";

function FeaturedProductCard({ product }: { product: CatalogProduct }) {
  const variant = [...product.variants].sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const compareAt = variant ? validCompareAt(variant) : null;
  const discount = variant && compareAt
    ? Math.round(((compareAt - variant.priceMinor) / compareAt) * 100)
    : null;
  const inStock = product.variants.some((item) => item.quantity > 0);
  const media = primaryMedia(product);
  const secondaryMedia = media
    ? product.media.find((item) => item.id !== media.id && Boolean(item.publicId || item.url)) ?? null
    : null;

  return (
    <article className="home-featured-card">
      <div className={`home-featured-image${secondaryMedia ? " has-secondary" : ""}`}>
        <a className="home-featured-image-link" href={`/product/${product.slug}`} aria-label={`View ${product.title}`}>
        {media && (
          <img
            className="home-featured-image-primary"
            src={cloudinaryDeliveryUrl(media.publicId, 520) || media.url}
            alt={media.alt}
            loading="lazy"
          />
        )}
        {secondaryMedia && (
          <img
            className="home-featured-image-secondary"
            src={cloudinaryDeliveryUrl(secondaryMedia.publicId, 520) || secondaryMedia.url}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        )}
        {compareAt && <span className="home-featured-sale">Sale{discount ? ` · ${discount}%` : ""}</span>}
        {!inStock && <span className="home-featured-sold-out">Sold Out</span>}
        </a>
        <HomepageProductActions product={product} />
      </div>
      <a className="home-featured-copy" href={`/product/${product.slug}`}>
        <span>{product.brand?.name ?? "No brand"}</span>
        <strong>{product.title}</strong>
        {variant && (
          <span className="home-featured-price">
            <b>{formatPkrMinor(variant.priceMinor)}</b>
            {compareAt && <del>{formatPkrMinor(compareAt)}</del>}
          </span>
        )}
        <span className={`home-featured-availability${inStock ? "" : " unavailable"}`}>
          <i />{inStock ? "In stock" : "Out of stock"}
        </span>
      </a>
    </article>
  );
}

function FeaturedProducts({ products }: { products: CatalogProduct[] }) {
  return (
    <section className="home-featured-split" aria-labelledby="featured-products-title">
      <div className="home-featured-promo">
        <img src={featuredPromoImage} alt="Smart-home technology for modern living" loading="lazy" />
      </div>
      <div className="home-featured-products">
        <div className="home-featured-head">
          <div>
            <h2 id="featured-products-title">Featured Products</h2>
            <p>Handpicked technology worth exploring</p>
          </div>
          <a href="/shop">View All</a>
        </div>
        <div className="home-featured-grid">
          {products.map((product) => <FeaturedProductCard product={product} key={product.id} />)}
        </div>
      </div>
    </section>
  );
}
type AccessoryBrandTab = "all" | "apple" | "samsung" | "xiaomi";

const accessoryBrandTabs: ReadonlyArray<{ label: string; value: AccessoryBrandTab }> = [
  { label: "All", value: "all" },
  { label: "Apple", value: "apple" },
  { label: "Samsung", value: "samsung" },
  { label: "Xiaomi", value: "xiaomi" },
];

function AccessoryProductCard({ product }: { product: CatalogProduct }) {
  const variant = [...product.variants].sort((left, right) => left.priceMinor - right.priceMinor)[0];
  const compareAt = variant ? validCompareAt(variant) : null;
  const discount = variant && compareAt
    ? Math.round(((compareAt - variant.priceMinor) / compareAt) * 100)
    : null;
  const inStock = product.variants.some((item) => item.quantity > 0);
  const media = primaryMedia(product);
  const secondaryMedia = media
    ? product.media.find((item) => item.id !== media.id && Boolean(item.publicId || item.url)) ?? null
    : null;

  return (
    <article className="home-accessory-card">
      <div className={`home-accessory-image${secondaryMedia ? " has-secondary" : ""}`}>
        <a className="home-accessory-image-link" href={`/product/${product.slug}`} aria-label={`View ${product.title}`}>
        {media && (
          <img
            className="home-accessory-image-primary"
            src={cloudinaryDeliveryUrl(media.publicId, 600) || media.url}
            alt={media.alt}
            loading="lazy"
          />
        )}
        {secondaryMedia && (
          <img
            className="home-accessory-image-secondary"
            src={cloudinaryDeliveryUrl(secondaryMedia.publicId, 600) || secondaryMedia.url}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        )}
        {compareAt && <span className="home-accessory-sale">Sale{discount ? ` · ${discount}%` : ""}</span>}
        {!inStock && <span className="home-accessory-sold-out">Sold Out</span>}
        </a>
        <HomepageProductActions product={product} />
      </div>
      <a className="home-accessory-copy" href={`/product/${product.slug}`}>
        <span>{product.brand?.name ?? "No brand"}</span>
        <strong className="home-accessory-title">{product.title}</strong>
        {variant && (
          <span className="home-accessory-price">
            <b>{formatPkrMinor(variant.priceMinor)}</b>
            {compareAt && <del>{formatPkrMinor(compareAt)}</del>}
          </span>
        )}
        <span className={`home-accessory-availability${inStock ? "" : " unavailable"}`}>
          <i />{inStock ? "In stock" : "Out of stock"}
        </span>
      </a>
    </article>
  );
}

function AccessoriesSection({ taxonomy }: { taxonomy: Taxonomy }) {
  const [activeTab, setActiveTab] = useState<AccessoryBrandTab>("all");
  const [accessories, setAccessories] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const collection = resolveCollection("/collections/mobile-accessories", taxonomy);
    if (!collection?.available) {
      setAccessories([]);
      setLoading(false);
      return;
    }
    const brand = activeTab === "all"
      ? undefined
      : taxonomy.brands.find((item) => item.slug === activeTab || item.name.toLowerCase() === activeTab);
    if (activeTab !== "all" && !brand) {
      setAccessories([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    fetchPublicCatalog({
      ...collection.filters,
      brands: brand ? [brand.slug] : [],
      limit: 4,
    })
      .then((items) => {
        if (current) setAccessories(items);
      })
      .catch(() => {
        if (current) setAccessories([]);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [activeTab, taxonomy]);

  return (
    <section className="home-accessories" aria-labelledby="home-accessories-title">
      <div className="home-accessories-head">
        <div>
          <h2 id="home-accessories-title">Accessories</h2>
          <div className="home-accessories-tabs" role="tablist" aria-label="Filter accessories by brand">
            {accessoryBrandTabs.map((tab) => (
              <button
                className={activeTab === tab.value ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.value}
                onClick={() => setActiveTab(tab.value)}
                key={tab.value}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <a href="/collections/mobile-accessories">View All</a>
      </div>
      <div className="home-accessories-content" aria-live="polite">
        {loading ? (
          <div className="home-accessories-empty">Loading accessories…</div>
        ) : accessories.length > 0 ? (
          <div className="home-accessories-grid">
            {accessories.map((product) => <AccessoryProductCard product={product} key={product.id} />)}
          </div>
        ) : (
          <div className="home-accessories-empty">
            <p>No products are available for this brand yet.</p>
            <a href="/collections/mobile-accessories">View all accessories <ArrowRight /></a>
          </div>
        )}
      </div>
    </section>
  );
}
function bundleSaving(bundle: HomepageBundle, products: CatalogProduct[]) {
  let currentTotal = 0;
  for (const item of bundle.items) {
    const product = products.find((candidate) => candidate.id === item.product.id);
    const price = product ? productPrice(product) : null;
    if (price === null) return null;
    currentTotal += price * item.quantity;
  }
  const saving = currentTotal - bundle.bundle_price_minor;
  return saving > 0 ? saving : null;
}

const USE_LIVE_BUNDLES = false;
const homepageDemoBundles = [
  { title: "Phone Essentials Bundle", image: "/assets/bundles/bundle-phone-essentials.png", href: "/collections/bundle-offers?bundle=phone-essentials" },
  { title: "Power On-the-Go Bundle", image: "/assets/bundles/bundle-power-on-go.png", href: "/collections/bundle-offers?bundle=power-on-go" },
  { title: "MacBook Essentials Bundle", image: "/assets/bundles/bundle-macbook-essentials.png", href: "/collections/bundle-offers?bundle=macbook-essentials" },
  { title: "Everyday Essentials Bundle", image: "/assets/bundles/bundle-everyday-essentials.png", href: "/collections/bundle-offers?bundle=everyday-essentials" },
] as const;

function BundleOffers({ bundles, products, loading }: { bundles: HomepageBundle[]; products: CatalogProduct[]; loading: boolean }) {
  return (
    <section className="home-bundles" aria-labelledby="bundle-offers-title">
      <div className="home-bundles-products">
        <div className="home-bundles-head">
          <div>
            <h2 id="bundle-offers-title">Bundle Offers</h2>
            <p>Save more when you shop together</p>
          </div>
          <a href="/collections/bundle-offers">View All</a>
        </div>
        {!USE_LIVE_BUNDLES ? (
          <div className="home-bundles-grid">
            {homepageDemoBundles.map((bundle) => (
              <a className="home-bundle-card" href={bundle.href} aria-label={bundle.title} key={bundle.href}>
                <img src={bundle.image} alt={bundle.title} loading="lazy" />
              </a>
            ))}
          </div>
        ) : loading ? <div className="home-accessories-empty">Loading bundle offers…</div> : bundles.length ? (
          <div className="home-bundles-grid">
            {bundles.map((bundle) => {
              const saving = bundleSaving(bundle, products);
              const visualItems = bundle.items.filter((item) => item.product.media).slice(0, 4);
              return (
                <a className="home-bundle-card" href="/collections/bundle-offers" aria-label={`${bundle.title}, ${formatPkrMinor(bundle.bundle_price_minor)}`} key={bundle.id}>
                  <span className={`home-bundle-media${bundle.bundle_image_url ? " home-bundle-media-custom" : ` home-bundle-media-${visualItems.length}`}`}>
                    {bundle.bundle_image_url ? (
                      <img className="home-bundle-custom-image" src={cloudinaryDeliveryUrl(bundle.bundle_image_public_id ?? "", 600) || bundle.bundle_image_url} alt={`${bundle.title} bundle`} loading="lazy" />
                    ) : visualItems.map((item, index) => item.product.media && (
                      <img className={`home-bundle-item home-bundle-item-${index + 1}`} key={item.id} src={cloudinaryDeliveryUrl(item.product.media.publicId, 420) || item.product.media.url} alt={item.product.media.alt} loading="lazy" />
                    ))}
                  </span>
                  {saving !== null && <span className="home-bundle-badge">Save {formatPkrMinor(saving)}</span>}
                  <span className="home-bundle-copy">
                    <strong>{bundle.title}</strong>
                    <span className="home-bundle-price">{formatPkrMinor(bundle.bundle_price_minor)}</span>
                  </span>
                </a>
              );
            })}
          </div>
        ) : <div className="home-accessories-empty">Bundle offers are being prepared.</div>}
      </div>
      <div className="home-bundles-promo" aria-label="Bundle Offers promotional banner" />
    </section>
  );
}
function BestSellerSection({ products, loading }: { products: CatalogProduct[]; loading: boolean }) {
  const bestSellers = products.filter((product) => product.is_best_seller).slice(0, 4);

  return (
    <section className="home-best-sellers" aria-labelledby="best-seller-title">
      <div className="home-best-sellers-head">
        <div>
          <h2 id="best-seller-title">Best Seller</h2>
          <p>Don&apos;t miss out on these customer favorites</p>
        </div>
        <a href="/collections/best-sellers">View All</a>
      </div>
      {loading ? (
        <div className="home-accessories-empty">Loading best sellers…</div>
      ) : bestSellers.length > 0 ? (
        <div className="home-accessories-grid">
          {bestSellers.map((product) => <AccessoryProductCard product={product} key={product.id} />)}
        </div>
      ) : (
        <div className="home-accessories-empty">Best sellers are being prepared.</div>
      )}
    </section>
  );
}
const homepagePriceRanges = [
  { label: "Below Rs. 10,000", href: "/shop?priceMax=10000" },
  { label: "Rs. 15,000 – Rs. 25,000", href: "/shop?priceMin=15000&priceMax=25000" },
  { label: "Rs. 25,000 – Rs. 50,000", href: "/shop?priceMin=25000&priceMax=50000" },
  { label: "Rs. 50,000 – Rs. 80,000", href: "/shop?priceMin=50000&priceMax=80000" },
  { label: "Rs. 80,000 – Rs. 100,000", href: "/shop?priceMin=80000&priceMax=100000" },
  { label: "Rs. 100,000 – Rs. 125,000", href: "/shop?priceMin=100000&priceMax=125000" },
  { label: "Rs. 125,000 – Rs. 150,000", href: "/shop?priceMin=125000&priceMax=150000" },
  { label: "Above Rs. 150,000", href: "/shop?priceMin=150000" },
] as const;

function ShopByPrice() {
  return (
    <section className="home-shop-price" aria-labelledby="shop-by-price-title">
      <div className="home-shop-price-head">
        <h2 id="shop-by-price-title">Shop By Price</h2>
        <p>Find products in the price range that works for you</p>
      </div>
      <div className="home-shop-price-grid">
        {homepagePriceRanges.map((range) => (
          <a href={range.href} className="home-price-card" key={range.href}>
            <span className="home-price-icon" aria-hidden="true"><Tag /></span>
            <span className="home-price-copy">
              <small>PRICE RANGE</small>
              <strong>{range.label}</strong>
            </span>
            <span className="home-price-arrow" aria-hidden="true"><ArrowRight /></span>
          </a>
        ))}
      </div>
    </section>
  );
}
const homepageReviews = [
  { image: "/assets/feedback/Feedback-1.png", name: "Areeba K.", initials: "AK", date: "2 weeks ago", rating: 5, copy: "Fast delivery and secure packaging." },
  { image: "/assets/feedback/Feedback-2.png", name: "Hassan R.", initials: "HR", date: "3 weeks ago", rating: 5, copy: "Authentic product, excellent condition." },
  { image: "/assets/feedback/Feedback-3.png", name: "Maham S.", initials: "MS", date: "1 month ago", rating: 5, copy: "Staff helped me compare the options without rushing me, and their recommendation suited my needs." },
  { image: "/assets/feedback/Feedback-4.png", name: "Usman A.", initials: "UA", date: "1 month ago", rating: 5, copy: "Payment was straightforward, and I received clear updates from confirmation through delivery." },
  { image: "/assets/feedback/Feedback-5.png", name: "Sana M.", initials: "SM", date: "2 months ago", rating: 5, copy: "Everything arrived neatly packed and on time. The phone looked exactly like the photos." },
  { image: "/assets/feedback/Feedback-6.png", name: "Bilal H.", initials: "BH", date: "2 months ago", rating: 5, copy: "Before ordering, I had a few questions about authenticity and warranty. The team answered each one clearly, shared the relevant details, and kept me informed until the package reached me." },
  { image: "/assets/feedback/Feedback-7.png", name: "Zoya F.", initials: "ZF", date: "3 months ago", rating: 5, copy: "I needed help choosing between two models, and the staff explained the practical differences in simple terms. Their guidance made the decision easy, and the device arrived safely in excellent condition." },
  { image: "/assets/feedback/Feedback-8.png", name: "Ali N.", initials: "AN", date: "3 months ago", rating: 5, copy: "My order was handled professionally from payment confirmation to delivery. I contacted the team again after receiving it, and their after-sale support was just as responsive and helpful as before." },
] as const;

function CustomerReviewsCarousel() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  const updateProgress = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maximum = viewport.scrollWidth - viewport.clientWidth;
    setProgress(maximum > 0 ? viewport.scrollLeft / maximum : 0);
  };

  const moveReviews = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    const card = viewport?.querySelector<HTMLElement>(".home-review-card");
    if (!viewport || !card) return;
    const gap = Number.parseFloat(getComputedStyle(viewport).columnGap || "0");
    viewport.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: "smooth" });
  };

  useEffect(() => {
    updateProgress();
    window.addEventListener("resize", updateProgress);
    return () => window.removeEventListener("resize", updateProgress);
  }, []);

  const segmentWidth = 100 / homepageReviews.length;

  return (
    <section className="home-reviews-carousel" aria-label="Customer reviews">
      <div className="home-reviews-viewport" ref={viewportRef} onScroll={updateProgress}>
        {homepageReviews.map((review) => (
          <article className="home-review-card" key={review.image}>
            <img className="home-review-image" src={review.image} alt="" loading="lazy" />
            <div className="home-review-content">
              <p>{review.copy}</p>
              <div className="home-review-customer">
                <span className="home-review-avatar" aria-hidden="true">{review.initials}</span>
                <span><strong>{review.name}</strong><small>{review.date}</small></span>
              </div>
              <div className="home-review-stars" aria-label={`${review.rating} out of 5 stars`}>
                {Array.from({ length: review.rating }, (_, index) => (
                  <Star key={index} size={15} strokeWidth={0} fill="currentColor" aria-hidden="true" />
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="home-reviews-controls">
        <div className="home-reviews-progress" aria-hidden="true">
          <span style={{ width: `${segmentWidth}%`, left: `${progress * (100 - segmentWidth)}%` }} />
        </div>
        <div className="home-reviews-arrows">
          <button type="button" onClick={() => moveReviews(-1)} aria-label="Previous reviews"><ChevronLeft /></button>
          <button type="button" onClick={() => moveReviews(1)} aria-label="Next reviews"><ChevronRight /></button>
        </div>
      </div>
    </section>
  );
}
function HomepageAbout() {
  return (
    <section className="home-about" aria-labelledby="home-about-title">
      <div className="home-about-est" aria-label="Established in 2010">
        <span>EST.</span>
        <strong>2010</strong>
        <small>ISOLUTIONS PAKISTAN</small>
      </div>
      <div className="home-about-content">
        <span className="home-about-eyebrow">ABOUT iSOLUTIONS PAKISTAN</span>
        <h2 id="home-about-title">Technology you can trust, since 2010.</h2>
        <p>Since 2010, iSolutions Pakistan has been helping customers choose technology with greater confidence. Our approach is built around carefully selected products, clear guidance and dependable customer service. From smartphones and accessories to laptops and everyday tech, we aim to make every purchase simple, transparent and reliable — before and after the sale.</p>
        <a className="home-about-cta" href="/about">Read More <ArrowRight aria-hidden="true" /></a>
      </div>
    </section>
  );
}

function CustomerReviewsIntro() {
  return (
    <section className="home-reviews-intro" aria-labelledby="customer-reviews-title">
      <div className="home-reviews-copy">
        <h2 id="customer-reviews-title">What Our Customers Say</h2>
        <p>Real reviews from real people</p>
      </div>
      <div className="home-reviews-rating" aria-label="Rated 4.9 out of 5">
        <span>Ratings /</span>
        <strong>4.9</strong>
        <span className="home-reviews-stars" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <Star key={index} size={17} strokeWidth={0} fill="currentColor" />
          ))}
        </span>
      </div>
    </section>
  );
}

const homepageBrands = [
  { name: "Apple", slug: "apple", logo: "/assets/brands/apple.svg" },
  { name: "Samsung", slug: "samsung", logo: "/assets/brands/samsung-v2.svg" },
  { name: "Xiaomi", slug: "xiaomi", logo: "/assets/brands/xiaomi.svg" },
  { name: "Motorola", slug: "motorola", logo: "/assets/brands/motorola.svg" },
  { name: "Honor", slug: "honor", logo: "/assets/brands/honor-v2.svg" },
  { name: "Nothing", slug: "nothing", logo: "/assets/brands/nothing.svg" },
  { name: "Google", slug: "google", logo: "/assets/brands/google.svg" },
  { name: "Tecno", slug: "tecno", logo: "/assets/brands/tecno.svg" },
  { name: "Infinix", slug: "infinix", logo: "/assets/brands/infinix.svg" },
  { name: "Vivo", slug: "vivo", logo: "/assets/brands/vivo-v2.svg" },
  { name: "Oppo", slug: "oppo", logo: "/assets/brands/oppo-v2.svg" },
  { name: "Realme", slug: "realme", logo: "/assets/brands/realme.svg" },
  { name: "itel", slug: "itel", logo: "/assets/brands/itel.svg" },
  { name: "OnePlus", slug: "oneplus", logo: "/assets/brands/oneplus.svg" },
] as const;

function ShopByBrands({
  heading = "Shop By Brands",
  subtitle = "Explore products from brands you trust",
  headingId = "shop-by-brands-title",
  className = "",
}: {
  heading?: string;
  subtitle?: string;
  headingId?: string;
  className?: string;
} = {}) {
  const brandGroup = (duplicate = false) => (
    <div className="home-brand-marquee-group" aria-hidden={duplicate || undefined}>
      {homepageBrands.map((brand) => (
        <a
          className="home-brand-tile"
          href={`/shop?brand=${encodeURIComponent(brand.slug)}`}
          tabIndex={duplicate ? -1 : undefined}
          key={`${duplicate ? "duplicate-" : ""}${brand.slug}`}
        >
          <span className="home-brand-logo-stage">
            <img src={brand.logo} alt={duplicate ? "" : `${brand.name} logo`} loading="lazy" />
          </span>
        </a>
      ))}
    </div>
  );

  return (
    <section className={`home-shop-brands${className ? ` ${className}` : ""}`} aria-labelledby={headingId}>
      <div className="home-shop-brands-head">
        <h2 id={headingId}>{heading}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="home-brand-marquee-viewport" aria-label="Shop by brand">
        <div className="home-brand-marquee-rail">
          {brandGroup()}
          {brandGroup(true)}
        </div>
      </div>
    </section>
  );
}
function ShopByCategory() {
  const categoryGroup = (duplicate = false) => (
    <div className="home-category-carousel-group" aria-hidden={duplicate || undefined}>
      {homepageCategories.map((category) => (
        <a
          className="home-category-carousel-item"
          href={category.href}
          key={`${duplicate ? "duplicate-" : ""}${category.label}`}
          tabIndex={duplicate ? -1 : undefined}
        >
          <span className={`home-category-carousel-stage${category.image ? "" : " is-fallback"}`}>
            {category.image && <img src={category.image} alt="" loading="lazy" />}
          </span>
          <strong>{category.label}</strong>
        </a>
      ))}
    </div>
  );

  return (
    <section className="home-category-carousel container" aria-labelledby="shop-by-category-title">
      <div className="home-category-carousel-head">
        <div>
          <h2 id="shop-by-category-title">Shop By Category</h2>
          <p>Find exactly what you&apos;re looking for</p>
        </div>
      </div>
      <div className="home-category-carousel-track" aria-label="Shop by category">
        <div className="home-category-carousel-rail">
          {categoryGroup()}
          {categoryGroup(true)}
        </div>
      </div>
    </section>
  );
}
type ShopState = CatalogFilters & { categories: string[]; brands: string[] };
function Filters({
  value,
  taxonomy,
  onChange,
}: {
  value: ShopState;
  taxonomy: Taxonomy;
  onChange: (next: ShopState) => void;
}) {
  const toggle = (key: "categories" | "brands", item: string) =>
    onChange({
      ...value,
      [key]: value[key].includes(item)
        ? value[key].filter((x) => x !== item)
        : [...value[key], item],
    });
  return (
    <div className="filters">
      <details open>
        <summary>
          Category
          <ChevronDown />
        </summary>
        {taxonomy.categories.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={value.categories.includes(item.slug)}
              onChange={() => toggle("categories", item.slug)}
            />{" "}
            {item.name}
          </label>
        ))}
      </details>
      <details open>
        <summary>
          Brand
          <ChevronDown />
        </summary>
        {taxonomy.brands.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={value.brands.includes(item.slug)}
              onChange={() => toggle("brands", item.slug)}
            />{" "}
            {item.name}
          </label>
        ))}
      </details>
      <details>
        <summary>
          Price
          <ChevronDown />
        </summary>
        <label>
          Minimum PKR
          <input
            type="number"
            min="0"
            value={value.priceMin ? value.priceMin / 100 : ""}
            onChange={(e) =>
              onChange({
                ...value,
                priceMin: e.target.value
                  ? parsePkrMajorToMinor(e.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          Maximum PKR
          <input
            type="number"
            min="0"
            value={value.priceMax ? value.priceMax / 100 : ""}
            onChange={(e) =>
              onChange({
                ...value,
                priceMax: e.target.value
                  ? parsePkrMajorToMinor(e.target.value)
                  : undefined,
              })
            }
          />
        </label>
      </details>
      <details>
        <summary>
          Storage
          <ChevronDown />
        </summary>
        <label>
          Exact storage
          <input
            value={value.storage?.[0] ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                storage: e.target.value ? [e.target.value] : undefined,
              })
            }
            placeholder="e.g. 256 GB"
          />
        </label>
      </details>
      <details>
        <summary>
          RAM
          <ChevronDown />
        </summary>
        <label>
          Exact RAM
          <input
            value={value.ram?.[0] ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                ram: e.target.value ? [e.target.value] : undefined,
              })
            }
            placeholder="e.g. 8 GB"
          />
        </label>
      </details>
      <details>
        <summary>
          PTA Status
          <ChevronDown />
        </summary>
        {[
          ["approved", "PTA approved"],
          ["not_approved", "Not approved"],
          ["not_applicable", "Not applicable"],
        ].map(([key, label]) => (
          <label key={key}>
            <input
              type="radio"
              name="pta"
              checked={value.ptaStatus?.[0] === key}
              onChange={() =>
                onChange({
                  ...value,
                  ptaStatus: [key as CatalogVariant["ptaStatus"]],
                })
              }
            />
            {label}
          </label>
        ))}
      </details>
      <details>
        <summary>
          Availability
          <ChevronDown />
        </summary>
        <label>
          <input
            type="checkbox"
            checked={value.inStock === true}
            onChange={(e) =>
              onChange({ ...value, inStock: e.target.checked || undefined })
            }
          />{" "}
          In stock
        </label>
      </details>
      <details>
        <summary>
          Delivery Scope
          <ChevronDown />
        </summary>
        {[
          ["karachi_only", "Karachi only"],
          ["nationwide", "Nationwide"],
        ].map(([key, label]) => (
          <label key={key}>
            <input
              type="radio"
              name="delivery"
              checked={value.deliveryScope?.[0] === key}
              onChange={() =>
                onChange({
                  ...value,
                  deliveryScope: [key as "karachi_only" | "nationwide"],
                })
              }
            />
            {label}
          </label>
        ))}
      </details>
    </div>
  );
}

function Shop({ taxonomy }: { taxonomy: Taxonomy }) {
  const params = new URLSearchParams(location.search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ShopState>({
    search: params.get("q") ?? undefined,
    categories: params.get("category") ? [params.get("category")!] : [],
    brands: params.get("brand") ? [params.get("brand")!] : [],
    priceMin: params.get("priceMin") ? parsePkrMajorToMinor(params.get("priceMin")!) : undefined,
    priceMax: params.get("priceMax") ? parsePkrMajorToMinor(params.get("priceMax")!) : undefined,
  });
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      fetchPublicCatalog(filters)
        .then(setProducts)
        .catch(() =>
          setError("The published catalog is temporarily unavailable."),
        )
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [filters]);
  const activeFilterCount =
    filters.categories.length +
    filters.brands.length +
    (filters.search ? 1 : 0) +
    (filters.priceMin !== undefined ? 1 : 0) +
    (filters.priceMax !== undefined ? 1 : 0) +
    (filters.storage?.length ? 1 : 0) +
    (filters.ram?.length ? 1 : 0) +
    (filters.ptaStatus?.length ? 1 : 0) +
    (filters.inStock ? 1 : 0) +
    (filters.deliveryScope?.length ? 1 : 0);
  return (
    <Layout taxonomy={taxonomy}>
      <div className="shop-page">
        <section className="shop-hero container">
          <div>
            <span className="eyebrow">ISOLUTIONS / THE COLLECTION</span>
            <h1>Shop.</h1>
          </div>
          <div className="shop-hero-copy">
            <p>Premium phones, laptops and personal technology—carefully selected and clearly presented.</p>
            <span>Verified products, ready to explore</span>
          </div>
        </section>
        <div className="shop-results-bar container">
          <div>
            <strong>{loading ? "Loading collection" : `${products.length} product${products.length === 1 ? "" : "s"}`}</strong>
            <span>{activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}` : "Showing the complete collection"}</span>
          </div>
          <button className="filter-trigger" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal /> Refine
            {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
          </button>
        </div>
        <div className="shop-catalog container">
          <aside className="shop-filter-rail">
            <div className="shop-filter-heading">
              <span className="eyebrow accent">REFINE</span>
              <h2>Filters</h2>
              <p>Results update as you select.</p>
            </div>
            <Filters value={filters} taxonomy={taxonomy} onChange={setFilters} />
          </aside>
          <section className="shop-results" aria-label="Shop products">
            {products.length > 0 && (
              <div className="product-grid shop-product-grid">
                {products.map((product) => (
                  <ProductCard product={product} key={product.id} />
                ))}
              </div>
            )}
            {!loading && !error && products.length === 0 && (
              <div className="shop-empty">
                <span className="eyebrow accent">NO MATCHES</span>
                <h2>Try a broader selection.</h2>
                <p>No published products match this combination of filters. Adjust one or more selections to explore the collection.</p>
              </div>
            )}
            {error && <CatalogEmpty title={error} />}
          </section>
        </div>
        {filtersOpen && (
          <div className="shop-filter-sheet" role="dialog" aria-modal="true" aria-label="Shop filters">
            <div className="shop-filter-sheet-head">
              <div><span className="eyebrow accent">REFINE</span><h2>Shop filters</h2></div>
              <button onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X /></button>
            </div>
            <Filters value={filters} taxonomy={taxonomy} onChange={setFilters} />
            <button className="btn shop-filter-apply" onClick={() => setFiltersOpen(false)}>
              Show {products.length} product{products.length === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

function CheckoutPage({ taxonomy }: { taxonomy: Taxonomy }) {
  const [items, setItems] = useState<StorefrontCartItem[]>(() => storefrontCartItems());
  const [deliveryScopes, setDeliveryScopes] = useState<Record<string, "karachi_only" | "nationwide" | null>>({});
  const [city, setCity] = useState("");
  const [otherCityName, setOtherCityName] = useState("");
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("standard");
  const [paymentMethod, setPaymentMethod] = useState("cash-on-delivery");
  const [activeCheckoutStep, setActiveCheckoutStep] = useState(0);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const checkoutSectionRefs = useRef<Array<HTMLElement | null>>([]);
  const orderSubmissionRef = useRef(false);

  useEffect(() => {
    const syncCart = () => setItems(storefrontCartItems());
    window.addEventListener("isolutions:cart-updated", syncCart);
    return () => window.removeEventListener("isolutions:cart-updated", syncCart);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    let active = true;
    // Look up each cart product by slug: the catalog search returns at most 100 products, so a
    // single page would miss delivery scopes once more than 100 products are published.
    const slugs = [...new Set(items.map((item) => item.productSlug))];
    Promise.all(slugs.map((slug) => fetchPublicCatalog({ slug, limit: 1 })))
      .then((results) => {
        if (!active) return;
        const products = results.flat();
        setDeliveryScopes(Object.fromEntries(products.flatMap((product) =>
          product.variants.map((variant) => [variant.id, variant.deliveryScope]),
        )));
      })
      .catch(() => active && setDeliveryScopes({}));
    return () => { active = false; };
  }, [items]);

  useEffect(() => {
    const sections = checkoutSectionRefs.current.filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0 || !window.IntersectionObserver) return;
    const observerTopOffset = window.matchMedia("(max-width: 600px)").matches ? 128 : 148;
    const observer = new IntersectionObserver((entries) => {
      const mostVisible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const step = mostVisible?.target.getAttribute("data-checkout-step");
      if (step !== null && step !== undefined) setActiveCheckoutStep(Number(step));
    }, { rootMargin: `-${observerTopOffset}px 0px -42%`, threshold: [0.2, 0.45, 0.7] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items.length]);

  const subtotal = items.reduce((total, item) => total + item.priceMinor * item.quantity, 0);
  const qualifiesForFreeStandardDelivery = subtotal >= FREE_STANDARD_DELIVERY_THRESHOLD_MINOR;
  const amountToFreeStandardDeliveryMinor = Math.max(0, FREE_STANDARD_DELIVERY_THRESHOLD_MINOR - subtotal);
  const standardDeliveryFeeMinor = calculateDeliveryFeeMinor(subtotal, "standard");
  const fastDeliveryFeeMinor = calculateDeliveryFeeMinor(subtotal, "fast");
  const deliveryFeeMinor = shippingMethod === "fast" ? fastDeliveryFeeMinor : standardDeliveryFeeMinor;
  const totalMinor = subtotal + deliveryFeeMinor;
  const knownScopes = items.map((item) => deliveryScopes[item.variantId]).filter((scope): scope is "karachi_only" | "nationwide" => Boolean(scope));
  const hasKarachiOnly = knownScopes.includes("karachi_only");
  const hasNationwide = knownScopes.includes("nationwide");
  const deliveryState = hasKarachiOnly && hasNationwide ? "mixed" : hasKarachiOnly ? "karachi" : "nationwide";
  const requiresKarachi = deliveryState === "karachi" || deliveryState === "mixed";
  const isOtherCity = !requiresKarachi && city === "Other city in Pakistan";

  useEffect(() => {
    if (requiresKarachi) {
      setCity("Karachi");
      setOtherCityName("");
    } else if (city !== "Other city in Pakistan") {
      setOtherCityName("");
    }
  }, [city, requiresKarachi]);
  const paymentMethods = [
    { id: "cash-on-delivery", label: "Cash on Delivery", asset: "/assets/payment-methods/cash-on-delivery.svg", comingSoon: false },
    { id: "bank-transfer", label: "Bank Transfer", asset: "/assets/payment-methods/bank-transfer.svg", comingSoon: false },
    { id: "credit-debit-card", label: "Credit / Debit Card", asset: "/assets/payment-methods/credit-debit-card.svg", comingSoon: true },
    { id: "installments", label: "Installments", asset: "/assets/payment-methods/installments.svg", comingSoon: true },
  ] as const;

  if (items.length === 0) {
    return (
      <Layout taxonomy={taxonomy}>
        <main className="checkout-page checkout-empty-page">
          <section className="checkout-empty-card" aria-labelledby="checkout-empty-title">
            <PackageOpen aria-hidden="true" />
            <h1 id="checkout-empty-title">Your cart is empty</h1>
            <p>Add products to your cart before proceeding to checkout.</p>
            <a href="/shop">Continue Shopping</a>
          </section>
        </main>
      </Layout>
    );
  }

  const deliveryNotice = deliveryState === "mixed"
    ? { title: "Karachi delivery required for this order", text: "Your cart contains a mobile phone, so this order can currently be delivered in Karachi only. Gadgets and accessories are available nationwide when ordered without a Karachi-only mobile phone.", helper: "Remove the mobile phone from your cart to order the remaining items for nationwide delivery." }
    : deliveryState === "karachi"
      ? { title: "Karachi Delivery Only", text: "Mobile phones are currently available for delivery in Karachi only." }
      : { title: "Nationwide Delivery Available", text: "Gadgets and accessories can be delivered across Pakistan." };

  const placeOrder = async (form: HTMLFormElement) => {
    if (orderSubmissionRef.current) return;
    const formData = new FormData(form);
    const customerName = String(formData.get("fullName") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const address = String(formData.get("address") ?? "").trim();
    const landmark = String(formData.get("landmark") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const selectedCity = requiresKarachi ? "Karachi" : city;

    if (!customerName || !phone || !selectedCity || !address) {
      setCheckoutError("Please complete your name, phone, city, and delivery address.");
      return;
    }
    if (!isValidOrderPhone(phone)) {
      setCheckoutError(PHONE_VALIDATION_MESSAGE);
      return;
    }
    if (selectedCity === "Other city in Pakistan" && !otherCityName.trim()) {
      setCheckoutError("Please enter your city name for nationwide delivery.");
      return;
    }
    if (paymentMethod !== "cash-on-delivery" && paymentMethod !== "bank-transfer") {
      setCheckoutError("Please select Cash on Delivery or Bank Transfer.");
      return;
    }

    setCheckoutError(null);
    orderSubmissionRef.current = true;
    setIsSubmitting(true);
    try {
      const confirmation = await createStorefrontOrder({
        customerName,
        phone,
        email: email || null,
        city: selectedCity as "Karachi" | "Other city in Pakistan",
        otherCity: selectedCity === "Other city in Pakistan" ? otherCityName.trim() : null,
        fullDeliveryAddress: address,
        areaLandmark: landmark || null,
        orderNotes: notes || null,
        paymentMethod: paymentMethod === "cash-on-delivery" ? "cash_on_delivery" : "bank_transfer",
        shippingMethod,
        items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
      });
      saveStorefrontOrderConfirmation(confirmation);
      clearStorefrontCart();
      window.location.assign("/order-success");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setCheckoutError(
        isRateLimitError(error)
          ? RATE_LIMIT_MESSAGE
          : detail.includes("karachi_delivery_required")
          ? "This order includes a mobile phone and must be delivered in Karachi."
          : detail.includes("phone_invalid")
            ? PHONE_VALIDATION_MESSAGE
          : detail.includes("order_item_quantity_invalid")
            ? `Each item can be ordered up to ${MAX_ORDER_LINE_QUANTITY} units per order. Please update your cart.`
          : detail.includes("variant_out_of_stock")
            ? "One or more items are no longer available in the requested quantity. Please review your cart."
            : detail.includes("payment_method_unsupported")
              ? "Please select Cash on Delivery or Bank Transfer."
              : detail.includes("shipping_method_unsupported")
                ? "Please select Standard Delivery or Fast Delivery."
                : "We could not place your order. Please review your details and try again.",
      );
      orderSubmissionRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Layout taxonomy={taxonomy}>
      <main className="checkout-page">
        <div className="checkout-wrap">
          <header className="checkout-intro">
            <h1>Secure Checkout</h1>
            <p>Complete your details and review your order.</p>
          </header>
          <ol className="checkout-progress" aria-label="Checkout progress">
            {['Customer Details', 'Delivery Details', 'Payment Method'].map((step, index) => <li className={index === activeCheckoutStep ? "is-current" : index < activeCheckoutStep ? "is-complete" : ""} key={step}><span>{index + 1}</span>{step}</li>)}
          </ol>

          <div className="checkout-layout">
            <form id="checkout-details-form" className="checkout-details" onSubmit={(event) => { event.preventDefault(); void placeOrder(event.currentTarget); }}>
              {checkoutError && <p className="checkout-form-error" role="alert">{checkoutError}</p>}
              <section className="checkout-card" ref={(node) => { checkoutSectionRefs.current[0] = node; }} data-checkout-step="0" onFocusCapture={() => setActiveCheckoutStep(0)} aria-labelledby="customer-details-title">
                <div className="checkout-card-heading"><span>01</span><div><h2 id="customer-details-title">Customer Details</h2><p>How we can reach you about this order.</p></div></div>
                <div className="checkout-fields checkout-fields-two">
                  <label>Full Name <em>*</em><input required name="fullName" autoComplete="name" /></label>
                  <label>WhatsApp / Phone <em>*</em><input required name="phone" inputMode="tel" autoComplete="tel" /></label>
                  <label className="checkout-field-full">Email <small>Optional</small><input name="email" type="email" autoComplete="email" /></label>
                </div>
              </section>

              <section className="checkout-card" ref={(node) => { checkoutSectionRefs.current[1] = node; }} data-checkout-step="1" onFocusCapture={() => setActiveCheckoutStep(1)} aria-labelledby="delivery-details-title">
                <div className="checkout-card-heading"><span>02</span><div><h2 id="delivery-details-title">Delivery Details</h2><p>Tell us where your order should be delivered.</p></div></div>
                <div className="checkout-fields checkout-fields-two">
                  <label>City <em>*</em>{requiresKarachi ? <><select className="checkout-city-lock" required name="city" value="Karachi" disabled aria-describedby="checkout-city-lock-help"><option>Karachi</option></select><small id="checkout-city-lock-help">Karachi is required for this order.</small></> : <select required name="city" value={city} onChange={(event) => setCity(event.target.value)}><option value="" disabled>Select your city</option><option>Karachi</option><option>Other city in Pakistan</option></select>}</label>
                  {isOtherCity && <label>City Name <em>*</em><input required name="otherCityName" value={otherCityName} onChange={(event) => setOtherCityName(event.target.value)} placeholder="e.g. Lahore, Islamabad, Multan" autoComplete="address-level2" /></label>}
                  <label>Area / Landmark <small>Optional</small><input name="landmark" /></label>
                  <label className="checkout-field-full">Full Delivery Address <em>*</em><textarea required name="address" rows={3} /></label>
                  <label className="checkout-field-full">Order Notes <small>Optional</small><textarea name="notes" rows={3} /></label>
                </div>
              </section>

              <aside className={`checkout-delivery-notice is-${deliveryState}`} aria-label="Delivery eligibility">
                <MapPinned aria-hidden="true" />
                <div><strong>{deliveryNotice.title}</strong><p>{deliveryNotice.text}</p>{deliveryNotice.helper && <small>{deliveryNotice.helper}</small>}</div>
              </aside>

              <section className="checkout-card checkout-shipping-card" aria-labelledby="shipping-method-title">
                <div className="checkout-card-heading"><div><h2 id="shipping-method-title">Delivery Method</h2><p>Choose how you'd like this order delivered.</p></div></div>
                <p className={`checkout-shipping-progress${qualifiesForFreeStandardDelivery ? " is-unlocked" : ""}`}>
                  {qualifiesForFreeStandardDelivery
                    ? "You've unlocked FREE Standard Delivery."
                    : `Add ${formatPkrMinor(amountToFreeStandardDeliveryMinor)} more to unlock FREE Standard Delivery.`}
                </p>
                <div className="checkout-shipping-grid">
                  <button className={`checkout-shipping-tile${shippingMethod === "standard" ? " is-selected" : ""}`} type="button" onClick={() => setShippingMethod("standard")} aria-pressed={shippingMethod === "standard"}>
                    <Truck aria-hidden="true" />
                    <div className="checkout-shipping-tile-body">
                      <div className="checkout-shipping-tile-head"><span>Standard Delivery</span>{qualifiesForFreeStandardDelivery ? <em className="checkout-shipping-badge is-free">FREE</em> : <em className="checkout-shipping-badge is-paid">{formatPkrMinor(standardDeliveryFeeMinor)}</em>}</div>
                      <p>{qualifiesForFreeStandardDelivery ? "Free delivery on orders Rs 10,000 or above." : "Free on orders Rs 10,000 or above."}</p>
                    </div>
                  </button>
                  <button className={`checkout-shipping-tile${shippingMethod === "fast" ? " is-selected" : ""}`} type="button" onClick={() => setShippingMethod("fast")} aria-pressed={shippingMethod === "fast"}>
                    <Zap aria-hidden="true" />
                    <div className="checkout-shipping-tile-body">
                      <div className="checkout-shipping-tile-head"><span>Fast Delivery <small className="checkout-shipping-priority">Priority</small></span><em className="checkout-shipping-badge is-paid">{formatPkrMinor(fastDeliveryFeeMinor)}</em></div>
                      <p>{qualifiesForFreeStandardDelivery
                        ? `Priority delivery for an additional ${formatPkrMinor(FAST_DELIVERY_SURCHARGE_MINOR)}.`
                        : `${formatPkrMinor(STANDARD_DELIVERY_FEE_MINOR)} delivery + ${formatPkrMinor(FAST_DELIVERY_SURCHARGE_MINOR)} Fast surcharge.`}</p>
                    </div>
                  </button>
                </div>
              </section>

              <section className="checkout-card" ref={(node) => { checkoutSectionRefs.current[2] = node; }} data-checkout-step="2" onFocusCapture={() => setActiveCheckoutStep(2)} aria-labelledby="payment-method-title">
                <div className="checkout-card-heading"><span>03</span><div><h2 id="payment-method-title">Payment Method</h2><p>Select your preferred payment option.</p></div></div>
                <div className="checkout-payment-grid">
                  {paymentMethods.map((method) => (
                    <button className={`checkout-payment-tile${paymentMethod === method.id ? " is-selected" : ""}`} type="button" key={method.id} onClick={() => { setActiveCheckoutStep(2); if (!method.comingSoon) setPaymentMethod(method.id); }} aria-pressed={paymentMethod === method.id} disabled={method.comingSoon}>
                      <img src={method.asset} alt="" />
                      <span>{method.label}</span>
                      {method.comingSoon && <small>Coming soon</small>}
                    </button>
                  ))}
                </div>
              </section>
            </form>

            <aside className="checkout-summary" aria-labelledby="checkout-summary-title">
              <div className="checkout-summary-card">
              <div className="checkout-summary-heading"><h2 id="checkout-summary-title">Order Summary</h2><a href="/checkout?cart=open">Edit cart</a></div>
                <div className="checkout-summary-items">
                  {items.map((item) => <article className="checkout-summary-item" key={item.variantId}>
                    <div className="checkout-summary-image">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <PackageOpen aria-hidden="true" />}</div>
                    <div><h3>{item.productTitle}</h3>{item.sku && <p>SKU: {item.sku}</p>}<span>Qty {item.quantity} × {formatPkrMinor(item.priceMinor)}</span></div>
                    <strong>{formatPkrMinor(item.priceMinor * item.quantity)}</strong>
                  </article>)}
                </div>
                <dl className="checkout-totals">
                  <div><dt>Subtotal</dt><dd>{formatPkrMinor(subtotal)}</dd></div>
                  <div><dt>Delivery Method</dt><dd>{shippingMethod === "fast" ? "Fast Delivery" : "Standard Delivery"}</dd></div>
                  <div><dt>Delivery</dt><dd>{deliveryFeeMinor === 0 ? "FREE" : formatPkrMinor(deliveryFeeMinor)}</dd></div>
                  <div className="checkout-total"><dt>Total</dt><dd>{formatPkrMinor(totalMinor)}</dd></div>
                </dl>
                <button className="checkout-place-order" form="checkout-details-form" type="submit" disabled={isSubmitting}>{isSubmitting ? "Placing Order..." : "Place Order"}</button>
                <p className="checkout-order-helper">Your delivery fee is confirmed above.</p>
                <div className="checkout-reassurance"><span><BadgeCheck aria-hidden="true" />Clear product condition</span><span><MapPinned aria-hidden="true" />Delivery eligibility shown clearly</span><span><MessageCircle aria-hidden="true" />Support available on WhatsApp</span></div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </Layout>
  );
}

function OrderSuccessPage({ taxonomy }: { taxonomy: Taxonomy }) {
  const [confirmation] = useState(() => readStorefrontOrderConfirmation());

  return (
    <Layout taxonomy={taxonomy}>
      <main className="order-success-page">
        <section className="order-success-card" aria-labelledby="order-success-title">
          <BadgeCheck aria-hidden="true" />
          {confirmation ? <>
            <p className="eyebrow accent">ORDER CONFIRMED</p>
            <h1 id="order-success-title">Order Confirmed</h1>
            <p>Your order has been received and our team will confirm the delivery details.</p>
            <dl>
              <div><dt>Order number</dt><dd>{confirmation.orderNumber}</dd></div>
              <div><dt>Payment method</dt><dd>{confirmation.paymentMethod === "bank_transfer" ? "Bank Transfer" : "Cash on Delivery"}</dd></div>
              <div><dt>Subtotal</dt><dd>{formatPkrMinor(confirmation.subtotalMinor)}</dd></div>
              <div><dt>Delivery Method</dt><dd>{confirmation.shippingMethod === "fast" ? "Fast Delivery" : "Standard Delivery"}</dd></div>
              <div><dt>Delivery</dt><dd>{confirmation.deliveryFeeMinor === 0 ? "FREE" : formatPkrMinor(confirmation.deliveryFeeMinor)}</dd></div>
              <div className="order-success-total"><dt>Total</dt><dd>{formatPkrMinor(confirmation.totalMinor)}</dd></div>
            </dl>
            {confirmation.shippingMethod === "fast" && <p className="order-success-shipping-note">Fast Delivery selected (includes {formatPkrMinor(confirmation.shippingSurchargeMinor)} priority surcharge)</p>}
            <p className="order-success-payment-note">{confirmation.paymentMethod === "bank_transfer" ? "Bank transfer instructions will be confirmed by iSolutions Pakistan." : "Your order has been received. Our team will confirm delivery details."}</p>
            <div className="order-success-actions"><a href="/shop">Continue Shopping</a><a href={storefrontContact.whatsappUrl} target="_blank" rel="noreferrer">Need help? Chat with us</a></div>
          </> : <>
            <h1 id="order-success-title">Order confirmation unavailable</h1>
            <p>For your privacy, order details are shown only immediately after a successful checkout.</p>
            <a className="order-success-return" href="/shop">Continue Shopping</a>
          </>}
        </section>
      </main>
    </Layout>
  );
}

function CollectionPage({
  taxonomy,
  taxonomyReady,
  collection,
}: {
  taxonomy: Taxonomy;
  taxonomyReady: boolean;
  collection: ResolvedCollection | null;
}) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filterKey = collection
    ? [
        ...collection.filters.categories,
        ...collection.filters.brands,
        ...(collection.excludeBrands ?? []),
        ...(collection.bundleTerms ?? []),
        collection.deals ? "deals" : "",
        collection.bestSellers ? "best-sellers" : "",
        collection.condition ?? "",
      ].join("|")
    : "invalid";

  useEffect(() => {
    if (!taxonomyReady) return;
    if (!collection?.available) {
      setProducts([]);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    fetchPublicCatalog(collection.filters)
      .then((items) => {
        const collectionItems = collection.deals
          ? items.filter((product) => product.variants.some((variant) => validCompareAt(variant)))
          : items;
        const rankedItems = collection.bestSellers
          ? [...collectionItems]
              .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
              .slice(0, 4)
          : collectionItems;
        const bundleItems = collection.bundleTerms?.length
          ? rankedItems.filter((product) => {
              const searchable = `${product.title} ${product.category.name}`.toLowerCase();
              return collection.bundleTerms?.some((term) => searchable.includes(term));
            })
          : rankedItems;
        const visibleItems = collection.excludeBrands?.length
          ? bundleItems.filter(
              (product) =>
                !product.brand ||
                !collection.excludeBrands?.includes(product.brand.slug),
            )
          : bundleItems;
        if (!collection.condition) {
          setProducts(visibleItems);
          return;
        }
        setProducts(
          visibleItems
            .map((product) => ({
              ...product,
              variants: product.variants.filter(
                (variant) => variant.condition === collection.condition,
              ),
            }))
            .filter((product) => product.variants.length > 0),
        );
      })
      .catch(() => {
        setProducts([]);
        setError("This collection is temporarily unavailable.");
      })
      .finally(() => setLoading(false));
  }, [taxonomyReady, filterKey]);

  const title = collection?.title ?? "Collection";
  return (
    <Layout taxonomy={taxonomy}>
      <div className="shop-page collection-page">
        <nav className="collection-breadcrumbs container" aria-label="Breadcrumb">
          {(collection?.breadcrumbs ?? [
            { label: "Home", href: "/" },
            { label: "Collection" },
          ]).map((item, index, items) => (
            <span key={`${item.label}-${index}`}>
              {item.href ? <a href={item.href}>{item.label}</a> : item.label}
              {index < items.length - 1 && <ChevronRight aria-hidden="true" />}
            </span>
          ))}
        </nav>

        <section className="collection-heading container">
          <div>
            <span className="eyebrow accent">THE COLLECTION</span>
            <h1>{title}</h1>
          </div>
          <p>{collection?.description ?? "Explore our published catalog."}</p>
        </section>


        {collection?.activeBrand === "iphone" && (
          <nav className="collection-subcollections container" aria-label="iPhone condition">
            <a
              className={collection.condition === "brand_new" ? "active" : ""}
              href="/collections/mobile-phones/iphone/new"
            >
              iPhone New
            </a>
            <a
              className={collection.condition === "used" ? "active" : ""}
              href="/collections/mobile-phones/iphone/used"
            >
              iPhone Used
            </a>
          </nav>
        )}

        <div className="collection-results container">
          <strong>
            {loading
              ? "Loading collection"
              : `${products.length} product${products.length === 1 ? "" : "s"}`}
          </strong>
          <span>Published products</span>
        </div>

        <section className="collection-products container" aria-label={`${title} products`}>
          {!loading && !error && products.length > 0 && (
            <div className="product-grid shop-product-grid">
              {products.map((product) => (
                <ProductCard product={product} key={product.id} />
              ))}
            </div>
          )}
          {!loading && !error && products.length === 0 && (
            <div className="collection-empty">
              <span className="eyebrow accent">COLLECTION</span>
              <h2>{collection?.deals ? "No deals are available right now." : "No products are available in this collection yet."}</h2>
              <a href="/shop">
                {collection?.deals ? "Continue shopping" : "Return to Shop all"} <ArrowRight />
              </a>
            </div>
          )}
          {error && <CatalogEmpty title={error} />}
        </section>
      </div>
    </Layout>
  );
}
const labelize = (value: string | null) =>
  value
    ? value.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase())
    : "Unresolved";
const configurationLabel = (variant: CatalogVariant) =>
  [variant.ram, variant.storage].filter(Boolean).join(" / ") || variant.sku;
const displayConfigurationLabel = (configuration: string) =>
  configuration.replace(/\s+GB/g, "GB").replace(/\s*\/\s*/g, "/");
const mediaMatchesVariant = (
  media: CatalogProduct["media"][number],
  variantId: string,
) =>
  media.variantId === variantId || media.variantIds?.includes(variantId) ||
  (media.variantId === null && (media.variantIds?.length ?? 0) === 0);
const mediaIsAssignedToVariant = (
  media: CatalogProduct["media"][number],
  variantId: string,
) => media.variantId === variantId || media.variantIds?.includes(variantId) || false;
function PDP({ slug, taxonomy }: { slug: string; taxonomy: Taxonomy }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [variantId, setVariantId] = useState("");
  const [image, setImage] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [purchaseFeedback, setPurchaseFeedback] = useState("");
  const [recommendations, setRecommendations] = useState<FrequentlyBoughtTogetherProduct[]>([]);
  const [addedRecommendationIds, setAddedRecommendationIds] = useState<string[]>([]);
  const addedRecommendationIdsRef = useRef(new Set<string>());
  const [shareFeedback, setShareFeedback] = useState("");
  const [wishlisted, setWishlisted] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    fetchPublicCatalog({ slug, limit: 1 })
      .then(async (items) => {
        const next = items[0] ?? null;
        setProduct(next);
        setVariantId(next?.variants.find((item) => item.quantity > 0)?.id ?? next?.variants[0]?.id ?? "");
        setImage(primaryMedia(next!)?.url ?? "");
        setQuantity(1);
        setShareFeedback("");
        setWishlisted(next ? hasStorefrontWishlistItem(next.id) : false);
        addedRecommendationIdsRef.current.clear();
        setAddedRecommendationIds([]);
        const related = next
          ? await fetchFrequentlyBoughtTogether(next.id, 4).catch(() => [])
          : [];
        setRecommendations(related);
      })
      .catch(() => setError("This product could not be loaded."))
      .finally(() => setLoading(false));
  }, [slug]);
  if (loading)
    return (
      <Layout taxonomy={taxonomy}>
        <div className="container catalog-empty"><h2>Loading product…</h2></div>
      </Layout>
    );
  if (error || !product)
    return (
      <Layout taxonomy={taxonomy}>
        <div className="container"><CatalogEmpty title={error || "Published product not found."} /></div>
      </Layout>
    );
  const variant = product.variants.find((item) => item.id === variantId) ?? product.variants[0];
  const compareAt = variant ? validCompareAt(variant) : null;
  const discount = compareAt
    ? Math.round(((compareAt - variant.priceMinor) / compareAt) * 100)
    : null;
  const gallery = product.media;
  const selectedMedia = gallery.find((item) => item.url === image) ?? gallery[0] ?? primaryMedia(product);
  const configurations = [...new Set(product.variants.map(configurationLabel))];
  const selectedConfiguration = configurationLabel(variant);
  const colors = [...new Set(product.variants
    .filter((item) => configurationLabel(item) === selectedConfiguration)
    .map((item) => item.color)
    .filter(Boolean))] as string[];
  const selectVariant = (candidate: CatalogVariant | undefined) => {
    if (!candidate || candidate.quantity <= 0) return;
    setVariantId(candidate.id);
    setQuantity((current) => Math.max(1, Math.min(current, cartLineLimit(candidate.quantity))));
    setPurchaseFeedback("");
    const media = product.media.find((item) => mediaIsAssignedToVariant(item, candidate.id))
      ?? product.media.find((item) => mediaMatchesVariant(item, candidate.id))
      ?? primaryMedia(product);
    setImage(media?.url ?? "");
  };
  const selectConfiguration = (configuration: string) => {
    const candidates = product.variants.filter((item) => configurationLabel(item) === configuration);
    selectVariant(
      candidates.find((item) => item.color === variant.color && item.quantity > 0)
      ?? candidates.find((item) => item.quantity > 0)
      ?? candidates.find((item) => item.color === variant.color)
      ?? candidates[0],
    );
  };
  const selectColor = (color: string) => selectVariant(product.variants.find((item) =>
    configurationLabel(item) === selectedConfiguration && item.color === color,
  ));
  const commercialFacts = [
    { title: "Cash on Delivery", subtitle: "Available", animation: deliveryAnimation },
    { title: "Warranty", subtitle: variant.warranty?.trim() || "Warranty Support", animation: warrantyAnimation },
    { title: "100% Authentic", subtitle: "Official Product", animation: authenticAnimation },
    { title: "Trusted by Thousands", subtitle: "Customers across Pakistan", animation: trustedAnimation },
  ];
  const addSelectionToCart = (buyNow = false) => {
    if (!variant || variant.quantity <= 0) return;
    addStorefrontCartItem({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      variantId: variant.id,
      sku: variant.sku,
      quantity,
      priceMinor: variant.priceMinor,
      imageUrl: selectedMedia?.url ?? null,
    }, variant.quantity);
    setPurchaseFeedback(buyNow
      ? "Added to cart. Checkout will be available in a later phase."
      : "Added to cart successfully.");
  };
  const toggleRecommendationCart = (item: FrequentlyBoughtTogetherProduct) => {
    const recommendedVariant = item.variants.length === 1 ? item.variants[0] : null;
    if (!recommendedVariant || recommendedVariant.quantity <= 0) return;
    if (addedRecommendationIdsRef.current.has(item.id)) {
      if (!decrementStorefrontCartItem(recommendedVariant.id)) return;
      addedRecommendationIdsRef.current.delete(item.id);
      setAddedRecommendationIds((current) => current.filter((id) => id !== item.id));
      return;
    }
    const recommendedMedia = primaryMedia(item);
    const currentQuantity = storefrontCartItemQuantity(recommendedVariant.id);
    const nextQuantity = addStorefrontCartItem({
      productId: item.id,
      productSlug: item.slug,
      productTitle: item.title,
      variantId: recommendedVariant.id,
      sku: recommendedVariant.sku,
      quantity: 1,
      priceMinor: recommendedVariant.priceMinor,
      imageUrl: recommendedMedia?.url ?? null,
    }, recommendedVariant.quantity);
    if (nextQuantity <= currentQuantity) return;
    addedRecommendationIdsRef.current.add(item.id);
    setAddedRecommendationIds((current) => [...current, item.id]);
  };
  const moveGallery = (direction: -1 | 1) => {
    if (gallery.length < 2) return;
    const currentIndex = Math.max(0, gallery.findIndex((item) => item.id === selectedMedia?.id));
    const nextIndex = (currentIndex + direction + gallery.length) % gallery.length;
    setImage(gallery[nextIndex].url);
  };
  const shareProduct = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.title, url });
        setShareFeedback("Shared");
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareFeedback("Link copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setShareFeedback("Link copied");
      } catch {
        setShareFeedback("Unable to share");
      }
    }
  };
  const toggleWishlist = () => {
    const selected = toggleStorefrontWishlistItem({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      imageUrl: selectedMedia?.url ?? null,
    });
    setWishlisted(selected);
  };
  return (
    <Layout taxonomy={taxonomy}>
      <div className="pdp-page">
        <nav className="pdp-breadcrumbs container" aria-label="Breadcrumb">
          <a href="/">Home</a><ChevronRight />
          <a href={`/shop?category=${product.category.slug}`}>{product.category.name}</a><ChevronRight />
          <span>{product.title}</span>
        </nav>
        <section className="pdp-showcase container">
          <div className="pdp-gallery">
            <div className="pdp-thumbnails" aria-label="Product images">
              {gallery.map((item, index) => (
                <button
                  className={selectedMedia?.id === item.id ? "active" : ""}
                  onClick={() => setImage(item.url)}
                  aria-label={`View product image ${index + 1}`}
                  key={item.id}
                >
                  <img src={cloudinaryDeliveryUrl(item.publicId, 240) || item.url} alt={item.alt} />
                </button>
              ))}
            </div>
            <div className="pdp-main-image">
              {selectedMedia && (
                <img src={cloudinaryDeliveryUrl(selectedMedia.publicId, 1400) || selectedMedia.url} alt={selectedMedia.alt} />
              )}
              {gallery.length > 1 && (
                <>
                  <button type="button" className="pdp-gallery-arrow previous" onClick={() => moveGallery(-1)} aria-label="Previous product image"><ChevronLeft /></button>
                  <button type="button" className="pdp-gallery-arrow next" onClick={() => moveGallery(1)} aria-label="Next product image"><ChevronRight /></button>
                </>
              )}
              <span className="pdp-image-label">ISOLUTIONS SELECTED</span>
            </div>
          </div>
          <div className="pdp-purchase">
            <div className="pdp-product-heading">
              <div>
                {product.brand && <span className="pdp-brand">{product.brand.name}</span>}
                <h1>{product.title}</h1>
                {product.short_description && <p className="pdp-description">{product.short_description}</p>}
              </div>
              <div className="pdp-product-actions">
                {shareFeedback && <span role="status" aria-live="polite">{shareFeedback}</span>}
                <button type="button" onClick={shareProduct} aria-label="Share this product"><Share2 /></button>
                <button type="button" className={wishlisted ? "is-selected" : ""} onClick={toggleWishlist} aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"} aria-pressed={wishlisted}><Heart /></button>
              </div>
            </div>
            <div className="pdp-price">
              <strong>{formatPkrMinor(variant.priceMinor)}</strong>
              {compareAt && <del>{formatPkrMinor(compareAt)}</del>}
              {discount !== null && <span className="pdp-discount">Save {discount}%</span>}
            </div>
            <span className={`pdp-stock${variant.quantity > 0 ? "" : " unavailable"}`}>
              <i />{variant.quantity > 0 ? `Only ${variant.quantity} ${variant.quantity === 1 ? "unit" : "units"} left!` : "Out of stock"}
            </span>
            {(configurations.length > 1 || colors.length > 1) && (
              <div className="pdp-option-groups">
                {configurations.length > 1 && (
                  <fieldset className="pdp-option-group" data-option="configuration">
                    <legend className="sr-only">Size</legend>
                    <div className="pdp-size-row">
                      <span className="pdp-size-label" aria-hidden="true">Size</span>
                      <div className="pdp-size-options">
                        {configurations.map((configuration) => {
                          const candidates = product.variants.filter((item) => configurationLabel(item) === configuration);
                          const unavailable = !candidates.some((item) => item.quantity > 0);
                          return (
                            <button
                              type="button"
                              className={selectedConfiguration === configuration ? "selected" : ""}
                              disabled={unavailable}
                              onClick={() => selectConfiguration(configuration)}
                              key={configuration}
                            >
                              <span>{displayConfigurationLabel(configuration)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </fieldset>
                )}
                {colors.length > 1 && (
                  <fieldset className="pdp-option-group" data-option="color">
                    <legend className="sr-only">Color</legend>
                    <div className="pdp-color-row">
                      <span className="pdp-color-label" aria-hidden="true">Color</span>
                      <div className="pdp-color-options">
                        {colors.map((color) => {
                          const candidate = product.variants.find((item) =>
                            configurationLabel(item) === selectedConfiguration && item.color === color,
                          );
                          const unavailable = !candidate || candidate.quantity <= 0;
                        const colorVariantIds = product.variants
                          .filter((item) => item.color === color)
                          .map((item) => item.id);
                        const colorMedia = product.media.find((item) =>
                          item.isPrimary && colorVariantIds.some((id) => mediaIsAssignedToVariant(item, id)),
                        ) ?? product.media.find((item) =>
                          colorVariantIds.some((id) => mediaIsAssignedToVariant(item, id)),
                        ) ?? null;
                          return (
                            <button
                              type="button"
                              className={`${variant.color === color ? "selected" : ""}${!colorMedia ? " text-only" : ""}`.trim()}
                              disabled={unavailable}
                              onClick={() => selectColor(color)}
                              key={color}
                            >
                              {colorMedia && <img src={cloudinaryDeliveryUrl(colorMedia.publicId, 96) || colorMedia.url} alt="" />}
                              <span>{labelize(color)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </fieldset>
                )}
              </div>
            )}
            <div className="pdp-buying-controls">
              <div className="pdp-quantity-control" aria-label="Quantity selector">
                <span>Quantity</span>
                <div>
                  <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} disabled={quantity <= 1} aria-label="Decrease quantity"><Minus /></button>
                  <output aria-live="polite">{quantity}</output>
                  <button type="button" onClick={() => setQuantity((current) => Math.min(cartLineLimit(variant.quantity), current + 1))} disabled={variant.quantity <= 0 || quantity >= cartLineLimit(variant.quantity)} aria-label="Increase quantity"><Plus /></button>
                </div>
              </div>
              {recommendations.length > 0 && (
                <section className="pdp-fbt" aria-labelledby="pdp-fbt-title">
                  <h2 id="pdp-fbt-title">Frequently Bought Together</h2>
                  <div className="pdp-fbt-list">
                    {recommendations.map((item) => {
                      const itemVariant = item.variants[0];
                      const quickAddable = item.variants.length === 1 && itemVariant.quantity > 0;
                      const outOfStock = item.variants.every((candidate) => candidate.quantity <= 0);
                      const itemMedia = primaryMedia(item);
                      const itemCompareAt = itemVariant ? validCompareAt(itemVariant) : null;
                      const itemDiscount = itemVariant && itemCompareAt
                        ? Math.round(((itemCompareAt - itemVariant.priceMinor) / itemCompareAt) * 100)
                        : null;
                      const isAdded = addedRecommendationIds.includes(item.id);
                      return (
                        <article
                          className={`pdp-fbt-card${outOfStock ? " is-unavailable" : ""}${isAdded ? " is-added" : ""}`}
                          key={item.id}
                          role={quickAddable ? "button" : undefined}
                          tabIndex={quickAddable ? 0 : undefined}
                          aria-pressed={quickAddable ? isAdded : undefined}
                          aria-label={quickAddable ? (isAdded ? `Remove ${item.title} from cart` : `Add ${item.title} to cart`) : undefined}
                          onClick={quickAddable ? () => toggleRecommendationCart(item) : undefined}
                          onKeyDown={quickAddable ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleRecommendationCart(item);
                            }
                          } : undefined}
                        >
                          <div className="pdp-fbt-image">
                            {itemMedia && <img src={cloudinaryDeliveryUrl(itemMedia.publicId, 320) || itemMedia.url} alt={itemMedia.alt} />}
                          </div>
                          {isAdded && <span className="pdp-fbt-added">Added</span>}
                          {(outOfStock || itemDiscount) && <span className="pdp-fbt-badge">{outOfStock ? "Sold Out" : `${itemDiscount}% Off`}</span>}
                          <div className="pdp-fbt-copy">
                            {item.brand && <small>{item.brand.name}</small>}
                            <span className="pdp-fbt-title">{item.title}</span>
                            {itemVariant && <div className="pdp-fbt-price"><strong>{formatPkrMinor(itemVariant.priceMinor)}</strong>{itemCompareAt && <del>{formatPkrMinor(itemCompareAt)}</del>}</div>}
                            <span className={outOfStock ? "unavailable" : ""}>{outOfStock ? "Out of stock" : "In stock"}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              <div className="pdp-purchase-actions">
                <button type="button" className="pdp-add-cart" disabled={variant.quantity <= 0} onClick={() => addSelectionToCart(false)}><ShoppingCart />Add to Cart</button>
                <button type="button" className="pdp-buy-now" disabled={variant.quantity <= 0} onClick={() => addSelectionToCart(true)}>Buy Now</button>
              </div>
              <p className="pdp-purchase-feedback" role="status" aria-live="polite">{purchaseFeedback}</p>
            </div>
          </div>
        </section>
        <section className="pdp-facts-strip" aria-label="Selected product details">
          <div className="pdp-facts container">
            {commercialFacts.map(({ title, subtitle, animation }) => (
              <div key={title}>
                <ServiceCardAnimation animation={animation} reducedMotion={reducedMotion} />
                <span><strong>{title}</strong><small>{subtitle}</small></span>
              </div>
            ))}
          </div>
        </section>
        {product.specifications.length > 0 && (
          <section className="pdp-specifications">
            <div className="container">
              <div className="pdp-section-heading"><span className="eyebrow">SPECIFICATIONS</span><h2>The details,<br /><em>at a glance.</em></h2></div>
              <div className="pdp-spec-grid">
                {product.specifications.map((spec) => (
                  <div key={`${spec.group}-${spec.label}`}><small>{spec.label}</small><strong>{spec.value}</strong></div>
                ))}
              </div>
            </div>
          </section>
        )}
        {product.content && (
          <section className="pdp-story container">
            <div><span className="eyebrow accent">PRODUCT INFORMATION</span><h2>Made to fit<br />your everyday.</h2></div>
            <div><h3>{product.title}</h3><p>{product.content}</p></div>
          </section>
        )}
      </div>
    </Layout>
  );
}
const aboutPaymentMethods = [
  { title: "Credit/Debit Card", image: "/assets/about/payment/credit-debit-card.png" },
  { title: "Bank Transfer", image: "/assets/about/payment/bank-transfer.png" },
  { title: "Cash On Delivery", image: "/assets/about/payment/cash-on-delivery.png" },
  { title: "Installments", image: "/assets/about/payment/installments.png" },
] as const;

const aboutValues = [
  { title: "Customer First", icon: Handshake },
  { title: "Genuine Products", icon: Gem },
  { title: "Trust & Transparency", icon: BadgeCheck },
  { title: "Fast & Secure Delivery", icon: Truck },
  { title: "Customer Satisfaction", icon: ThumbsUp },
  { title: "Performance Driven", icon: ChartNoAxesCombined },
] as const;

const aboutDeliveryStats = [
  { value: 140, suffix: "+", label: "Cities Reached", icon: MapPinned },
  { value: 4, suffix: "", label: "Provinces", icon: Landmark },
  { value: 16, suffix: "+", label: "Years of Service", icon: History },
] as const;

const aboutTrustBenefits = [
  { title: "Nationwide Delivery", subtitle: "Eligible Products", icon: Truck, animation: "is-truck" },
  { title: "Cash on Delivery", subtitle: "Available", icon: Banknote, animation: "is-payment" },
  { title: "Authentic Products", subtitle: "Genuine & Verified", icon: BadgeCheck, animation: "is-authentic" },
  { title: "Open Parcel Facility", subtitle: "Shop With Confidence", icon: PackageOpen, animation: "is-parcel" },
] as const;

function AboutDeliveryReach() {
  const sectionRef = useRef<HTMLElement>(null);
  const hasAnimatedRef = useRef(false);
  const [counts, setCounts] = useState(() => aboutDeliveryStats.map(() => 0));

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const finalValues = aboutDeliveryStats.map((stat) => stat.value);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      hasAnimatedRef.current = true;
      setCounts(finalValues);
      return;
    }

    if (hasAnimatedRef.current) {
      setCounts(finalValues);
      return;
    }

    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.35 || hasAnimatedRef.current) return;
      hasAnimatedRef.current = true;
      observer.disconnect();
      const startedAt = performance.now();
      const duration = 1400;
      const animate = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setCounts(finalValues.map((value) => Math.round(value * eased)));
        if (progress < 1) frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }, { threshold: 0.35 });

    observer.observe(section);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="about-delivery-reach" aria-labelledby="about-delivery-title" ref={sectionRef}>
      <div className="about-delivery-head">
        <h2 id="about-delivery-title">Our Delivery Reach</h2>
        <p>Reliable delivery coverage across Pakistan for eligible products.</p>
      </div>
      <div className="about-delivery-grid">
        {aboutDeliveryStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <article className="about-delivery-card" key={stat.label} aria-label={`${stat.value}${stat.suffix} ${stat.label}`}>
              <Icon aria-hidden="true" />
              <strong aria-hidden="true">{counts[index]}{stat.suffix}</strong>
              <span>{stat.label}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AboutTrustBenefits() {
  return (
    <section className="about-trust-benefits" aria-label="Shopping benefits">
      <div className="about-trust-benefits-grid">
        {aboutTrustBenefits.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <article className={`about-trust-benefit ${benefit.animation}`} key={benefit.title}>
              <span className="about-trust-icon" aria-hidden="true"><Icon /></span>
              <div>
                <h3>{benefit.title}</h3>
                <p>{benefit.subtitle}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type NewsletterFeedback = {
  tone: "success" | "error";
  message: string;
} | null;

function AboutNewsletter() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<NewsletterFeedback>(null);

  const submitNewsletter = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const normalizedEmail = email.trim().toLowerCase();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!isValidEmail) {
      setFeedback({ tone: "error", message: "Please enter a valid email address." });
      return;
    }
    if (!supabase) {
      setFeedback({ tone: "error", message: "Something went wrong. Please try again." });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.rpc("subscribe_newsletter", {
        p_email: normalizedEmail,
        p_source: "about_page",
      });
      if (error) throw error;

      const alreadySubscribed = data === "already_subscribed";
      setFeedback({
        tone: "success",
        message: alreadySubscribed
          ? "You're already subscribed to iSolutions updates."
          : "You're subscribed! We'll keep you updated.",
      });
      setEmail("");
    } catch (error) {
      setFeedback({ tone: "error", message: isRateLimitError(error) ? RATE_LIMIT_MESSAGE : "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="about-newsletter" aria-labelledby="about-newsletter-title">
      <div className="about-newsletter-copy">
        <h2 id="about-newsletter-title">Stay Updated with iSolutions</h2>
        <p>Get new arrivals, exclusive offers and important product updates.</p>
      </div>
      <form className="about-newsletter-form" onSubmit={submitNewsletter} noValidate>
        <div className="about-newsletter-controls">
          <input
            id="about-newsletter-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Enter your email address"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (feedback) setFeedback(null);
            }}
            aria-describedby="about-newsletter-feedback"
            aria-invalid={feedback?.tone === "error"}
            disabled={submitting}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Subscribing…" : "Subscribe"}
          </button>
        </div>
        <p
          id="about-newsletter-feedback"
          className={`about-newsletter-feedback${feedback ? ` is-${feedback.tone}` : ""}`}
          role={feedback?.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback?.message ?? ""}
        </p>
      </form>
    </section>
  );
}

function AboutPage({ taxonomy }: { taxonomy: Taxonomy }) {
  return (
    <Layout taxonomy={taxonomy}>
      <div className="home-page about-page">
        <section className="about-intro" aria-labelledby="about-page-title">
          <div className="about-intro-content">
            <span className="about-eyebrow">ABOUT US</span>
            <div className="about-heading-row">
              <h1 id="about-page-title">About iSolutions Pakistan</h1>
              <span className="about-since">SINCE 2010</span>
            </div>
            <p>Since 2010, iSolutions Pakistan has been serving customers with a simple goal: to make technology easier to understand, easier to choose, and more dependable to buy. Over the years, we have grown with our customers while staying focused on the values that matter most — genuine products, clear guidance, transparent dealing, and dependable support.</p>
            <p>From smartphones and mobile accessories to laptops, tablets and everyday technology, we carefully select products that meet the needs of modern customers. Our aim is not simply to sell technology, but to help every customer make a confident and informed purchase.</p>
          </div>
          <figure className="about-intro-media">
            <img src="/assets/about/about-isolutions-v2.png" alt="iSolutions Pakistan technology collection" />
          </figure>
        </section>
        <section className="about-what" aria-labelledby="about-what-title">
          <span className="about-eyebrow">WHAT WE DO</span>
          <div className="about-what-grid">
            <h2 id="about-what-title">Technology, selected with purpose.</h2>
            <div>
              <p>We bring together a carefully selected range of smartphones, accessories, laptops, tablets and personal technology in one place. Every product is presented with clear specifications, practical guidance and straightforward information so customers can compare their options without unnecessary confusion.</p>
              <p>Whether someone is upgrading their phone, choosing a work device or looking for the right everyday accessory, our focus is to make the buying experience simple, informed and reliable.</p>
            </div>
          </div>
        </section>
        <section className="about-standards" aria-labelledby="about-standards-title">
          <figure className="about-standards-media">
            <img src="/assets/about/iphone-seller-recognition.png" alt="iSolutions Pakistan iPhone seller recognition" />
          </figure>
          <div className="about-standards-content">
            <span className="about-eyebrow">OUR STANDARDS</span>
            <h2 id="about-standards-title">Trust, clarity and consistency at every step.</h2>
            <p>We believe customers should know exactly what they are buying. From transparent pricing and product condition to PTA status, warranty details and delivery information, we keep the important details clear and straightforward. Every product is selected and presented with a focus on authenticity, consistency and long-term customer confidence.</p>
            <div className="about-recognition" aria-label="Pakistan’s top iPhone seller, 2024 to 2025">
              <span>PAKISTAN’S TOP iPHONE SELLER</span>
              <strong>2024–2025</strong>
            </div>
            <div className="about-experience">
              <span className="about-eyebrow">EXPERIENCE WE DELIVER</span>
              <h3>Support that continues beyond the purchase.</h3>
              <p>From choosing the right product to receiving it safely, we focus on making every step simple and dependable. Customers can expect practical guidance, secure packaging, clear communication and support whenever they need assistance. For us, a good buying experience does not end at checkout — it continues after the sale.</p>
            </div>
          </div>
        </section>
        <ShopByBrands
          heading="Brands We Offer"
          subtitle="Trusted names in technology, all in one place."
          headingId="brands-we-offer-title"
          className="about-brands"
        />
        <section className="about-payments" aria-labelledby="about-payments-title">
          <div className="about-payments-head">
            <h2 id="about-payments-title">Payment Methods</h2>
            <p>Multiple convenient ways to pay at iSolutions Pakistan.</p>
          </div>
          <div className="about-payments-grid">
            {aboutPaymentMethods.map((method) => (
              <article className="about-payment-card" key={method.title}>
                <img src={method.image} alt="" loading="lazy" />
                <h3>{method.title}</h3>
              </article>
            ))}
          </div>
        </section>
        <section className="about-values" aria-labelledby="about-values-title">
          <h2 id="about-values-title">Our Values</h2>
          <div className="about-values-grid">
            {aboutValues.map((value) => {
              const Icon = value.icon;
              return (
                <article className="about-value-card" key={value.title}>
                  <span aria-hidden="true"><Icon /></span>
                  <h3>{value.title}</h3>
                </article>
              );
            })}
          </div>
        </section>
        <section className="about-vision-mission" aria-label="Vision and mission">
          <article className="about-purpose-card is-vision">
            <Eye className="about-purpose-icon" aria-hidden="true" />
            <div className="about-purpose-content">
              <span className="about-purpose-number" aria-hidden="true">01</span>
              <span className="about-purpose-eyebrow">OUR VISION</span>
              <h2>To become Pakistan&apos;s most trusted destination for personal technology.</h2>
              <p>We envision a retail experience where customers can choose technology with complete confidence — supported by genuine products, clear information, knowledgeable guidance and service they can depend on.</p>
            </div>
          </article>
          <article className="about-purpose-card is-mission">
            <Target className="about-purpose-icon" aria-hidden="true" />
            <div className="about-purpose-content">
              <span className="about-purpose-number" aria-hidden="true">02</span>
              <span className="about-purpose-eyebrow">OUR MISSION</span>
              <h2>To make every technology purchase simple, transparent and reliable.</h2>
              <p>Our mission is to carefully select the right products, present them honestly, guide customers practically and provide dependable support before, during and after every purchase.</p>
            </div>
          </article>
        </section>
        <AboutDeliveryReach />
        <AboutTrustBenefits />
        <AboutNewsletter />
      </div>
    </Layout>
  );
}

function ContactPage({ taxonomy }: { taxonomy: Taxonomy }) {
  const [formValues, setFormValues] = useState({ name: "", email: "", phone: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<NewsletterFeedback>(null);

  const updateField = (field: keyof typeof formValues, value: string) => {
    setFormValues((current) => ({ ...current, [field]: value }));
    if (feedback) setFeedback(null);
  };

  const submitContactMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const values = {
      name: formValues.name.trim(),
      email: formValues.email.trim().toLowerCase(),
      phone: formValues.phone.trim(),
      message: formValues.message.trim(),
    };
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email);
    if (!values.name || !validEmail || !values.message) {
      setFeedback({ tone: "error", message: "Please enter your name, a valid email address, and a message." });
      return;
    }
    if (!supabase) {
      setFeedback({ tone: "error", message: "Something went wrong. Please try again." });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const { error } = await supabase.rpc("submit_contact_message", {
        p_name: values.name,
        p_email: values.email,
        p_phone: values.phone || null,
        p_message: values.message,
      });
      if (error) throw error;
      setFormValues({ name: "", email: "", phone: "", message: "" });
      setFeedback({ tone: "success", message: "Thank you! Your message has been sent." });
    } catch (error) {
      setFeedback({ tone: "error", message: isRateLimitError(error) ? RATE_LIMIT_MESSAGE : "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout taxonomy={taxonomy}>
      <div className="home-page contact-page">
        <section className="contact-intro" aria-labelledby="contact-page-title">
          <div className="contact-intro-copy">
            <span className="about-eyebrow">GET IN TOUCH</span>
            <h1 id="contact-page-title">Contact Us</h1>
            <p>Have a question about a product or need help choosing the right technology? Get in touch with iSolutions Pakistan and share how we can help.</p>
            <div className="contact-details" aria-label="Contact details">
              <div>
                <span>LOCATION</span>
                <strong>Karachi, Pakistan</strong>
              </div>
              <div>
                <span>SUPPORT</span>
                <strong>Product guidance available before you buy.</strong>
              </div>
            </div>
          </div>

          <form className="contact-form" onSubmit={submitContactMessage} noValidate>
            <div className="contact-form-heading">
              <h2>Send us a message</h2>
              <p>Complete the form and our team can review your enquiry.</p>
            </div>
            <label>
              <span>Name</span>
              <input type="text" name="name" autoComplete="name" value={formValues.name} onChange={(event) => updateField("name", event.target.value)} disabled={submitting} required />
            </label>
            <label>
              <span>Email</span>
              <input type="email" name="email" inputMode="email" autoComplete="email" value={formValues.email} onChange={(event) => updateField("email", event.target.value)} disabled={submitting} required />
            </label>
            <label>
              <span>Phone</span>
              <input type="tel" name="phone" inputMode="tel" autoComplete="tel" value={formValues.phone} onChange={(event) => updateField("phone", event.target.value)} disabled={submitting} />
            </label>
            <label className="contact-form-message">
              <span>Message</span>
              <textarea name="message" rows={5} value={formValues.message} onChange={(event) => updateField("message", event.target.value)} disabled={submitting} required />
            </label>
            <button type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send Message"}</button>
            <p className={`contact-form-feedback${feedback ? ` is-${feedback.tone}` : ""}`} role={feedback?.tone === "error" ? "alert" : "status"} aria-live="polite">
              {feedback?.message ?? ""}
            </p>
          </form>
        </section>
      </div>
    </Layout>
  );
}

const orderSteps = [
  {
    title: "Add Products to Your Cart",
    description: "Browse products and add your selected items to the shopping cart.",
  },
  {
    title: "Proceed to Checkout",
    description: "Review your cart and continue to checkout.",
  },
  {
    title: "Enter Delivery Details",
    description: "Provide your contact information, delivery address and required delivery details.",
  },
  {
    title: "Choose Payment Method",
    description: "Select the available payment method that suits you.",
  },
  {
    title: "Order Confirmation",
    description: "Review your order and complete the checkout process. Our team will confirm the order and delivery details.",
  },
] as const;

function HowToOrderPage({ taxonomy }: { taxonomy: Taxonomy }) {
  return (
    <Layout taxonomy={taxonomy}>
      <div className="home-page how-to-order-page">
        <section className="how-to-order" aria-labelledby="how-to-order-title">
          <div className="how-to-order-head">
            <span className="about-eyebrow">HOW TO ORDER</span>
            <h1 id="how-to-order-title">Placing an Order is Simple</h1>
            <p>Follow these simple steps to place your order with iSolutions Pakistan.</p>
          </div>
          <ol className="how-to-order-steps">
            {orderSteps.map((step, index) => (
              <li key={step.title}>
                <span className="how-to-order-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{step.title}</h2>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <AboutNewsletter />
      </div>
    </Layout>
  );
}

const frequentlyAskedQuestions = [
  {
    question: "How do I place an order?",
    answer: "Browse our products, add your selected items to the cart, proceed to checkout, enter your delivery details, choose a payment method, and confirm your order.",
  },
  {
    question: "How can I check product availability?",
    answer: "Current availability is shown on each published product page and may vary by product variant.",
  },
  {
    question: "What payment methods do you accept?",
    answer: "Available methods include Credit or Debit Card, Bank Transfer, Cash on Delivery and Installments. Confirm availability for your purchase with our team.",
  },
  {
    question: "Do you offer Cash on Delivery?",
    answer: "Cash on Delivery is available. Please confirm eligibility and delivery details for your selected product before purchase.",
  },
  {
    question: "Where do you deliver?",
    answer: "Eligible products can be delivered nationwide. The applicable delivery scope is shown with the product details.",
  },
  {
    question: "How do I confirm PTA status, condition and warranty?",
    answer: "Review the variant-specific PTA status, condition and warranty information shown on the product page before purchase.",
  },
  {
    question: "What is your return/support process?",
    answer: "Contact the iSolutions Pakistan team with your purchase details for current return or support guidance.",
  },
  {
    question: "How can I track or confirm my order?",
    answer: "Our team will confirm the order and delivery details. Contact us if you need an update about an order.",
  },
  {
    question: "How can I contact iSolutions Pakistan?",
    answer: "Use the Contact Us page to send your enquiry to the iSolutions Pakistan team in Karachi, Pakistan.",
  },
  {
    question: "What should I do if I need after-sale support?",
    answer: "Send your enquiry through the Contact Us page with the relevant purchase details so the team can review it.",
  },
] as const;

function FaqPage({ taxonomy }: { taxonomy: Taxonomy }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Layout taxonomy={taxonomy}>
      <div className="home-page faq-page">
        <section className="faq-section" aria-labelledby="faq-page-title">
          <div className="faq-head">
            <span className="about-eyebrow">FAQs</span>
            <h1 id="faq-page-title">Frequently Asked Questions</h1>
            <p>Helpful answers about products, ordering, payments, delivery and support.</p>
          </div>
          <div className="faq-list">
            {frequentlyAskedQuestions.map((item, index) => {
              const isOpen = openIndex === index;
              const panelId = `faq-panel-${index}`;
              return (
                <article className={`faq-item${isOpen ? " is-open" : ""}`} key={item.question}>
                  <h2>
                    <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpenIndex(isOpen ? null : index)}>
                      <span>{item.question}</span>
                      <span className="faq-toggle" aria-hidden="true">{isOpen ? <Minus /> : <Plus />}</span>
                    </button>
                  </h2>
                  <div className="faq-answer" id={panelId} aria-hidden={!isOpen}>
                    <div><p>{item.answer}</p></div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <AboutNewsletter />
      </div>
    </Layout>
  );
}

type PolicyContent = {
  title: string;
  intro: string;
  sections: ReadonlyArray<{ heading: string; paragraphs: readonly string[] }>;
};

const policyPages: Record<string, PolicyContent> = {
  "/shipping-cancellation-policy": {
    title: "Shipping & Cancellation Policy",
    intro: "An overview of how delivery availability and cancellation requests are handled by iSolutions Pakistan.",
    sections: [
      {
        heading: "Delivery coverage",
        paragraphs: ["Delivery coverage can differ by product. Eligible products may be available for nationwide delivery, while other products may have a more limited delivery scope."],
      },
      {
        heading: "Before placing an order",
        paragraphs: ["Review the delivery information shown with the selected product and variant. Payment and delivery availability may depend on the product, order and delivery location."],
      },
      {
        heading: "Order and delivery confirmation",
        paragraphs: ["Our team will confirm applicable order and delivery details. Product availability should be confirmed before completing an order."],
      },
      {
        heading: "Cancellation requests",
        paragraphs: ["Contact iSolutions Pakistan as soon as possible if you need to request a cancellation. The team will review the request according to the current status of the order."],
      },
    ],
  },
  "/return-policy": {
    title: "Return Policy",
    intro: "Practical guidance for customers who need assistance with a purchased product.",
    sections: [
      {
        heading: "Review product details",
        paragraphs: ["Product condition, PTA status and warranty information can vary by product and variant. Review these details carefully before ordering."],
      },
      {
        heading: "Requesting support",
        paragraphs: ["If you have a concern about a purchase, contact iSolutions Pakistan with the relevant product and order details so the team can review the matter."],
      },
      {
        heading: "Product assessment",
        paragraphs: ["Any available return or support path depends on the product details, condition, warranty information and the circumstances reported to the team."],
      },
      {
        heading: "Before sending a product",
        paragraphs: ["Please contact the team for current guidance before sending or returning any product."],
      },
    ],
  },
  "/privacy-policy": {
    title: "Privacy Policy",
    intro: "How iSolutions Pakistan handles information provided through the current website experience.",
    sections: [
      {
        heading: "Information you provide",
        paragraphs: ["The website may collect contact details and the information you include in contact or order enquiries. Newsletter subscriptions collect the email address submitted through the subscription form."],
      },
      {
        heading: "How information is used",
        paragraphs: ["Submitted information may be used to respond to enquiries, support customer communication, manage newsletter subscription status, improve the service and maintain website security."],
      },
      {
        heading: "Protected access",
        paragraphs: ["Contact enquiries and newsletter subscriber records are not publicly browseable. Administrative access is restricted through the website's protected admin controls."],
      },
      {
        heading: "Privacy enquiries",
        paragraphs: ["Use the Contact Us page if you have a question about information submitted through the website."],
      },
    ],
  },
  "/terms-and-conditions": {
    title: "Terms & Conditions",
    intro: "Practical terms for using the iSolutions Pakistan storefront and reviewing products before ordering.",
    sections: [
      {
        heading: "Product information",
        paragraphs: ["Products and variants may differ in availability, condition, PTA status, warranty and delivery scope. Customers should review the displayed product details before ordering."],
      },
      {
        heading: "Orders and availability",
        paragraphs: ["An order remains subject to confirmation of the selected product, its availability and the relevant order details."],
      },
      {
        heading: "Payment and delivery",
        paragraphs: ["Available payment methods and delivery arrangements may depend on the product, order and location. Applicable details should be confirmed as part of the ordering process."],
      },
      {
        heading: "Questions and support",
        paragraphs: ["Contact iSolutions Pakistan if you need clarification about a product, order, delivery detail or after-sale support request."],
      },
    ],
  },
};

function PolicyPage({ taxonomy, policy }: { taxonomy: Taxonomy; policy: PolicyContent }) {
  return (
    <Layout taxonomy={taxonomy}>
      <div className="home-page policy-page">
        <article className="policy-content" aria-labelledby="policy-page-title">
          <div className="policy-head">
            <span className="about-eyebrow">POLICIES</span>
            <h1 id="policy-page-title">{policy.title}</h1>
            <p>{policy.intro}</p>
          </div>
          <div className="policy-sections">
            {policy.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </section>
            ))}
          </div>
        </article>
        <AboutNewsletter />
      </div>
    </Layout>
  );
}
export function StorefrontApp() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({
    brands: [],
    categories: [],
  });
  const [taxonomyReady, setTaxonomyReady] = useState(false);
  useEffect(() => {
    fetchPublicTaxonomy()
      .then(setTaxonomy)
      .catch(() => undefined)
      .finally(() => setTaxonomyReady(true));
  }, []);
  const path = location.pathname;
  if (path === "/about") return <AboutPage taxonomy={taxonomy} />;
  if (path === "/contact") return <ContactPage taxonomy={taxonomy} />;
  if (path === "/how-to-order") return <HowToOrderPage taxonomy={taxonomy} />;
  if (path === "/faqs") return <FaqPage taxonomy={taxonomy} />;
  if (path === "/checkout") return <CheckoutPage taxonomy={taxonomy} />;
  if (path === "/order-success") return <OrderSuccessPage taxonomy={taxonomy} />;
  if (policyPages[path]) return <PolicyPage taxonomy={taxonomy} policy={policyPages[path]} />;
  if (path === "/shop") return <Shop taxonomy={taxonomy} />;
  if (path.startsWith("/collections/")) {
    const collection = resolveCollection(path, taxonomy, location.search);
    return (
      <CollectionPage
        taxonomy={taxonomy}
        taxonomyReady={taxonomyReady}
        collection={collection}
      />
    );
  }
  if (path.startsWith("/product/"))
    return <PDP slug={decodeURIComponent(path.slice(9))} taxonomy={taxonomy} />;
  return <Home taxonomy={taxonomy} />;
}
