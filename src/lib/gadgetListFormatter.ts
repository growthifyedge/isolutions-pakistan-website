/**
 * Smart List Formatter (Gadgets Stock Update, 2026-11-25): rewrites a rough supplier list into the line format the existing
 * Gadgets parser accepts — "Product Name - Rs 16,500" — by moving each line's price to the end. Simple text rules only:
 * names, colours, model details and prices are kept exactly; nothing is split, guessed or looked up. A line it cannot
 * format safely is kept as written and listed for manual review. It never changes the parser or the Excel logic.
 */

export type FormatterNote = { lineNumber: number; line: string; reason: string; kind: "fix" | "check" };
export type FormattedList = { text: string; notes: FormatterNote[]; formatted: number };

// A price written with "@", "Rs" or "PKR" (e.g. "@16500", "@ Rs 16,500", "Rs. 4,500/-", "PKR 4500").
const MARKED_PRICE = /(?:@\s*(?:(?:rs\.?|pkr)\s*)?|(?<![a-z0-9])(?:rs\.?|pkr)\s*)(\d[\d,]*)(?:\.0+)?(?:\s*\/-)?/gi;
// A price already at the end after a separator: "Name - 4500", "Name: 4,500", "Name = 4500".
const TRAILING_PRICE = /^(.*?\S)\s*(?:\s[-–]|[=:])\s*(\d[\d,]*)(?:\.0+)?(?:\s*\/-)?\s*$/;
// A line that is only a price ("Rs 750", "@750", "750/-"): belongs to the name line just before it.
const PRICE_ONLY = /^(?:@\s*)?(?:(?:rs\.?|pkr)\s*)?(\d[\d,]*)(?:\.0+)?(?:\s*\/-)?$/i;

const rupees = (digits: string) => {
  const plain = digits.replace(/,/g, "");
  if (!/^\d+$/.test(plain)) return null;
  const value = Number(plain);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};
const tidy = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/^[\s,;:@–-]+|[\s,;:@–-]+$/g, "")
    .trim();
const line = (name: string, price: number) => `${name} - Rs ${price.toLocaleString("en-US")}`;

export function formatGadgetList(input: string): FormattedList {
  const out: string[] = [];
  const notes: FormatterNote[] = [];
  let formatted = 0;
  // An unpriced name line waiting for a price-only line right after it (blank lines between are fine).
  let pendingName: { index: number; lineNumber: number; line: string } | null = null;

  input.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const original = raw.trim();
    if (!original) return;

    const priceOnly = original.match(PRICE_ONLY);
    if (priceOnly && /[@]|rs|pkr|\/-/i.test(original)) {
      const price = rupees(priceOnly[1]);
      if (pendingName && price) {
        out[pendingName.index] = line(tidy(pendingName.line), price);
        notes.splice(notes.findIndex((note) => note.lineNumber === pendingName!.lineNumber), 1);
        formatted += 1;
        pendingName = null;
        return;
      }
      out.push(original);
      notes.push({ lineNumber, line: original, kind: "fix", reason: "Price without a product name before it — kept as written." });
      pendingName = null;
      return;
    }

    const marked = [...original.matchAll(MARKED_PRICE)];
    if (marked.length > 1) {
      out.push(original);
      notes.push({ lineNumber, line: original, kind: "fix", reason: "More than one price on this line — kept as written; choose one price." });
      pendingName = null;
      return;
    }
    if (marked.length === 1) {
      const match = marked[0];
      const price = rupees(match[1]);
      const name = tidy(`${original.slice(0, match.index)} ${original.slice((match.index ?? 0) + match[0].length)}`);
      if (!price || !name) {
        out.push(original);
        notes.push({ lineNumber, line: original, kind: "fix", reason: !name ? "No product name — kept as written." : "The price is not a valid amount — kept as written." });
      } else {
        out.push(line(name, price));
        formatted += 1;
        if (/,|\/|\band\b|&/i.test(name))
          notes.push({ lineNumber, line: original, kind: "check", reason: "Lists several colours/models — kept as ONE product (not split). Edit if they should be separate lines." });
      }
      pendingName = null;
      return;
    }

    const trailing = original.match(TRAILING_PRICE);
    const trailingPrice = trailing ? rupees(trailing[2]) : null;
    if (trailing && trailingPrice) {
      out.push(line(tidy(trailing[1]), trailingPrice));
      formatted += 1;
      pendingName = null;
      return;
    }

    // No price on this line: it may be a name whose price is on the next line; otherwise it needs review.
    out.push(original);
    notes.push({ lineNumber, line: original, kind: "fix", reason: "No price found (use @, Rs or PKR before the price) — kept as written." });
    pendingName = { index: out.length - 1, lineNumber, line: original };
  });

  return { text: out.join("\n"), notes: notes.sort((a, b) => a.lineNumber - b.lineNumber), formatted };
}
