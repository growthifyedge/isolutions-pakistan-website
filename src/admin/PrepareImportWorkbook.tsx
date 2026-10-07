import { ChangeEvent, useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileDown, FileUp, Play, ShieldCheck } from "lucide-react";
import { supabaseEnvironmentLabel } from "../lib/supabase";
import {
  MASTER_ACTION_STRATEGIES,
  catalogImportFilename,
  defaultMasterSheet,
  evaluateMasterRows,
  generateMasterImportWorkbook,
  groupMasterIssues,
  initialMasterSelection,
  prepareMasterRows,
  readMasterWorkbook,
  type GeneratedImportWorkbook,
  type MasterActionStrategy,
  type MasterReference,
  type MasterReview,
  type MasterWorkbook,
} from "../lib/catalogMasterImport";
import { PRODUCT_TYPE_CATEGORY, type CatalogWorkbookData } from "../lib/catalogWorkbook";
import type { CatalogProductType } from "../lib/catalogSheet";

type Props = {
  /** Live reference data from the catalog this admin build is connected to. */
  loadReference: () => Promise<MasterReference>;
  onDownload: (bytes: Uint8Array<ArrayBuffer>, filename: string) => void;
  /** Sends the validated workbook rows to the existing Bulk Import preview (no database writes). */
  onPreview: (data: CatalogWorkbookData) => Promise<void>;
  disabled: boolean;
};

type RowFilter = "all" | "attention" | "excluded";
const STATUS_LABEL = { ready: "Ready", warning: "Warning", blocked: "Blocked" } as const;
const rowList = (rows: number[]) => (rows.length > 12 ? `${rows.slice(0, 12).join(", ")} … (+${rows.length - 12})` : rows.join(", "));
const pkr = (minor: number | null) => (minor === null ? "—" : `Rs ${(minor / 100).toLocaleString("en-PK")}`);

/** Prepare Import Workbook: master Excel → normalized, self-validated Bulk Upload v2 workbook. */
export function PrepareImportWorkbook({ loadReference, onDownload, onPreview, disabled }: Props) {
  const [fileName, setFileName] = useState("");
  const [master, setMaster] = useState<MasterWorkbook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [productType, setProductType] = useState<CatalogProductType>("Mobile Phone");
  const [strategy, setStrategy] = useState<MasterActionStrategy>("create");
  const [stockText, setStockText] = useState("10");
  const [reference, setReference] = useState<MasterReference | null>(null);
  const [included, setIncluded] = useState<Set<number> | null>(null);
  const [confirmExclusions, setConfirmExclusions] = useState(false);
  const [filter, setFilter] = useState<RowFilter>("all");
  const [generated, setGenerated] = useState<(GeneratedImportWorkbook & { review: MasterReview; filename: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sheet = master?.sheets.find((item) => item.name === sheetName) ?? null;
  const defaultStock = /^\d{1,7}$/.test(stockText.trim()) ? Number(stockText.trim()) : null;
  const stock = useDeferredValue(defaultStock);
  const prepared = useMemo(
    () =>
      sheet?.usable && reference && stock !== null
        ? prepareMasterRows(sheet, { productType, strategy, defaultStock: stock, reference })
        : null,
    [sheet, reference, productType, strategy, stock],
  );
  const review = useMemo(
    () => (prepared && included && reference ? evaluateMasterRows(prepared, included, reference) : null),
    [prepared, included, reference],
  );
  const blockedGroups = useMemo(() => (review ? groupMasterIssues(review, "issues") : []), [review]);
  const warningGroups = useMemo(() => (review ? groupMasterIssues(review, "warnings") : []), [review]);
  const visibleRows = useMemo(
    () =>
      review?.rows.filter((item) =>
        filter === "all" ? true : filter === "excluded" ? !item.included : item.status !== "ready",
      ) ?? [],
    [review, filter],
  );
  // A generated workbook belongs to exactly one review; any change makes it stale.
  const current = generated && generated.review === review ? generated : null;
  const needsConfirmation = Boolean(review && review.counts.excluded > 0);
  const canGenerate = Boolean(review && !review.blockers.length && (!needsConfirmation || confirmExclusions));

  const resetReview = () => {
    setReference(null);
    setIncluded(null);
    setConfirmExclusions(false);
    setGenerated(null);
  };

  const uploadMaster = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    resetReview();
    try {
      const workbook = await readMasterWorkbook(await file.arrayBuffer());
      setFileName(file.name);
      setMaster(workbook);
      setSheetName(defaultMasterSheet(workbook)?.name ?? "");
      if (workbook.error) setError(workbook.error);
    } finally {
      setBusy(false);
    }
  };

  const normalizeAndReview = async () => {
    if (!sheet?.usable || defaultStock === null) return;
    setBusy(true);
    setError("");
    setGenerated(null);
    try {
      const loaded = await loadReference();
      const rows = prepareMasterRows(sheet, { productType, strategy, defaultStock, reference: loaded });
      setReference(loaded);
      setIncluded(initialMasterSelection(rows, loaded));
      setConfirmExclusions(false);
    } catch (problem) {
      setError(`Could not load the target catalog: ${problem instanceof Error ? problem.message : "Unknown error."}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = (sourceRow: number) => {
    setIncluded((previous) => {
      const next = new Set(previous);
      if (next.has(sourceRow)) next.delete(sourceRow);
      else next.add(sourceRow);
      return next;
    });
    setConfirmExclusions(false);
  };

  const excludeBlocked = () => {
    if (!review) return;
    setIncluded(new Set(review.rows.filter((item) => item.included && item.status !== "blocked").map((item) => item.sourceRow)));
    setConfirmExclusions(false);
  };

  const generate = async () => {
    if (!review || !reference || !canGenerate) return;
    setBusy(true);
    setError("");
    try {
      const result = await generateMasterImportWorkbook(review, reference);
      setGenerated({ ...result, review, filename: catalogImportFilename(productType) });
      if (!result.validation.ok) setError("Generated workbook failed internal validation");
    } catch (problem) {
      setGenerated(null);
      setError(`Generated workbook failed internal validation: ${problem instanceof Error ? problem.message : "Unknown error."}`);
    } finally {
      setBusy(false);
    }
  };

  const working = busy || disabled;
  return (
    <section className="bulk-prepare" aria-labelledby="prepare-import-title">
      <div className="bulk-step">
        <b id="prepare-import-title">Prepare Import Workbook</b>
        <span>
          Reference catalog:{" "}
          <strong className={`bulk-env ${supabaseEnvironmentLabel.toLowerCase()}`}>
            {supabaseEnvironmentLabel.toUpperCase()}
          </strong>
          {reference ? ` · ${reference.brands.length} active brands · ${reference.categories.length} categories` : ""}
        </span>
      </div>
      <p className="bulk-prepare-intro">
        Upload your supplier/master Excel file. iSolutions will normalize it into the exact catalog import format
        and validate it before download. Nothing is written to the catalog.
      </p>

      <div className="bulk-actions bulk-prepare-actions">
        <span className="bulk-prepare-file">{fileName ? `Master file: ${fileName}` : "Step 1 · choose the master workbook"}</span>
        <label className="admin-secondary">
          <FileUp /> Upload Master Excel
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => void uploadMaster(event)}
            disabled={working}
            hidden
          />
        </label>
      </div>

      {master && master.sheets.length > 0 && (
        <div className="bulk-prepare-mapping">
          <label>
            Source sheet
            <select
              value={sheetName}
              onChange={(event) => {
                setSheetName(event.target.value);
                resetReview();
              }}
              disabled={working}
            >
              {master.sheets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {item.usable ? ` (${item.rows.length} rows)` : " (missing required columns)"}
                </option>
              ))}
            </select>
          </label>
          {sheet && (
            <p className="bulk-meta">
              Header row {sheet.headerRow} ·{" "}
              {sheet.columns
                .map((column) => (column.field ? (column.field === column.header ? column.field : `${column.header} → ${column.field}`) : `${column.header}: ${column.note}`))
                .join(" · ")}
              {master.compatibilityMode ? " · read in compatibility mode (cell notes ignored)" : ""}
            </p>
          )}
          {sheet?.missing.length ? (
            <p className="bulk-warning">
              <AlertTriangle /> Required column{sheet.missing.length === 1 ? "" : "s"} not found: {sheet.missing.join(", ")}. Name
              {sheet.missing.length === 1 ? " it" : " them"} Brand, Model and Price (or Price PKR).
            </p>
          ) : null}
          {sheet?.conflicts.map((conflict) => (
            <p className="bulk-warning" key={conflict}>
              <AlertTriangle /> {conflict}
            </p>
          ))}
        </div>
      )}

      {sheet?.usable && (
        <fieldset className="bulk-defaults bulk-prepare-options">
          <legend>Step 2 · Detect &amp; Normalize</legend>
          <label>
            Product Type
            <select value={productType} onChange={(event) => setProductType(event.target.value as CatalogProductType)} disabled={working}>
              {Object.entries(PRODUCT_TYPE_CATEGORY).map(([type, category]) => (
                <option key={type} value={type}>
                  {type} → {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select value={strategy} onChange={(event) => setStrategy(event.target.value as MasterActionStrategy)} disabled={working}>
              {Object.entries(MASTER_ACTION_STRATEGIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default stock for blank quantities
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={stockText}
              onChange={(event) => setStockText(event.target.value)}
              aria-invalid={defaultStock === null}
              disabled={working}
            />
          </label>
          <p>
            {strategy === "create"
              ? "Every row is written as Create. Products already in the target catalog are blocked."
              : strategy === "replace"
                ? "Every row is written as Replace Existing: active variants missing from this file will be hidden."
                : "Create for new products, Replace Existing for products already in the target catalog (their variants missing from this file will be hidden)."}{" "}
            SKU and Slug stay blank (assigned on import). PTA, Condition, Battery Health, Cycle Count and SIM stay blank unless the
            master supplies them.
            {defaultStock === null ? " Default stock must be a whole number of 0 or more." : ""}
          </p>
          <div className="bulk-prepare-inline">
            <button className="admin-primary" type="button" onClick={() => void normalizeAndReview()} disabled={working || defaultStock === null}>
              <Play /> Normalize &amp; Review
            </button>
          </div>
        </fieldset>
      )}

      {review && (
        <>
          <div className="bulk-step">
            <b>Step 3 · Review mapping and warnings</b>
            <span>
              Total {review.counts.total} · Ready {review.counts.ready} · Warnings {review.counts.warning} · Blocked{" "}
              {review.counts.blocked} · Included {review.counts.included} rows / {review.counts.products} products
            </span>
          </div>
          {blockedGroups.map((group) => (
            <p className="bulk-warning" key={`b-${group.message}`}>
              <AlertTriangle /> Blocked · {group.message} — row{group.rows.length === 1 ? "" : "s"} {rowList(group.rows)}
            </p>
          ))}
          {warningGroups.map((group) => (
            <p className="bulk-meta" key={`w-${group.message}`}>
              Warning · {group.message} — row{group.rows.length === 1 ? "" : "s"} {rowList(group.rows)}
            </p>
          ))}
          <div className="bulk-prepare-inline">
            <label>
              Show
              <select value={filter} onChange={(event) => setFilter(event.target.value as RowFilter)}>
                <option value="all">All rows</option>
                <option value="attention">Warnings and blocked</option>
                <option value="excluded">Excluded rows</option>
              </select>
            </label>
            {review.rows.some((item) => item.included && item.status === "blocked") && (
              <button className="admin-secondary" type="button" onClick={excludeBlocked} disabled={working}>
                Exclude blocked rows from generated workbook
              </button>
            )}
          </div>
          <div className="bulk-review-table" role="region" aria-label="Normalized rows" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Include?</th>
                  <th>Source Row</th>
                  <th>Brand</th>
                  <th>Model</th>
                  <th>RAM</th>
                  <th>Storage</th>
                  <th>Color</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Issue</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((item) => (
                  <tr key={item.sourceRow} className={item.included ? undefined : "excluded"}>
                    <td>
                      <input
                        type="checkbox"
                        checked={item.included}
                        onChange={() => toggleRow(item.sourceRow)}
                        aria-label={`Include row ${item.sourceRow}`}
                        disabled={working}
                      />
                    </td>
                    <td>{item.sourceRow}</td>
                    <td>{item.row.brand ?? "—"}</td>
                    <td>{item.row.model ?? "—"}</td>
                    <td>{item.row.ram ?? "—"}</td>
                    <td>{item.row.storage ?? "—"}</td>
                    <td>{item.row.color ?? "—"}</td>
                    <td>{pkr(item.row.priceMinor)}</td>
                    <td>{item.row.stock}</td>
                    <td>
                      <span className={`bulk-status ${item.status === "blocked" ? "blocked" : item.status === "warning" ? "warning" : "ready"}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </td>
                    <td>{[...item.issues, ...item.warnings, ...item.changes].join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bulk-step">
            <b>Step 4 · Generate valid import workbook</b>
            <span>Written with the Download Template builder, then read back with the Upload Excel parser</span>
          </div>
          {review.blockers.map((blocker) => (
            <p className="bulk-warning" key={blocker}>
              <AlertTriangle /> {blocker}
            </p>
          ))}
          {needsConfirmation && (
            <label className="bulk-prepare-confirm">
              <input
                type="checkbox"
                checked={confirmExclusions}
                onChange={(event) => setConfirmExclusions(event.target.checked)}
                disabled={working}
              />
              Leave the {review.counts.excluded} unchecked row{review.counts.excluded === 1 ? "" : "s"} out of the generated workbook
            </label>
          )}
          <div className="bulk-actions">
            <button className="admin-primary" type="button" onClick={() => void generate()} disabled={working || !canGenerate}>
              <ShieldCheck /> Generate Valid Workbook
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="admin-error" role="alert">
          <p>{error}</p>
          {current && !current.validation.ok && (
            <ul>
              {current.validation.errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {current?.validation.ok && (
        <>
          <div className="bulk-result">
            <CheckCircle2 />
            <div>
              <b>Validated with iSolutions importer</b>
              <span>{current.filename}</span>
              <span>Rows: {current.validation.rowCount}</span>
              <span>Products: {current.validation.productCount}</span>
              <span>Excluded rows: {current.review.counts.excluded}</span>
              <span>File errors: 0 · Rows needing review: 0</span>
            </div>
          </div>
          <div className="bulk-step">
            <b>Step 5 · Download</b>
            <span>Upload Excel accepts this file as is · Preview reads the same validated rows</span>
          </div>
          <div className="bulk-actions">
            <button className="admin-secondary" type="button" onClick={() => void onPreview(current.validation.data)} disabled={working}>
              <Play /> Preview Generated Import
            </button>
            <button className="admin-primary" type="button" onClick={() => onDownload(current.bytes, current.filename)} disabled={working}>
              <FileDown /> Download Ready XLSX
            </button>
          </div>
        </>
      )}
    </section>
  );
}
