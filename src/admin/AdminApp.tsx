import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  CircleDollarSign,
  Megaphone,
  Image,
  ListPlus,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MessageSquareText,
  PackageCheck,
  PackagePlus,
  Smartphone,
  Tablet,
  ClipboardCheck,
  FileSearch,
  FileText,
  FolderTree,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  GalleryHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  adminDevelopmentProducts,
  adminDevelopmentVariants,
  formatPkrMinor,
} from "../data/adminDevelopmentData";
import {
  Phase4ProductEditor,
  Phase4ProductList,
  TaxonomyManager,
} from "./AdminCatalog";
import {
  hasSupabaseEnvironment,
  supabase,
  supabaseEnvironmentLabel,
} from "../lib/supabase";
import { AdminDashboard } from "./AdminDashboard";
import { MediaManager } from "./MediaManager";
import { MediaLibrary } from "./MediaLibrary";
import { BulkProductImages } from "./BulkProductImages";
import { BulkImport } from "./BulkImport";
import { StockListUpdate } from "./StockListUpdate";
import { IphoneStockUpdate } from "./IphoneStockUpdate";
import { GadgetStockUpdate } from "./GadgetStockUpdate";
import { TabletStockUpdate } from "./TabletStockUpdate";
import { SpecificationBulkUpload } from "./SpecificationBulkUpload";
import { IphoneModelSpecs } from "./IphoneModelSpecs";
import { PdpBackgroundSetting } from "./PdpBackgroundSetting";
import { DescriptionBulkUpload } from "./DescriptionBulkUpload";
import { SubcategoryAssignment } from "./SubcategoryAssignment";
import { AddProduct } from "./AddProduct";
import { CatalogReadiness } from "./CatalogReadiness";
import { ContactEnquiries } from "./ContactEnquiries";
import { BundleManager } from "./BundleManager";
import { BannerManager } from "./BannerManager";
import { BundleOffersEditor } from "./BundleOffersEditor";
import { AdminOrders } from "./AdminOrders";
import { AdminPromotions } from "./AdminPromotions";
import { PromoPopupSetting } from "./PromoPopupSetting";
import "./admin.css";

// Admin menu (Owner-approved 2026-11-23): 10 sidebar options. Navigation only — every page keeps its own address
// (old links still open the same page), and the tools of a group are one click away in its tab bar (Owner decision:
// tools are shown only as tabs at the top, never as a nested sidebar sub-menu).
type NavItem = readonly [string, string, LucideIcon];
// An empty href renders a disabled "Later" item.
const nav: ReadonlyArray<NavItem> = [
  ["Dashboard", "/admin", LayoutDashboard],
  ["Products & Inventory", "/admin/products", Boxes],
  ["Add Product", "/admin/products/add", PackagePlus],
  ["Orders", "/admin/orders", ShoppingBag],
  ["Media", "/admin/media", Image],
  ["Promotions", "/admin/promotions", CircleDollarSign],
  ["Promotional Popup", "/admin/promotional-popup", Megaphone],
  ["Homepage", "/admin/homepage", Sparkles],
  ["Enquiries", "/admin/contact-enquiries", MessageSquareText],
  ["Settings", "/admin/settings", Settings],
];
// The tools inside a menu option. Each label is the page's own section name (shown as active on that page).
const navChildren: Readonly<Record<string, ReadonlyArray<NavItem>>> = {
  "Products & Inventory": [
    ["Catalog", "/admin/products", Boxes],
    ["Readiness", "/admin/catalog-readiness", ClipboardCheck],
    ["Bulk Import", "/admin/bulk-import", ListPlus],
    ["Stock Update", "/admin/stock-update", PackageCheck],
    ["iPhone Stock", "/admin/iphone-stock-update", Smartphone],
    ["Gadgets Stock", "/admin/gadget-stock-update", PackageCheck],
    ["Tablets & MacBooks", "/admin/tablet-stock-update", Tablet],
    ["Spec Upload", "/admin/spec-upload", FileSearch],
    ["Descriptions", "/admin/description-upload", FileText],
    ["Subcategories", "/admin/subcategory-upload", FolderTree],
  ],
  Homepage: [
    ["Homepage", "/admin/homepage", Sparkles],
    ["Homepage Banners", "/admin/homepage-banners", GalleryHorizontal],
    ["Bundle Offers", "/admin/bundle-offers", GalleryHorizontal],
  ],
};
// What the Owner sees for a tool whose page section has a shorter name.
const navDisplayName: Readonly<Record<string, string>> = { "Stock Update": "Android Stock Update" };
/** The menu option a page belongs to: its own name, or the option whose tools include it. */
function navGroupFor(section: string): string | null {
  if (nav.some(([label]) => label === section)) return section;
  return Object.keys(navChildren).find((group) => navChildren[group].some(([label]) => label === section)) ?? null;
}
function NavLinks({ items, section, className }: { items: ReadonlyArray<NavItem>; section: string; className?: string }) {
  return (
    <>
      {items.map(([label, href, Icon]) => (
        <a className={[className, section === label ? "active" : ""].filter(Boolean).join(" ")} href={href} key={label} aria-current={section === label ? "page" : undefined}>
          <Icon />
          {navDisplayName[label] ?? label}
        </a>
      ))}
    </>
  );
}
function EnvironmentBadge() {
  return (
    <div
      className={`admin-env-badge ${supabaseEnvironmentLabel.toLowerCase()}`}
    >
      <span /> {supabaseEnvironmentLabel}
    </div>
  );
}
function useSignedInEmail() {
  const [email, setEmail] = useState("");
  useEffect(() => {
    let active = true;
    void supabase?.auth.getSession().then(({ data }) => {
      if (active) setEmail(data.session?.user.email ?? "");
    });
    return () => {
      active = false;
    };
  }, []);
  return email;
}
function AdminLayout({
  children,
  section,
}: {
  children: React.ReactNode;
  section: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const email = useSignedInEmail();
  const group = navGroupFor(section);
  const tools = group ? navChildren[group] : undefined;
  const subnavRef = useRef<HTMLElement>(null);
  // On a narrow screen the tab bar scrolls sideways: keep the current tool in view.
  useEffect(() => {
    const bar = subnavRef.current;
    const active = bar?.querySelector<HTMLElement>("a.active");
    if (bar && active) bar.scrollLeft = Math.max(0, active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2);
  }, [section]);
  return (
    <div className="admin-shell">
      <aside className={menuOpen ? "admin-sidebar open" : "admin-sidebar"}>
        <div className="admin-brand">
          <a href="/admin">
            iSolutions <b>Studio</b>
          </a>
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Close admin navigation"
          >
            <X />
          </button>
        </div>
        <nav aria-label="Admin Studio navigation">
          {nav.map(([label, href, Icon]) =>
            href ? (
              <a
                className={group === label ? "active" : ""}
                href={href}
                key={label}
                aria-current={section === label ? "page" : undefined}
              >
                <Icon />
                {label}
              </a>
            ) : (
              <span className="disabled" key={label}>
                <Icon />
                {label}
                <small>Later</small>
              </span>
            ),
          )}
        </nav>
        <div className="admin-sidebar-foot">
          <ShieldCheck />
          <span>
            RLS protected<small>Owner / Admin access</small>
          </span>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <button
            className="admin-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open admin navigation"
          >
            <Menu />
          </button>
          <EnvironmentBadge />
          <div className="admin-user">
            <span aria-hidden="true">
              {(email[0] ?? "A").toUpperCase()}
            </span>
            <div>
              {email || "Signed in"}
              <small>Verified Owner / Admin</small>
            </div>
          </div>
        </header>
        {group && tools && (
          <nav className="admin-subnav" aria-label={`${group} tools`} ref={subnavRef}>
            <NavLinks items={tools} section={section} />
          </nav>
        )}
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setMessage("Supabase client environment is not configured.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setLoading(false);
      setMessage(error.message);
      return;
    }

    const { data: isAuthorized, error: authorizationError } =
      await supabase.rpc("is_catalog_admin");
    if (authorizationError || !isAuthorized) {
      await supabase.auth.signOut();
      setLoading(false);
      setMessage(
        authorizationError
          ? "Your profile authorization could not be verified."
          : "This account is not an active Owner or Admin.",
      );
      return;
    }

    location.assign("/admin");
  }
  return (
    <div className="admin-login">
      <section>
        <a className="login-wordmark" href="/">
          iSolutions <b>Pakistan</b>
        </a>
        <div className="login-panel">
          <span className="admin-kicker">ADMIN STUDIO</span>
          <h1>
            Catalog control,
            <br />
            <em>with guardrails.</em>
          </h1>
          <p>
            Sign in with a Supabase Auth identity linked to an active Owner or
            Admin profile.
          </p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
              />
            </label>
            <button disabled={loading}>
              {loading ? "Checking access…" : "Continue securely"}
              <ChevronRight />
            </button>
          </form>
          {message && (
            <p className="login-message" role="status">
              {message}
            </p>
          )}
          <div className="login-security">
            <LockKeyhole />
            <span>
              Authorization is verified by PostgreSQL RLS and the
              database-backed profile role—not by an email check in this
              interface.
            </span>
          </div>
        </div>
        <footer>Authorized iSolutions Pakistan staff only</footer>
      </section>
      <div className="login-art">
        <div className="login-orbit">
          <span>Catalog</span>
          <span>Inventory</span>
          <span>Publishing</span>
        </div>
        <div className="login-status">
          <i />{" "}
          {hasSupabaseEnvironment
            ? `${supabaseEnvironmentLabel} store connected`
            : "Environment configuration required"}
        </div>
      </div>
    </div>
  );
}

function AuthorizedAdmin({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "authorized" | "denied">(
    "checking",
  );

  useEffect(() => {
    if (!supabase) {
      setState("denied");
      return;
    }

    let active = true;
    async function verify() {
      const { data: sessionData } = await supabase!.auth.getSession();
      if (!sessionData.session) {
        location.replace("/admin/login");
        return;
      }

      const { data: isAuthorized, error } =
        await supabase!.rpc("is_catalog_admin");
      if (!active) return;
      setState(!error && isAuthorized ? "authorized" : "denied");
    }
    void verify();
    return () => {
      active = false;
    };
  }, []);

  if (state === "checking") {
    return (
      <div className="admin-auth-state">Verifying database-backed access…</div>
    );
  }
  if (state === "denied") {
    return (
      <div className="admin-auth-state">
        Access denied. An active Owner or Admin profile is required.
      </div>
    );
  }
  return children;
}

function Dashboard() {
  return (
    <AdminLayout section="Dashboard">
      <AdminDashboard />
    </AdminLayout>
  );
}

function ProductList() {
  const phase4Catalog = true;
  if (phase4Catalog)
    return (
      <AdminLayout section="Catalog">
        <Phase4ProductList />
      </AdminLayout>
    );

  return (
    <AdminLayout section="Catalog">
      <div className="admin-heading compact">
        <div>
          <a className="back-link" href="/admin">
            Studio / Catalog
          </a>
          <h1>Products</h1>
          <p>
            Development records demonstrating the approved catalog workflow.
          </p>
        </div>
        <a href="/admin/products/new" className="admin-primary">
          <Plus /> New product
        </a>
      </div>
      <div className="catalog-tools">
        <div>
          <Search />
          <input
            aria-label="Search development products"
            placeholder="Search products or SKU"
          />
        </div>
        <button>
          <SlidersHorizontal /> Filter
        </button>
      </div>
      <section className="product-table">
        <div className="table-head">
          <span>Product</span>
          <span>Status</span>
          <span>Variants</span>
          <span>Inventory</span>
          <span />
        </div>
        {adminDevelopmentProducts.map((p, i) => (
          <a href="/admin/products/new" className="table-row" key={p.id}>
            <div className={`admin-product-thumb thumb-${i}`}>
              <PackageCheck />
            </div>
            <div className="table-product">
              <strong>{p.title}</strong>
              <span>{p.brand} · TEST DATA</span>
            </div>
            <em className={`state ${p.status}`}>{p.status}</em>
            <span>{p.variants} explicit</span>
            <span className={p.inventory <= 2 ? "inventory-low" : ""}>
              {p.inventory} units
            </span>
            <ChevronRight />
          </a>
        ))}
      </section>
      <div className="table-foot">
        3 development products · No real catalog imported
      </div>
    </AdminLayout>
  );
}

const tabs = [
  "Overview",
  "Variants & Pricing",
  "Inventory",
  "Specifications",
  "Media",
  "SEO & Publishing",
];
function ProductEditor() {
  const query = new URLSearchParams(location.search);
  const routeId = location.pathname.split("/").at(-1) ?? "";
  const productId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(routeId)
    ? routeId
    : null;
  const initial =
    query.get("tab") === "variants"
      ? "Variants & Pricing"
      : query.get("tab") === "media"
        ? "Media"
        : "Overview";
  const [tab, setTab] = useState(initial);
  const phase4Catalog = true;
  if (phase4Catalog)
    return (
      <AdminLayout section="Catalog">
        <Phase4ProductEditor />
      </AdminLayout>
    );

  return (
    <AdminLayout section="Catalog">
      <div className="editor-head">
        <a className="back-link" href="/admin/products">
          <ArrowLeft /> Products
        </a>
        <div>
          <span className="admin-kicker">DRAFT · DEVELOPMENT RECORD</span>
          <h1>Development Flagship Phone</h1>
          <p>Unsaved local interface state · TEST DATA ONLY</p>
        </div>
        <div>
          <button className="admin-secondary">Save draft</button>
          <button className="admin-primary">Validate & publish</button>
        </div>
      </div>
      <div className="editor-layout">
        <nav className="editor-tabs" aria-label="Product editor sections">
          {tabs.map((t) => (
            <button
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
              key={t}
            >
              {t}
              {t === "Variants & Pricing" && <span>3</span>}
            </button>
          ))}
        </nav>
        <section className="editor-card">
          {tab === "Variants & Pricing" ? (
            <VariantEditor />
          ) : tab === "Media" ? (
            <MediaManager productId={productId} />
          ) : (
            <EditorSection tab={tab} />
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
function EditorSection({ tab }: { tab: string }) {
  if (tab !== "Overview")
    return (
      <div className="empty-editor">
        <span className="admin-kicker">{tab}</span>
        <h2>Foundation ready.</h2>
        <p>
          This Phase 3A screen reserves a structured workflow without pretending
          later Cloudinary or commerce functionality exists.
        </p>
      </div>
    );
  return (
    <>
      <div className="editor-section-title">
        <span className="admin-kicker">PRODUCT IDENTITY</span>
        <h2>Overview</h2>
        <p>
          Define the model-level merchandising identity. Sellable combinations
          belong under Variants & Pricing.
        </p>
      </div>
      <div className="form-grid">
        <label className="wide">
          Product title
          <input defaultValue="Development Flagship Phone" />
        </label>
        <label>
          Brand
          <select defaultValue="test-brand">
            <option value="test-brand">Test Brand</option>
          </select>
        </label>
        <label>
          Category
          <select defaultValue="development-mobiles">
            <option value="development-mobiles">Development Mobiles</option>
          </select>
        </label>
        <label className="wide">
          Slug
          <input defaultValue="development-flagship-phone" />
        </label>
        <label className="wide">
          Short description
          <textarea defaultValue="Development-only product used to verify the Phase 3A authoring workflow." />
        </label>
        <label>
          Default warranty
          <input placeholder="Required before publishing" />
        </label>
        <label>
          Default delivery scope
          <select defaultValue="">
            <option value="">Unresolved</option>
            <option>Karachi only</option>
            <option>Nationwide</option>
          </select>
        </label>
      </div>
      <div className="validation-callout">
        <ShieldCheck />
        <div>
          <strong>Publication guard active</strong>
          <p>
            This draft cannot publish until active brand/category, an explicit
            active variant, positive integer-minor-unit price, PTA, condition,
            warranty, and delivery scope are resolved.
          </p>
        </div>
      </div>
    </>
  );
}
function VariantEditor() {
  return (
    <>
      <div className="editor-section-title variant-title">
        <div>
          <span className="admin-kicker">ACTUAL SELLABLE COMBINATIONS</span>
          <h2>Variants & Pricing</h2>
          <p>
            Add each valid combination explicitly. Impossible combinations are
            never generated.
          </p>
        </div>
        <button className="admin-primary">
          <Plus /> Add explicit variant
        </button>
      </div>
      <div className="variant-rule">
        <ShieldCheck />
        <span>
          <strong>Combination integrity</strong> — 512 GB / Silver is absent
          because no explicit row exists.
        </span>
      </div>
      <div className="variant-list">
        <div className="variant-list-head">
          <span>Combination</span>
          <span>SKU</span>
          <span>Price</span>
          <span>PTA</span>
          <span>Stock</span>
        </div>
        {adminDevelopmentVariants.map((v) => (
          <article key={v.sku}>
            <div>
              <strong>
                {v.storage} / {v.finish}
              </strong>
              <span>{v.ram} RAM · Explicit row</span>
            </div>
            <code>{v.sku}</code>
            <strong>{formatPkrMinor(v.priceMinor)}</strong>
            <span className="pta-ok">{v.pta}</span>
            <span className={v.inventory === 0 ? "inventory-low" : ""}>
              {v.inventory}
            </span>
            <button aria-label={`Edit ${v.sku}`}>
              <ChevronRight />
            </button>
          </article>
        ))}
      </div>
      <div className="variant-footer">
        <span>3 explicit variants</span>
        <span>Prices stored as PostgreSQL BIGINT minor units</span>
      </div>
    </>
  );
}
function Future({ title }: { title: string }) {
  return (
    <AdminLayout section={title}>
      <div className="future-screen">
        <span className="admin-kicker">COMING LATER</span>
        <h1>{title}</h1>
        <p>This area will be available in a later release.</p>
        <a href="/admin">Return to dashboard</a>
      </div>
    </AdminLayout>
  );
}
/**
 * Spec Upload: Single Product = the existing Specifications Bulk Upload (unchanged); Same Model = iPhone + Android
 * shared specifications (unchanged). Only one is mounted at a time; the choice is kept in the address (?mode=model).
 */
function SpecUploadModes({ initial }: { initial: "single" | "model" }) {
  const [mode, setMode] = useState<"single" | "model">(initial);
  useEffect(() => {
    const target = mode === "model" ? "/admin/spec-upload?mode=model" : "/admin/spec-upload";
    if (`${location.pathname}${location.search}` !== target) history.replaceState(history.state, "", target);
  }, [mode]);
  return (
    <>
      <div className="spec-upload-modes" role="tablist" aria-label="Specification upload option">
        <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
          <FileSearch /> Single Product
        </button>
        <button type="button" role="tab" aria-selected={mode === "model"} className={mode === "model" ? "active" : ""} onClick={() => setMode("model")}>
          <Smartphone /> Same Model <small>iPhone + Android</small>
        </button>
      </div>
      {mode === "single" ? <SpecificationBulkUpload /> : <IphoneModelSpecs />}
    </>
  );
}

export function AdminApp() {
  useEffect(() => {
    document.body.classList.add("admin-body");
    return () => document.body.classList.remove("admin-body");
  }, []);
  const path = location.pathname;
  if (path === "/admin/login") return <Login />;
  let page: React.ReactNode = <Dashboard />;
  if (path === "/admin/products") page = <ProductList />;
  else if (path === "/admin/bulk-import")
    page = (
      <AdminLayout section="Bulk Import">
        <BulkImport />
      </AdminLayout>
    );
  else if (path === "/admin/stock-update")
    page = (
      <AdminLayout section="Stock Update">
        <StockListUpdate />
      </AdminLayout>
    );
  else if (path === "/admin/iphone-stock-update")
    page = (
      <AdminLayout section="iPhone Stock">
        <IphoneStockUpdate />
      </AdminLayout>
    );
  else if (path === "/admin/tablet-stock-update")
    page = (
      <AdminLayout section="Tablets & MacBooks">
        <TabletStockUpdate />
      </AdminLayout>
    );
  else if (path === "/admin/gadget-stock-update")
    page = (
      <AdminLayout section="Gadgets Stock">
        <GadgetStockUpdate />
      </AdminLayout>
    );
  else if (path === "/admin/description-upload")
    page = (
      <AdminLayout section="Descriptions">
        <DescriptionBulkUpload />
      </AdminLayout>
    );
  else if (path === "/admin/subcategory-upload")
    page = (
      <AdminLayout section="Subcategories">
        <SubcategoryAssignment />
      </AdminLayout>
    );
  else if (path === "/admin/spec-upload" || path === "/admin/iphone-model-specs")
    // One page, two options. The old Model Specs address opens the Same Model option.
    page = (
      <AdminLayout section="Spec Upload">
        <SpecUploadModes initial={path === "/admin/iphone-model-specs" || new URLSearchParams(location.search).get("mode") === "model" ? "model" : "single"} />
      </AdminLayout>
    );
  else if (path === "/admin/catalog-readiness")
    page = (
      <AdminLayout section="Readiness">
        <CatalogReadiness />
      </AdminLayout>
    );
  else if (path === "/admin/contact-enquiries")
    page = (
      <AdminLayout section="Enquiries">
        <ContactEnquiries />
      </AdminLayout>
    );
  else if (path === "/admin/taxonomy")
    page = (
      <AdminLayout section="Catalog">
        <TaxonomyManager />
      </AdminLayout>
    );
  else if (path === "/admin/products/add")
    page = (
      <AdminLayout section="Add Product">
        <AddProduct />
      </AdminLayout>
    );
  else if (path.startsWith("/admin/products/")) page = <ProductEditor />;
  else if (path === "/admin/media")
    page = (
      <AdminLayout section="Media">
        <div className="admin-heading compact media-library-heading">
          <div>
            <span className="admin-kicker">CATALOG · MEDIA</span>
            <h1>Product media</h1>
            <p>
              Upload and manage product images manually. Existing images are
              preserved.
            </p>
          </div>
        </div>
        <PdpBackgroundSetting />
        <BulkProductImages />
        <MediaLibrary />
      </AdminLayout>
    );
  else if (path === "/admin/homepage")
    page = (
      <AdminLayout section="Homepage">
        <BundleManager />
      </AdminLayout>
    );
  else if (path === "/admin/homepage-banners")
    page = (
      <AdminLayout section="Homepage Banners">
        <BannerManager />
      </AdminLayout>
    );
  else if (path === "/admin/bundle-offers")
    page = (
      <AdminLayout section="Bundle Offers">
        <BundleOffersEditor />
      </AdminLayout>
    );
  else if (path === "/admin/orders")
    page = (
      <AdminLayout section="Orders">
        <AdminOrders />
      </AdminLayout>
    );
  else if (path === "/admin/promotions")
    page = (
      <AdminLayout section="Promotions">
        <AdminPromotions />
      </AdminLayout>
    );
  else if (path === "/admin/promotional-popup")
    page = (
      <AdminLayout section="Promotional Popup">
        <PromoPopupSetting />
      </AdminLayout>
    );
  else if (path === "/admin/settings") page = <Future title="Settings" />;
  return <AuthorizedAdmin>{page}</AuthorizedAdmin>;
}
