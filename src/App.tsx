import { lazy, Suspense, useEffect, useState } from "react";
import { StorefrontApp } from "./StorefrontApp";

// Promotional Popup: its own small chunk, requested only on the homepage and only after the page has finished loading.
// A failed download renders nothing (the homepage is never affected).
const PromoPopup = lazy(() => import("./PromoPopup").catch(() => ({ default: () => null })));

function HomepagePromoPopup() {
  const [load, setLoad] = useState(false);
  useEffect(() => {
    const start = () => setLoad(true);
    if (document.readyState === "complete") {
      const timer = window.setTimeout(start, 0);
      return () => window.clearTimeout(timer);
    }
    window.addEventListener("load", start, { once: true });
    return () => window.removeEventListener("load", start);
  }, []);
  return load ? (
    <Suspense fallback={null}>
      <PromoPopup />
    </Suspense>
  ) : null;
}

const AdminApp = lazy(() =>
  import("./admin/AdminApp").then((module) => ({ default: module.AdminApp })),
);

// Staff Orders Dashboard (Phase 2): its own small chunk; no Admin Studio code is loaded.
const StaffApp = lazy(() =>
  import("./staff/StaffApp").then((module) => ({ default: module.StaffApp })),
);

export function App() {
  if (location.pathname === "/staff" || location.pathname.startsWith("/staff/")) {
    return (
      <Suspense fallback={<div aria-live="polite">Loading Staff Orders…</div>}>
        <StaffApp />
      </Suspense>
    );
  }
  if (location.pathname.startsWith("/admin")) {
    return (
      <Suspense fallback={<div aria-live="polite">Loading Admin Studio…</div>}>
        <AdminApp />
      </Suspense>
    );
  }
  if (location.pathname === "/")
    return (
      <>
        <StorefrontApp />
        <HomepagePromoPopup />
      </>
    );
  return <StorefrontApp />;
}
