import { FormEvent, useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Boxes,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Image,
  ListPlus,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  PackageCheck,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  X,
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
import { hasSupabaseEnvironment, supabase } from "../lib/supabase";
import { MediaManager } from "./MediaManager";
import { MediaLibrary } from "./MediaLibrary";
import { BulkImport } from "./BulkImport";
import "./admin.css";

const nav = [
  ["Dashboard", "/admin", LayoutDashboard],
  ["Catalog", "/admin/products", Boxes],
  ["Media", "/admin/media", Image],
  ["Bulk Import", "/admin/bulk-import", ListPlus],
  ["Homepage", "/admin/homepage", Sparkles],
  ["Orders", "", ShoppingBag],
  ["Promotions", "", CircleDollarSign],
  ["Settings", "/admin/settings", Settings],
] as const;
function DevNotice() {
  return (
    <div className="admin-dev-note">
      <span /> Development workspace · Real catalog isolated from test data
    </div>
  );
}
function AdminLayout({
  children,
  section,
}: {
  children: React.ReactNode;
  section: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
                className={section === label ? "active" : ""}
                href={href}
                key={label}
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
          <DevNotice />
          <div className="admin-user">
            <span>MJ</span>
            <div>
              Development Admin<small>Verified Owner / Admin</small>
            </div>
          </div>
        </header>
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
          <span className="admin-kicker">ADMIN STUDIO · PHASE 3A</span>
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
        <footer>
          Development authentication state · No customer accounts or commerce
        </footer>
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
            ? "Development client configured"
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
      <div className="admin-heading">
        <div>
          <span className="admin-kicker">THURSDAY · DEVELOPMENT</span>
          <h1>Good morning.</h1>
          <p>Phase 3A catalog readiness at a glance.</p>
        </div>
        <a href="/admin/products/new" className="admin-primary">
          <Plus /> New product
        </a>
      </div>
      <div className="metrics">
        <article>
          <small>Published</small>
          <strong>1</strong>
          <span>Development record</span>
        </article>
        <article>
          <small>Drafts</small>
          <strong>2</strong>
          <span>Need commercial facts</span>
        </article>
        <article>
          <small>Low / out of stock</small>
          <strong>2</strong>
          <span>Numeric movement totals</span>
        </article>
        <article className="metric-accent">
          <small>Publication readiness</small>
          <strong>33%</strong>
          <span>1 of 3 development records</span>
        </article>
      </div>
      <div className="dashboard-grid">
        <section className="admin-panel">
          <div className="panel-title">
            <div>
              <span className="admin-kicker">CATALOG ACTIVITY</span>
              <h2>Recent work</h2>
            </div>
            <a href="/admin/products">
              View catalog <ChevronRight />
            </a>
          </div>
          {adminDevelopmentProducts.map((p) => (
            <a className="activity-row" href="/admin/products/new" key={p.id}>
              <div className="activity-icon">
                <FileText />
              </div>
              <div>
                <strong>{p.title}</strong>
                <span>
                  {p.brand} · {p.variants} explicit variant
                  {p.variants > 1 ? "s" : ""}
                </span>
              </div>
              <em className={`state ${p.status}`}>{p.status}</em>
              <ChevronRight />
            </a>
          ))}
        </section>
        <aside className="readiness">
          <span className="admin-kicker">FOUNDATION STATUS</span>
          <h2>Secure by default.</h2>
          <ul>
            <li>
              <ShieldCheck /> Database-backed roles
            </li>
            <li>
              <PackageCheck /> Explicit variants
            </li>
            <li>
              <BarChart3 /> Numeric inventory ledger
            </li>
            <li>
              <Archive /> Drafts public-invisible
            </li>
          </ul>
          <p>
            Cloudinary, real catalog, orders and payments remain outside this
            phase.
          </p>
        </aside>
      </div>
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
        <span className="admin-kicker">PHASE BOUNDARY</span>
        <h1>{title}</h1>
        <p>
          This area is intentionally unavailable until a later Owner-approved
          phase.
        </p>
        <a href="/admin">Return to dashboard</a>
      </div>
    </AdminLayout>
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
  else if (path === "/admin/taxonomy")
    page = (
      <AdminLayout section="Catalog">
        <TaxonomyManager />
      </AdminLayout>
    );
  else if (path.startsWith("/admin/products/")) page = <ProductEditor />;
  else if (path === "/admin/media")
    page = (
      <AdminLayout section="Media">
        <div className="admin-heading compact media-library-heading">
          <div>
            <span className="admin-kicker">PHASE 3B · CLOUDINARY</span>
            <h1>Product media</h1>
            <p>
              Review media records here, then open the product Media editor for
              upload and management actions.
            </p>
          </div>
        </div>
        <MediaLibrary />
      </AdminLayout>
    );
  else if (path === "/admin/homepage") page = <Future title="Homepage" />;
  else if (path === "/admin/settings") page = <Future title="Settings" />;
  return <AuthorizedAdmin>{page}</AuthorizedAdmin>;
}
