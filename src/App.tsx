import { lazy, Suspense } from "react";
import { StorefrontApp } from "./StorefrontApp";

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
  return <StorefrontApp />;
}
