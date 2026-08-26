import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Heart,
  Headphones,
  Menu,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  User,
  X,
} from "lucide-react";
import {
  fetchPublicCatalog,
  fetchPublicTaxonomy,
  formatPkrMinor,
  hasVariablePrice,
  primaryMedia,
  productPrice,
  validCompareAt,
  type CatalogFilters,
  type CatalogProduct,
  type CatalogVariant,
} from "./lib/catalog";
import { parsePkrMajorToMinor } from "./lib/money";
import { cloudinaryDeliveryUrl } from "./lib/cloudinary";

type Taxonomy = Awaited<ReturnType<typeof fetchPublicTaxonomy>>;

function Header({ taxonomy }: { taxonomy: Taxonomy }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(
    new URLSearchParams(location.search).get("q") ?? "",
  );
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    location.href = `/shop${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`;
  };
  return (
    <>
      <div className="trustbar">
        <span>Curated technology, thoughtfully presented</span>
        <span className="trust-wide">
          Delivery scope confirmed per product · Support before you buy
        </span>
      </div>
      <header>
        <a className="wordmark" href="/" aria-label="iSolutions Pakistan home">
          iSolutions <b>Pakistan</b>
        </a>
        <form className="search" onSubmit={submit}>
          <Search size={19} />
          <input
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, brands and categories"
          />
        </form>
        <nav className="icons" aria-label="Utility">
          <button aria-label="Wishlist">
            <Heart />
          </button>
          <button aria-label="Account">
            <User />
          </button>
        </nav>
        <button
          className="menu"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu />
        </button>
      </header>
      <div className="navrow">
        <a href="/shop">Shop all</a>
        {taxonomy.categories.slice(0, 6).map((c) => (
          <a href={`/shop?category=${encodeURIComponent(c.slug)}`} key={c.id}>
            {c.name}
          </a>
        ))}
      </div>
      {open && (
        <div className="drawer">
          <div className="drawer-head">
            <span className="wordmark">
              iSolutions <b>Pakistan</b>
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close menu">
              <X />
            </button>
          </div>
          <form className="mobile-search search" onSubmit={submit}>
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the catalog"
              aria-label="Search products"
            />
          </form>
          <nav>
            <a href="/shop">
              Shop all <ArrowRight size={18} />
            </a>
            {taxonomy.categories.map((c) => (
              <a
                href={`/shop?category=${encodeURIComponent(c.slug)}`}
                key={c.id}
              >
                {c.name}
                <ArrowRight size={18} />
              </a>
            ))}
          </nav>
          <div className="drawer-meta">
            Real published catalog · Commerce not yet enabled
          </div>
        </div>
      )}
    </>
  );
}

function Footer() {
  return (
    <footer>
      <div className="footer-top">
        <div>
          <a className="wordmark light" href="/">
            iSolutions <b>Pakistan</b>
          </a>
          <p>A considered destination for personal technology.</p>
        </div>
        <div>
          <h4>Explore</h4>
          <a href="/shop">Shop all</a>
          <a href="/shop">New arrivals</a>
        </div>
        <div>
          <h4>Help</h4>
          <a href="#">Contact</a>
          <a href="#">Delivery</a>
          <a href="#">Warranty</a>
        </div>
        <div>
          <h4>Visit</h4>
          <p>
            Karachi, Pakistan
            <br />
            Store details to be confirmed.
          </p>
        </div>
      </div>
      <div className="footer-bottom">
        © 2026 iSolutions Pakistan · Published catalog data supplied by
        iSolutions
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
        Products appear here only after Owner-approved facts, an explicit
        sellable variant, inventory, and Cloudinary media pass publication
        validation.
      </p>
    </div>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  const media = primaryMedia(product);
  const price = productPrice(product);
  const inStock = product.variants.some((variant) => variant.quantity > 0);
  return (
    <article className="product-card">
      <a className="product-image" href={`/product/${product.slug}`}>
        {media ? (
          <img
            src={cloudinaryDeliveryUrl(media.publicId, 720) || media.url}
            alt={media.alt}
          />
        ) : null}
        <button aria-label={`Save ${product.title}`} className="save">
          <Heart size={18} />
        </button>
      </a>
      <div className="product-copy">
        <span className="eyebrow">
          {product.brand.name} · {product.category.name}
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
        </div>
        <div className="status">
          <span className={`dot${inStock ? "" : " unavailable"}`} />
          {inStock ? "In stock" : "Out of stock"}
        </div>
      </div>
    </article>
  );
}

function SectionHead({
  kicker,
  title,
  link = "View all",
}: {
  kicker: string;
  title: string;
  link?: string;
}) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow accent">{kicker}</span>
        <h2>{title}</h2>
      </div>
      <a href="/shop">
        {link}
        <ArrowRight size={18} />
      </a>
    </div>
  );
}

function Home({ taxonomy }: { taxonomy: Taxonomy }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchPublicCatalog({ limit: 8 })
      .then(setProducts)
      .catch(() =>
        setError("The published catalog is temporarily unavailable."),
      )
      .finally(() => setLoading(false));
  }, []);
  return (
    <Layout taxonomy={taxonomy}>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow hero-label">THE ISOLUTIONS EDIT</span>
          <h1>
            Technology,
            <br />
            <em>considered.</em>
          </h1>
          <p>
            Discover a quieter, sharper way to shop Owner-approved devices and
            accessories.
          </p>
          <div className="hero-actions">
            <a className="btn primary" href="/shop">
              Explore the catalog <ArrowRight />
            </a>
          </div>
        </div>
        <div className="hero-visual">
          <img src="/assets/phone-main.jpg" alt="Editorial smartphone detail" />
          <div className="hero-note">
            <span>EDITORIAL</span>
            <strong>Published product facts remain database-backed.</strong>
          </div>
        </div>
      </section>
      <section className="category-section container">
        <SectionHead
          kicker="Find your next"
          title="Shop by category"
          link="Explore all categories"
        />
        <div className="brand-row">
          {taxonomy.categories.length ? (
            taxonomy.categories.map((c) => (
              <a href={`/shop?category=${c.slug}`} key={c.id}>
                {c.name}
              </a>
            ))
          ) : (
            <p>
              Categories will appear when approved real catalog records are
              active.
            </p>
          )}
        </div>
      </section>
      <section className="products-section container">
        <SectionHead kicker="Recently published" title="New Arrivals" />
        <div className="product-grid home-products">
          {products.slice(0, 4).map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
        {!loading && !error && products.length === 0 && <CatalogEmpty />}
        {error && <CatalogEmpty title={error} />}
      </section>
      <section className="editorial">
        <div className="editorial-image">
          <img src="/assets/laptop.jpg" alt="Editorial laptop setting" />
        </div>
        <div className="editorial-copy">
          <span className="eyebrow">EDITORIAL CAMPAIGN</span>
          <h2>
            Light work.
            <br />
            Big thinking.
          </h2>
          <p>
            Editorial presentation remains separate from catalog pricing,
            inventory, and specifications.
          </p>
          <a href="/shop" className="btn pale">
            Browse published products <ArrowRight />
          </a>
        </div>
      </section>
      {products.length > 4 && (
        <section className="products-section container">
          <SectionHead kicker="Explore the catalog" title="Popular Right Now" />
          <div className="product-grid home-products">
            {products.slice(4, 8).map((p) => (
              <ProductCard product={p} key={p.id} />
            ))}
          </div>
        </section>
      )}
      <Trust />
    </Layout>
  );
}

function Trust() {
  return (
    <section className="trust-section container">
      <div>
        <ShieldCheck />
        <h3>Buy with clarity</h3>
        <p>Product status and terms are shown from approved records.</p>
      </div>
      <div>
        <Truck />
        <h3>Delivery, explained</h3>
        <p>Scope is explicit for every published variant.</p>
      </div>
      <div>
        <Headphones />
        <h3>Human support</h3>
        <p>Get thoughtful guidance before and after you buy.</p>
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
    brands: [],
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
  return (
    <Layout taxonomy={taxonomy}>
      <div className="shop-intro container">
        <span className="eyebrow accent">THE COLLECTION</span>
        <h1>
          Technology for
          <br />
          <em>real life.</em>
        </h1>
        <p>Only published, Owner-approved real catalog records appear here.</p>
      </div>
      <div className="shop-toolbar container">
        <span>
          {loading
            ? "Loading published products…"
            : `${products.length} published product${products.length === 1 ? "" : "s"}`}
        </span>
        <button className="filter-trigger" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal /> Filters
        </button>
      </div>
      <div className="catalog container">
        <aside>
          <Filters value={filters} taxonomy={taxonomy} onChange={setFilters} />
        </aside>
        <div className="product-grid shop-grid">
          {products.map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
      </div>
      {!loading && !error && products.length === 0 && (
        <div className="container">
          <CatalogEmpty title="No published products match these filters." />
        </div>
      )}
      {error && (
        <div className="container">
          <CatalogEmpty title={error} />
        </div>
      )}
      {filtersOpen && (
        <div className="filter-drawer">
          <div>
            <h2>Filters</h2>
            <button
              onClick={() => setFiltersOpen(false)}
              aria-label="Close filters"
            >
              <X />
            </button>
          </div>
          <Filters value={filters} taxonomy={taxonomy} onChange={setFilters} />
          <button
            className="btn primary full"
            onClick={() => setFiltersOpen(false)}
          >
            Show {products.length} products
          </button>
        </div>
      )}
    </Layout>
  );
}

const labelize = (value: string | null) =>
  value
    ? value.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase())
    : "Unresolved";
function PDP({ slug, taxonomy }: { slug: string; taxonomy: Taxonomy }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [variantId, setVariantId] = useState("");
  const [image, setImage] = useState("");
  useEffect(() => {
    fetchPublicCatalog({ slug, limit: 1 })
      .then((items) => {
        const next = items[0] ?? null;
        setProduct(next);
        setVariantId(next?.variants[0]?.id ?? "");
        setImage(primaryMedia(next!)?.url ?? "");
      })
      .catch(() => setError("This product could not be loaded."))
      .finally(() => setLoading(false));
  }, [slug]);
  if (loading)
    return (
      <Layout taxonomy={taxonomy}>
        <div className="container catalog-empty">
          <h2>Loading product…</h2>
        </div>
      </Layout>
    );
  if (error || !product)
    return (
      <Layout taxonomy={taxonomy}>
        <div className="container">
          <CatalogEmpty title={error || "Published product not found."} />
        </div>
      </Layout>
    );
  const variant =
    product.variants.find((item) => item.id === variantId) ??
    product.variants[0];
  const compareAt = variant ? validCompareAt(variant) : null;
  const gallery = product.media.filter(
    (item) => !item.variantId || item.variantId === variant.id,
  );
  const selectedMedia =
    gallery.find((item) => item.url === image) ??
    gallery[0] ??
    primaryMedia(product);
  return (
    <Layout taxonomy={taxonomy}>
      <div className="breadcrumbs container">
        <a href="/">Home</a>
        <ChevronRight />
        <a href={`/shop?category=${product.category.slug}`}>
          {product.category.name}
        </a>
        <ChevronRight />
        <span>{product.title}</span>
      </div>
      <section className="pdp container">
        <div className="gallery">
          <div className="thumbs">
            {gallery.map((item) => (
              <button
                className={selectedMedia?.id === item.id ? "active" : ""}
                onClick={() => setImage(item.url)}
                key={item.id}
              >
                <img
                  src={cloudinaryDeliveryUrl(item.publicId, 240) || item.url}
                  alt={item.alt}
                />
              </button>
            ))}
          </div>
          <div className="main-image">
            {selectedMedia && (
              <img
                src={
                  cloudinaryDeliveryUrl(selectedMedia.publicId, 1400) ||
                  selectedMedia.url
                }
                alt={selectedMedia.alt}
              />
            )}
          </div>
        </div>
        <div className="purchase">
          <span className="eyebrow accent">
            {product.brand.name} · {product.category.name}
          </span>
          <h1>{product.title}</h1>
          {product.short_description && <p>{product.short_description}</p>}
          <div className="pdp-price">
            <strong>{formatPkrMinor(variant.priceMinor)}</strong>
            {compareAt && <del>{formatPkrMinor(compareAt)}</del>}
          </div>
          <fieldset>
            <legend>Explicit variant</legend>
            <div className="options variant-options">
              {product.variants.map((item) => (
                <button
                  className={item.id === variant.id ? "selected" : ""}
                  onClick={() => {
                    setVariantId(item.id);
                    const media =
                      product.media.find((m) => m.variantId === item.id) ??
                      primaryMedia(product);
                    setImage(media?.url ?? "");
                  }}
                  key={item.id}
                >
                  {[item.storage, item.ram, item.color]
                    .filter(Boolean)
                    .join(" · ") || item.sku}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="purchase-facts">
            <div>
              <Check />
              <span>
                <b>PTA status</b>
                {labelize(variant.ptaStatus)}
              </span>
            </div>
            <div>
              <Check />
              <span>
                <b>Condition</b>
                {labelize(variant.condition)}
              </span>
            </div>
            <div>
              <Check />
              <span>
                <b>Warranty</b>
                {variant.warranty}
              </span>
            </div>
            <div>
              <Truck />
              <span>
                <b>Delivery</b>
                {labelize(variant.deliveryScope)}
              </span>
            </div>
            <div>
              <ShieldCheck />
              <span>
                <b>Availability</b>
                {variant.quantity > 0
                  ? `${variant.quantity} in stock`
                  : "Out of stock"}
              </span>
            </div>
          </div>
          <div className="validation-callout">
            <ShieldCheck />
            <div>
              <strong>Catalog information verified</strong>
              <p>
                Purchasing is not enabled in Phase 4. No cart, order, or payment
                will be created.
              </p>
            </div>
          </div>
        </div>
      </section>
      {product.specifications.length > 0 && (
        <section className="spec-band">
          <div className="container">
            <span className="eyebrow">SPECIFICATIONS</span>
            <h2>Product details.</h2>
            <div className="spec-grid">
              {product.specifications.map((spec) => (
                <div key={`${spec.group}-${spec.label}`}>
                  <small>{spec.label}</small>
                  <strong>{spec.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {product.content && (
        <section className="details container">
          <div>
            <span className="eyebrow accent">PRODUCT INFORMATION</span>
            <h2>{product.title}</h2>
          </div>
          <div>
            <p>{product.content}</p>
          </div>
        </section>
      )}
    </Layout>
  );
}

export function StorefrontApp() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({
    brands: [],
    categories: [],
  });
  useEffect(() => {
    fetchPublicTaxonomy()
      .then(setTaxonomy)
      .catch(() => undefined);
  }, []);
  const path = location.pathname;
  if (path === "/shop") return <Shop taxonomy={taxonomy} />;
  if (path.startsWith("/product/"))
    return <PDP slug={decodeURIComponent(path.slice(9))} taxonomy={taxonomy} />;
  return <Home taxonomy={taxonomy} />;
}
