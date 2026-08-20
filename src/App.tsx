import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  User,
  X,
  ShieldCheck,
  Truck,
  Headphones,
  RotateCcw,
  Check,
} from "lucide-react";
import {
  explicitVariants,
  pkr,
  products,
  type Product,
} from "./data/mockCatalog";
const AdminApp = lazy(() =>
  import("./admin/AdminApp").then((module) => ({ default: module.AdminApp })),
);
const cats = [
  "Mobiles",
  "Laptops",
  "Tablets",
  "Watches",
  "Gaming",
  "Accessories",
];
function PrototypeTag() {
  return (
    <div className="prototype-tag">Visual Prototype — Mock Catalog Data</div>
  );
}
function Header() {
  const [open, setOpen] = useState(false);
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
        <div className="search">
          <Search size={19} />
          <input
            aria-label="Search products"
            placeholder="Search phones, laptops, audio and more"
          />
        </div>
        <nav className="icons" aria-label="Utility">
          <button aria-label="Wishlist">
            <Heart />
          </button>
          <button aria-label="Account">
            <User />
          </button>
          <button aria-label="Cart">
            <ShoppingBag />
            <i>0</i>
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
        {cats.map((c) => (
          <a href="/shop" key={c}>
            {c}
          </a>
        ))}
        <a className="deal-link" href="/shop">
          Deals
        </a>
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
          <div className="mobile-search search">
            <Search />
            <input
              placeholder="Search the catalog"
              aria-label="Search products"
            />
          </div>
          <nav>
            {["Shop all", ...cats, "Deals"].map((x) => (
              <a href="/shop" key={x}>
                {x}
                <ArrowRight size={18} />
              </a>
            ))}
          </nav>
          <div className="drawer-meta">
            Prototype navigation · No account or commerce functions
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
          <p>
            A considered destination for personal technology. Visual direction
            prototype for owner review.
          </p>
        </div>
        <div>
          <h4>Explore</h4>
          <a href="/shop">Shop all</a>
          <a href="/shop">New arrivals</a>
          <a href="/shop">Buying guides</a>
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
        © 2026 iSolutions Pakistan · Visual prototype only <PrototypeTag />
      </div>
    </footer>
  );
}
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
function ProductCard({ p }: { p: Product }) {
  return (
    <article className="product-card">
      <a
        className="product-image"
        href={
          p.id === "prototype-flagship-phone"
            ? "/product/prototype-flagship-phone"
            : "/shop"
        }
      >
        <img src={p.image} alt={p.name} />
        {p.badge && <span className="badge">{p.badge}</span>}
        <button aria-label={`Save ${p.name}`} className="save">
          <Heart size={18} />
        </button>
      </a>
      <div className="product-copy">
        <span className="eyebrow">
          {p.brand} · {p.category}
        </span>
        <h3>
          <a
            href={
              p.id === "prototype-flagship-phone"
                ? "/product/prototype-flagship-phone"
                : "/shop"
            }
          >
            {p.name}
          </a>
        </h3>
        <p className="detail">{p.detail}</p>
        <div className="price">
          <strong>{pkr(p.price)}</strong>
          {p.compareAt && <del>{pkr(p.compareAt)}</del>}
        </div>
        <div className="status">
          <span className="dot" />
          {p.status}
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
function Home() {
  return (
    <Layout>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow hero-label">THE FLAGSHIP EDIT · 01</span>
          <h1>
            Technology,
            <br />
            <em>considered.</em>
          </h1>
          <p>
            Discover a quieter, sharper way to shop the devices that shape your
            day.
          </p>
          <div className="hero-actions">
            <a className="btn primary" href="/product/prototype-flagship-phone">
              Explore the flagship <ArrowRight />
            </a>
            <a className="text-link" href="/shop">
              Shop the collection
            </a>
          </div>
        </div>
        <div className="hero-visual">
          <img
            src={products[0].image}
            alt="Flagship smartphone prototype feature"
          />
          <div className="hero-note">
            <span>Aster One Pro 5G</span>
            <strong>Designed for the everyday extraordinary.</strong>
          </div>
        </div>
        <div className="hero-index">
          01 <span /> 03
        </div>
      </section>
      <section className="category-section container">
        <SectionHead
          kicker="Find your next"
          title="Shop by category"
          link="Explore all categories"
        />
        <div className="category-grid">
          <a className="cat-large" href="/shop">
            <img src={products[0].image} alt="Smartphone collection" />
            <span>
              Smartphones <ArrowRight />
            </span>
          </a>
          <div className="cat-stack">
            <a href="/shop">
              <span>
                Laptops<small>Portable power</small>
              </span>
              <img src={products[1].image} alt="Laptop collection" />
            </a>
            <a href="/shop">
              <span>
                Sound<small>Personal audio</small>
              </span>
              <img src={products[4].image} alt="Audio collection" />
            </a>
          </div>
          <div className="cat-list">
            {["Tablets", "Watches", "Gaming", "Accessories"].map((x, i) => (
              <a href="/shop" key={x}>
                <b>0{i + 3}</b>
                <span>{x}</span>
                <ArrowRight />
              </a>
            ))}
          </div>
        </div>
      </section>
      <section className="products-section container">
        <SectionHead kicker="Freshly curated" title="New Arrivals" />
        <div className="product-grid home-products">
          {products.slice(0, 4).map((p) => (
            <ProductCard p={p} key={p.id} />
          ))}
        </div>
      </section>
      <section className="editorial">
        <div className="editorial-image">
          <img src={products[1].image} alt="Laptop in an editorial setting" />
        </div>
        <div className="editorial-copy">
          <span className="eyebrow">THE WORK / LIFE ISSUE</span>
          <h2>
            Light work.
            <br />
            Big thinking.
          </h2>
          <p>
            Our prototype edit of focused, beautifully made tools for wherever
            work happens next.
          </p>
          <a href="/shop" className="btn pale">
            Discover laptops <ArrowRight />
          </a>
        </div>
      </section>
      <section className="deal container">
        <div>
          <span className="eyebrow">48 HOURS · PROTOTYPE PROMOTION</span>
          <h2>
            The weekend
            <br />
            <em>game plan.</em>
          </h2>
          <p>A focused gaming bundle concept—one offer, no noise.</p>
          <a className="btn primary" href="/shop">
            Enter the game <ArrowRight />
          </a>
        </div>
        <img src={products[5].image} alt="Gaming console and controller" />
        <div className="deal-price">
          <small>Mock bundle price</small>
          <strong>{pkr(189500)}</strong>
        </div>
      </section>
      <section className="brands container">
        <SectionHead kicker="Names that matter" title="Explore by brand" />
        <div className="brand-row">
          {["Apple", "Samsung", "Sony", "Motorola", "Vivo", "Nothing"].map(
            (x) => (
              <a href="/shop" key={x}>
                {x}
              </a>
            ),
          )}
        </div>
      </section>
      <section className="products-section container">
        <SectionHead kicker="People are noticing" title="Popular Right Now" />
        <div className="product-grid home-products">
          {products.slice(4, 8).map((p) => (
            <ProductCard p={p} key={p.id} />
          ))}
        </div>
      </section>
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
        <p>Product status and terms are shown before purchase.</p>
      </div>
      <div>
        <Truck />
        <h3>Delivery, explained</h3>
        <p>Scope and timing will be confirmed per product.</p>
      </div>
      <div>
        <Headphones />
        <h3>Human support</h3>
        <p>Get thoughtful guidance before and after you buy.</p>
      </div>
      <div>
        <RotateCcw />
        <h3>Clear policies</h3>
        <p>Returns and warranty details will be plainly stated.</p>
      </div>
    </section>
  );
}
function Filters() {
  // Visual-only prototype filter labels. These are not derived from real inventory.
  const filterOptions: Record<string, string[]> = {
    Category: ["Mobiles", "Laptops", "Accessories"],
    Brand: ["Apple", "Samsung", "Sony"],
    Price: [
      "Under PKR 50,000",
      "PKR 50,000–100,000",
      "PKR 100,000–250,000",
      "PKR 250,000+",
    ],
    Storage: ["128 GB", "256 GB", "512 GB"],
    RAM: ["8 GB", "12 GB", "16 GB+"],
    "PTA Status": ["PTA approved", "PTA status unconfirmed"],
    Availability: ["In stock", "Limited", "Pre-order"],
    "Delivery Scope": ["Karachi", "Nationwide", "Scope unconfirmed"],
  };
  return (
    <div className="filters">
      {[
        "Category",
        "Brand",
        "Price",
        "Storage",
        "RAM",
        "PTA Status",
        "Availability",
        "Delivery Scope",
      ].map((f, i) => (
        <details key={f} open={i < 3}>
          <summary>
            {f}
            <ChevronDown />
          </summary>
          {filterOptions[f].map((option) => (
            <label key={option}>
              <input type="checkbox" /> {option}
            </label>
          ))}
        </details>
      ))}
    </div>
  );
}
function Shop() {
  const [filters, setFilters] = useState(false);
  return (
    <Layout>
      <div className="shop-intro container">
        <span className="eyebrow accent">THE COLLECTION</span>
        <h1>
          Technology for
          <br />
          <em>real life.</em>
        </h1>
        <p>
          A prototype assortment of phones, computing, play and personal tech.
        </p>
      </div>
      <div className="shop-toolbar container">
        <span>Showing 8 prototype products</span>
        <div>
          <button className="filter-trigger" onClick={() => setFilters(true)}>
            <SlidersHorizontal /> Filters
          </button>
          <label>
            Sort by{" "}
            <select aria-label="Sort products">
              <option>Featured</option>
              <option>Price: low to high</option>
              <option>Newest</option>
            </select>
          </label>
        </div>
      </div>
      <div className="catalog container">
        <aside>
          <Filters />
        </aside>
        <div className="product-grid shop-grid">
          {products.map((p) => (
            <ProductCard p={p} key={p.id} />
          ))}
        </div>
      </div>
      {filters && (
        <div className="filter-drawer">
          <div>
            <h2>Filters</h2>
            <button
              onClick={() => setFilters(false)}
              aria-label="Close filters"
            >
              <X />
            </button>
          </div>
          <Filters />
          <button
            className="btn primary full"
            onClick={() => setFilters(false)}
          >
            Show 8 products
          </button>
        </div>
      )}
    </Layout>
  );
}
function PDP() {
  const p = products[0];
  const [image, setImage] = useState(p.gallery![0]);
  const [storage, setStorage] = useState("256 GB");
  const colors = useMemo(
    () =>
      explicitVariants.filter((v) => v.storage === storage).map((v) => v.color),
    [storage],
  );
  const [color, setColor] = useState("Obsidian");
  useEffect(() => {
    if (!colors.includes(color)) setColor(colors[0]);
  }, [storage, colors, color]);
  return (
    <Layout>
      <div className="breadcrumbs container">
        <a href="/">Home</a>
        <ChevronRight /> <a href="/shop">Mobiles</a>
        <ChevronRight /> <span>{p.name}</span>
      </div>
      <section className="pdp container">
        <div className="gallery">
          <div className="thumbs">
            {p.gallery!.map((g, i) => (
              <button
                className={image === g ? "active" : ""}
                onClick={() => setImage(g)}
                key={g}
              >
                <img src={g} alt={`${p.name} view ${i + 1}`} />
              </button>
            ))}
          </div>
          <div className="main-image">
            <img src={image} alt={p.name} />
            <button className="gallery-prev" aria-label="Previous image">
              <ChevronLeft />
            </button>
            <button className="gallery-next" aria-label="Next image">
              <ChevronRight />
            </button>
          </div>
        </div>
        <div className="purchase">
          <span className="eyebrow accent">{p.brand} · FLAGSHIP SERIES</span>
          <h1>{p.name}</h1>
          <div className="rating">
            <span>
              <Star fill="currentColor" /> 4.8
            </span>
            <u>124 mock reviews</u>
            <span>Prototype rating</span>
          </div>
          <div className="pdp-price">
            <strong>{pkr(p.price)}</strong>
            <del>{pkr(p.compareAt!)}</del>
            <span>Mock launch price</span>
          </div>
          <p className="promo">
            <b>Prototype offer</b> · Concept-only accessory bundle shown at
            checkout
          </p>
          <fieldset>
            <legend>
              Storage <b>{storage}</b>
            </legend>
            <div className="options">
              {["256 GB", "512 GB"].map((s) => (
                <button
                  className={storage === s ? "selected" : ""}
                  onClick={() => setStorage(s)}
                  key={s}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              Finish <b>{color}</b>
            </legend>
            <div className="options colors">
              {["Obsidian", "Pearl"].map((c) => {
                const valid = explicitVariants.some(
                  (v) => v.storage === storage && v.color === c,
                );
                return (
                  <button
                    className={color === c ? "selected" : ""}
                    disabled={!valid}
                    onClick={() => setColor(c)}
                    key={c}
                  >
                    <i className={c.toLowerCase()} />
                    {c}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="purchase-facts">
            <div>
              <Check />{" "}
              <span>
                <b>PTA status</b>
                {p.pta}
              </span>
            </div>
            <div>
              <Check />{" "}
              <span>
                <b>Condition</b>Brand new · mock
              </span>
            </div>
            <div>
              <Check />{" "}
              <span>
                <b>Warranty</b>Prototype terms — unverified
              </span>
            </div>
            <div>
              <Truck />{" "}
              <span>
                <b>Delivery</b>Scope confirmed before purchase
              </span>
            </div>
          </div>
          <div className="cta-row">
            <button className="btn dark">
              <ShoppingBag /> Add to cart
            </button>
            <button className="btn primary">Buy now</button>
          </div>
          <small className="cta-note">
            Prototype interface only. No order or payment will be created.
          </small>
        </div>
      </section>
      <section className="spec-band">
        <div className="container">
          <span className="eyebrow">AT A GLANCE</span>
          <h2>
            The details that
            <br />
            make the difference.
          </h2>
          <div className="spec-grid">
            {[
              ["Display", "6.7” adaptive OLED"],
              ["Camera", "50 MP triple system"],
              ["Performance", "Aster X1 processor"],
              ["Battery", "All-day, 30W charging"],
            ].map((x) => (
              <div key={x[0]}>
                <small>{x[0]}</small>
                <strong>{x[1]}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="details container">
        <div>
          <span className="eyebrow accent">PRODUCT STORY</span>
          <h2>
            Made to feel
            <br />
            effortless.
          </h2>
        </div>
        <div>
          <p>
            A visual-only product narrative for a fictional flagship. The
            considered proportions, quiet interface and focused camera story
            demonstrate the intended product-detail hierarchy.
          </p>
          <details open>
            <summary>
              Design & display <ChevronDown />
            </summary>
            <p>
              Prototype copy: edge-to-edge display, balanced materials and a
              refined tactile finish.
            </p>
          </details>
          <details>
            <summary>
              What’s in the box <ChevronDown />
            </summary>
            <p>Prototype contents are not final or commercially verified.</p>
          </details>
          <details>
            <summary>
              Delivery & warranty <ChevronDown />
            </summary>
            <p>
              Terms will be confirmed only after architecture and catalog
              approval.
            </p>
          </details>
        </div>
      </section>
      <section className="products-section container">
        <SectionHead
          kicker="Complete the setup"
          title="You may also consider"
        />
        <div className="product-grid related">
          {products.slice(1, 5).map((x) => (
            <ProductCard p={x} key={x.id} />
          ))}
        </div>
      </section>
    </Layout>
  );
}
export function App() {
  const path = location.pathname;
  if (path.startsWith("/admin"))
    return (
      <Suspense fallback={<div aria-live="polite">Loading Admin Studio…</div>}>
        <AdminApp />
      </Suspense>
    );
  return path === "/shop" ? (
    <Shop />
  ) : path === "/product/prototype-flagship-phone" ? (
    <PDP />
  ) : (
    <Home />
  );
}
