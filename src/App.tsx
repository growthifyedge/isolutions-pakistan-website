import { lazy, Suspense } from "react";
import { StorefrontApp } from "./StorefrontApp";

const AdminApp = lazy(() =>
  import("./admin/AdminApp").then((module) => ({ default: module.AdminApp })),
);

export function App() {
  if (location.pathname.startsWith("/admin")) {
    return (
      <Suspense fallback={<div aria-live="polite">Loading Admin Studio…</div>}>
        <AdminApp />
      </Suspense>
    );
  }
  return <StorefrontApp />;
}
