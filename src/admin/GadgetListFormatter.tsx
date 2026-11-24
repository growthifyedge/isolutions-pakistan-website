import { useState } from "react";
import { formatGadgetList, type FormatterNote } from "../lib/gadgetListFormatter";

/**
 * Smart List Formatter (Gadgets Stock Update, 2026-11-25): rough supplier list in, "Product Name - Rs 16,500" lines out.
 * Text rules only (no AI, no network). The result is editable and copied by the Owner into Paste List below; nothing is
 * read from or written to the website here.
 */
export function GadgetListFormatter() {
  const [rough, setRough] = useState("");
  const [formatted, setFormatted] = useState("");
  const [notes, setNotes] = useState<FormatterNote[] | null>(null);
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState("");

  const format = () => {
    const result = formatGadgetList(rough);
    setFormatted(result.text);
    setNotes(result.notes);
    setCopied("");
    const review = result.notes.filter((note) => note.kind === "fix").length;
    setSummary(`${result.formatted} line(s) formatted${review ? ` · ${review} need manual review` : ""}.`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied("Copied. Paste it into Paste List below.");
    } catch {
      const area = document.getElementById("gadget-formatted-list") as HTMLTextAreaElement | null;
      area?.select();
      setCopied(document.execCommand("copy") ? "Copied. Paste it into Paste List below." : "Copy blocked by the browser — select the text and copy it.");
    }
  };

  return (
    <div className="stock-step" aria-labelledby="gadget-formatter-title">
      <h3 id="gadget-formatter-title">Smart List Formatter (optional)</h3>
      <p className="stock-hint">Moves each price to the end of its line (Product Name - Rs 16,500). Names, colours, models and prices are kept exactly; nothing is split or guessed.</p>
      <label className="stock-field">
        <span>Paste Rough Supplier List</span>
        <textarea value={rough} rows={6} placeholder={"JBL clip 5 @16500 White, Squad\nJBL CHARGE 6 @41500 White"} onChange={(event) => setRough(event.target.value)} />
      </label>
      <div className="bulk-images-bulk">
        <button type="button" className="admin-secondary" disabled={!rough.trim()} onClick={format}>Format List</button>
      </div>
      {notes && (
        <>
          <p className="stock-hint" role="status">{summary}</p>
          <label className="stock-field">
            <span>Formatted List (you can edit it)</span>
            <textarea id="gadget-formatted-list" value={formatted} rows={6} onChange={(event) => { setFormatted(event.target.value); setCopied(""); }} />
          </label>
          <div className="bulk-images-bulk">
            <button type="button" className="admin-primary" disabled={!formatted.trim()} onClick={() => void copy()}>Copy Formatted List</button>
          </div>
          {copied && <p className="stock-hint" role="status">{copied}</p>}
          {notes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4>Check these lines ({notes.length})</h4>
              <ul className="stock-excluded">
                {notes.map((note) => (
                  <li key={note.lineNumber}>
                    <strong>{note.kind === "fix" ? "Needs review" : "Check"}</strong> — Line {note.lineNumber}: “{note.line}” — {note.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
