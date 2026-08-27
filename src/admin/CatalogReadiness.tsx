import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";

type Row = {
  id: string;
  title: string;
  slug: string;
  readiness_status: "READY TO PUBLISH" | "BLOCKED";
  missing_requirements: string[];
};

export function CatalogReadiness() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void supabase
      .rpc("admin_catalog_readiness")
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        else setRows((data ?? []) as Row[]);
      });
  }, []);
  return (
    <section>
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">PHASE 4 · REAL DRAFT CATALOG</span>
          <h1>Catalog readiness</h1>
          <p>
            Publication remains an explicit Owner action. This report never
            publishes products.
          </p>
        </div>
      </div>
      {error && <p className="admin-error">{error}</p>}
      <div className="bulk-preview">
        {rows.map((row) => (
          <article className="bulk-product" key={row.id}>
            <header>
              <div>
                <strong>{row.title}</strong>
                <small>{row.slug}</small>
              </div>
              <span
                className={`bulk-status ${row.readiness_status === "BLOCKED" ? "blocked" : "ready"}`}
              >
                {row.readiness_status}
              </span>
            </header>
            {row.missing_requirements.map((reason) => (
              <p className="bulk-warning" key={reason}>
                <AlertTriangle /> {reason}
              </p>
            ))}
            {!row.missing_requirements.length && (
              <p className="admin-success">
                <CheckCircle2 /> All publication requirements are satisfied.
              </p>
            )}
          </article>
        ))}
        {!error && !rows.length && <p>No real Draft products found.</p>}
      </div>
    </section>
  );
}
