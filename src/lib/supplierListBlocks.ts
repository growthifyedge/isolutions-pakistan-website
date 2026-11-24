/**
 * Android Smart Stock Update — supplier list blocks (Owner-approved 2026-11-23). Pure, no database access.
 *
 * Suppliers often send one phone as a block instead of one line per variant:
 *
 *     Samsung S26 Ultra 12-512Gb        <- heading: brand + model + RAM-storage, no price
 *
 *     Blk @438,000                      <- colour + price lines under it (blank lines allowed)
 *     Blue @438,000
 *     Cobalt @440,000
 *
 *     256Gb                             <- storage-only sub-heading: same phone, this storage (RAM not stated)
 *     All Colours                       <- colour line whose price is on the next line
 *     @385,000
 *
 * The existing stock-line parser (catalogSheet.normalizeStockLines, shared with Bulk Import) reads one complete line per
 * variant. This module rewrites such a block into those lines BEFORE that parser runs, for the Android Stock Update only:
 *
 *     Samsung S26 Ultra 12/512GB Blk @ 438,000
 *     Samsung S26 Ultra 12/512GB Blue @ 438,000
 *     Samsung S26 Ultra 12/512GB Cobalt @ 440,000
 *     Samsung S26 Ultra 256GB All Colours @ 385,000
 *
 * Rules (never guessing):
 *  - A block is rewritten only when a heading (known brand + model + capacity, no price) is followed by at least one
 *    colour + price line. Anything else is left exactly as written.
 *  - Nothing is invented: colour words stay as written (the parser maps "Blk" to Black and flags unknown colours), a
 *    storage-only sub-heading carries NO RAM (the comparison may take it from the phone's existing variants, or asks),
 *    and "All Colours" stays "All Colours" (the Owner chooses the colours later).
 *  - The output has exactly as many lines as the input, so every line number still points at the Owner's own line.
 *  - "12-512Gb" (RAM-storage with a dash) is also accepted on ordinary one-line entries.
 *  - A standalone "PTA" / "PTA Approved" is read as PTA Approved (normalisePtaWords); a heading may carry "PTA",
 *    "Non-PTA" or "Used" for every colour line under it.
 */
import type { BrandReference } from "./catalogSheet";

export type SupplierOrigin = {
  /** The Owner's own line (1-based) that became this rewritten line. */
  lineNumber: number;
  /** The Owner's line as written. */
  original: string;
  /** The heading line it was read under. */
  heading: string;
};

export type SupplierBlockResult = {
  /** The list with every recognised block rewritten into one line per variant (same number of lines). */
  text: string;
  /** Blocks rewritten. */
  blocks: number;
  /** Variant lines produced from blocks. */
  variantLines: number;
  /** Rewritten line number -> where it came from (for the Owner's review notes). */
  origins: Record<number, SupplierOrigin>;
};

const STORAGE_SIZES = new Set([8, 16, 32, 64, 128, 256, 512, 1024, 2048]);

// "12-512Gb", "12/512GB", "12 + 512", "8-256" (RAM-storage) at the end of a heading.
const RAM_STORAGE = /(?:^|\s)(\d{1,2})\s*[-/+]\s*(\d{1,4})\s*(gb|tb)?$/i;
// "256Gb", "1TB" (storage only) at the end of a heading.
const STORAGE_ONLY = /(?:^|\s)(\d{1,4})\s*(gb|tb)$/i;
// A whole line that is only a storage (optionally RAM-storage): a sub-heading inside a block.
const SUB_HEADING = /^(?:(\d{1,2})\s*(?:gb)?\s*[-/+]\s*)?(\d{1,4})\s*(gb|tb)?$/i;
// List decoration around a heading / sub-heading line: WhatsApp *bold* or _italic_, a leading bullet or emoji, a trailing colon.
const decoration = (line: string) => collapse(line.replace(/[*_]+/g, " ").replace(/^[^\p{L}\p{N}]+/u, "").replace(/[\s:]+$/, ""));
// A price at the end of a line: "@438,000", "@ 438000/-", "Rs 438,000", or a bare number of 4+ digits.
const TRAILING_PRICE = /^(.*?)\s*(?:@\s*|(?:rs\.?|pkr)\s*)?((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?)\s*(?:\/-)?$/i;
const PRICE_ONLY = /^(?:@\s*|(?:rs\.?|pkr)\s*)?((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?)\s*(?:\/-)?$/i;
const HAS_PRICE_MARK = /@|\brs\.?\s*\d|\bpkr\s*\d/i;
// A colour label: 1-3 words of letters (no digits), e.g. "Blk", "Sky Blue", "Titanium Gray", "All Colours".
const COLOUR_LABEL = /^[A-Za-z][A-Za-z&'.-]*(?:\s+[A-Za-z][A-Za-z&'.-]*){0,2}$/;
export const ALL_COLOURS_LABEL = /^(?:all|any)\s+(?:colou?rs?|clrs?)$/i;

const collapse = (line: string) => line.replace(/\s+/g, " ").trim();

function storageGb(amount: string, unit: string | undefined): number | null {
  const value = Number(amount);
  if (!Number.isInteger(value) || value <= 0) return null;
  const gb = unit && unit.toLowerCase() === "tb" ? value * 1024 : value;
  return STORAGE_SIZES.has(gb) ? gb : null;
}

const storageText = (gb: number) => (gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`);

type Capacity = { ram: number | null; storage: number };

function readCapacity(text: string): { capacity: Capacity; rest: string } | null {
  const both = text.match(RAM_STORAGE);
  if (both) {
    const ram = Number(both[1]);
    const storage = storageGb(both[2], both[3]);
    if (storage !== null && ram >= 1 && ram <= 24 && ram < storage) return { capacity: { ram, storage }, rest: text.slice(0, both.index).trim() };
  }
  const only = text.match(STORAGE_ONLY);
  if (only) {
    const storage = storageGb(only[1], only[2]);
    if (storage !== null) return { capacity: { ram: null, storage }, rest: text.slice(0, only.index).trim() };
  }
  return null;
}

function brandOf(text: string, brands: readonly BrandReference[]): { brand: string; model: string } | null {
  const lower = text.toLowerCase();
  for (const reference of brands) {
    for (const name of [reference.name, ...(reference.aliases ?? [])]) {
      const candidate = name.trim();
      if (!candidate) continue;
      if (lower === candidate.toLowerCase()) return null; // brand only: a section heading, not a phone
      if (lower.startsWith(`${candidate.toLowerCase()} `)) {
        const model = text.slice(candidate.length).trim();
        return model ? { brand: reference.name, model } : null;
      }
    }
  }
  return null;
}

/**
 * tags: PTA / condition words written on the heading ("Non-PTA", "PTA Approved", "Used"), passed to every line under it.
 * capacity null: a model-only heading ("Samsung S26 FE"); its colour lines need a RAM/storage sub-heading ("8/256GB").
 */
type Heading = { brand: string; model: string; capacity: Capacity | null; line: string; index: number; tags: string };

function headingTag(word: string): string {
  const value = word.toLowerCase().replace(/[()]/g, "");
  if (/^non[\s-]?pta$/.test(value)) return "Non-PTA";
  if (value === "used") return "Used";
  return "PTA Approved";
}

/** A phone heading: known brand + model + capacity at the end, and no price. PTA / condition words may appear anywhere. */
function readHeading(line: string, index: number, brands: readonly BrandReference[]): Heading | null {
  if (HAS_PRICE_MARK.test(line) || TRAILING_PRICE.test(line)) return null;
  const tags: string[] = [];
  const bare = collapse(decoration(line).replace(HEADING_TAGS, (_whole, lead: string, word: string) => {
    tags.push(headingTag(word));
    return lead;
  }));
  const read = readCapacity(bare);
  if (read && !read.rest) return null;
  // Multiline grouping (Owner-approved 2026-11-24): "Samsung S26 FE" (brand + model, no capacity, no price) is also a
  // heading; the RAM/storage comes from the sub-heading lines under it ("8/256GB"). Without one, nothing is rewritten.
  const named = brandOf(read ? read.rest : bare, brands);
  if (!named || /\d{4,}/.test(named.model)) return null;
  return { ...named, capacity: read ? read.capacity : null, line, index, tags: [...new Set(tags)].join(" ") };
}

/** "Blk @438,000" -> { label: "Blk", price: "438,000" }; null when the line is not a colour + price line. */
function readColourPrice(line: string, brands: readonly BrandReference[]): { label: string; price: string } | null {
  const match = line.match(TRAILING_PRICE);
  if (!match) return null;
  const label = collapse(match[1].replace(/[:\-–—]+$/, ""));
  if (!label || !COLOUR_LABEL.test(label) || brandOf(`${label} x`, brands)) return null;
  return { label: ALL_COLOURS_LABEL.test(label) ? "All Colours" : label, price: match[2] };
}

// "8/256 GB - Pistachio, Graphite, Blueberry - Rs 235,000" (Owner-approved 2026-11-23): RAM/storage, a colour list and the
// price on ONE line under a model heading. The capacity must open the line (a unit is required without a RAM, as for a
// sub-heading), every colour must be a plain colour label, and the price must close the line; otherwise nothing changes.
const LINE_CAPACITY = /^(?:(\d{1,2})\s*(?:gb)?\s*[-/+]\s*)?(\d{1,4})\s*(gb|tb)?(?=[\s\-–—:|,]|$)/i;
const EDGE_SEPARATORS = /^[\s\-–—:|,]+|[\s\-–—:|,]+$/g;

function readCapacityColoursPrice(line: string, brands: readonly BrandReference[]): { capacity: Capacity; label: string; price: string } | null {
  const text = decoration(line);
  const head = text.match(LINE_CAPACITY);
  if (!head) return null;
  const storage = storageGb(head[2], head[3]);
  const ram = head[1] ? Number(head[1]) : null;
  if (storage === null || (!head[3] && ram === null) || (ram !== null && (ram < 1 || ram > 24 || ram >= storage))) return null;
  const priced = text.slice(head[0].length).match(TRAILING_PRICE);
  if (!priced) return null;
  const colours = priced[1].replace(EDGE_SEPARATORS, "").split(/\s*[,/&]\s*/).map(collapse).filter(Boolean);
  if (!colours.length || colours.some((colour) => !COLOUR_LABEL.test(colour) || brandOf(`${colour} x`, brands))) return null;
  const all = colours.filter((colour) => ALL_COLOURS_LABEL.test(colour));
  if (all.length && colours.length > 1) return null; // "All Colours, Black" is never guessed
  return { capacity: { ram, storage }, label: all.length ? "All Colours" : colours.join(", "), price: priced[2] };
}

// PTA words (Owner-approved 2026-11-23). The shared parser reads "PTA Approved" and "Non-PTA" but not a standalone "PTA":
// "Black PTA" became the colour "Black Pta", and "S26 Ultra PTA 12/512" even became a different phone name. Here a standalone
// "PTA" / "(PTA)" / "PTA Approved" / "Approved PTA" is rewritten as "PTA Approved" just before the price. "Non-PTA" lines and
// semicolon-field lines ("…; 438000; PTA") are left exactly as written (the parser already reads them).
const NON_PTA = /\bnon[\s-]?pta\b/i;
const STANDALONE_PTA = /(^|\s)\(?(?:pta[\s-]*approved|approved[\s-]*pta|pta)\)?(?=\s|$|[,@])/gi;
const PRICE_TAIL = /^(.*?)\s*((?:@\s*|(?:rs\.?|pkr)\s*)?(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:\/-)?)$/i;
/** Words a block heading may carry for every colour line under it. */
const HEADING_TAGS = /(^|\s)(non[\s-]?pta|pta[\s-]*approved|approved[\s-]*pta|\(?pta\)?|used)(?=\s|$)/gi;

/** Standalone "PTA" -> "PTA Approved" before the price; everything else unchanged. */
export function normalisePtaWords(line: string): string {
  if (!line.trim() || line.includes(";") || NON_PTA.test(line)) return line;
  STANDALONE_PTA.lastIndex = 0;
  if (!STANDALONE_PTA.test(line)) return line;
  STANDALONE_PTA.lastIndex = 0;
  const rest = collapse(line.replace(STANDALONE_PTA, " "));
  const price = rest.match(PRICE_TAIL);
  return price ? `${price[1]} PTA Approved ${price[2]}` : `${rest} PTA Approved`;
}

/** "12-512Gb" -> "12/512GB" on an ordinary one-line entry (RAM 1-24 GB, a real storage size). */
export function normaliseDashCapacity(line: string): string {
  return line.replace(/(^|\s)(\d{1,2})\s*-\s*(\d{1,4})\s*(gb|tb)?(?=\s|$)/gi, (whole, lead: string, ram: string, size: string, unit: string | undefined) => {
    const storage = storageGb(size, unit);
    const ramGb = Number(ram);
    if (storage === null || ramGb < 1 || ramGb > 24 || ramGb >= storage) return whole;
    return `${lead}${ramGb}/${storageText(storage)}`;
  });
}

/** Rewrites supplier blocks into one line per variant. Pure and deterministic; never changes a line it does not understand. */
export function expandSupplierBlocks(text: string, brands: readonly BrandReference[]): SupplierBlockResult {
  const input = text.replace(/\r\n?/g, "\n").split("\n");
  const output = [...input];
  const origins: Record<number, SupplierOrigin> = {};
  let blocks = 0;
  let variantLines = 0;

  let heading: Heading | null = null;
  let capacity: Capacity | null = null;
  let subHeadingIndex: number | null = null;
  let headingUsed = false;
  let pendingLabel: { label: string; index: number } | null = null;

  const emit = (index: number, label: string, price: string, extraBlank?: number) => {
    if (!heading || !capacity) return;
    const size = capacity.ram !== null ? `${capacity.ram}/${storageText(capacity.storage)}` : storageText(capacity.storage);
    output[index] = normalisePtaWords(`${heading.brand} ${heading.model} ${size} ${label}${heading.tags ? ` ${heading.tags}` : ""} @ ${price}`);
    const original = extraBlank !== undefined ? `${collapse(input[index])} ${collapse(input[extraBlank])}` : collapse(input[index]);
    origins[index + 1] = { lineNumber: index + 1, original, heading: subHeadingIndex !== null ? `${heading.line} · ${collapse(input[subHeadingIndex])}` : heading.line };
    if (extraBlank !== undefined) output[extraBlank] = "";
    if (!headingUsed) {
      output[heading.index] = "";
      blocks += 1;
      headingUsed = true;
    }
    if (subHeadingIndex !== null) output[subHeadingIndex] = "";
    variantLines += 1;
  };
  const endBlock = () => {
    heading = null;
    capacity = null;
    subHeadingIndex = null;
    headingUsed = false;
    pendingLabel = null;
  };

  input.forEach((raw, index) => {
    const line = collapse(raw);
    if (!line) return; // blank lines never end a block
    const next = readHeading(line, index, brands);
    if (next) {
      endBlock();
      heading = next;
      capacity = next.capacity;
      // Kept (with "12-512" read as 12/512) if no colour line follows; blanked once it heads a block.
      output[index] = normalisePtaWords(normaliseDashCapacity(raw));
      return;
    }
    if (!heading) {
      output[index] = normalisePtaWords(normaliseDashCapacity(raw));
      return;
    }
    const sub = decoration(line).match(SUB_HEADING);
    if (sub) {
      const storage = storageGb(sub[2], sub[3]);
      const ram = sub[1] ? Number(sub[1]) : null;
      // A storage without a unit ("8/256") counts only together with a RAM; a lone number is never a sub-heading.
      if (storage !== null && (sub[3] || ram !== null) && (ram === null || (ram >= 1 && ram <= 24 && ram < storage))) {
        capacity = { ram, storage };
        subHeadingIndex = index;
        pendingLabel = null;
        return;
      }
    }
    const combined = readCapacityColoursPrice(line, brands);
    if (combined) {
      // The line's own RAM/storage applies to this line only; the block's capacity and sub-heading are kept as they were.
      const [blockCapacity, blockSubHeading] = [capacity, subHeadingIndex];
      capacity = combined.capacity;
      subHeadingIndex = null;
      pendingLabel = null;
      emit(index, combined.label, combined.price);
      [capacity, subHeadingIndex] = [blockCapacity, blockSubHeading];
      return;
    }
    if (!capacity) {
      // A model-only heading with no RAM/storage yet: never guessed — the block ends and the line stays as written.
      endBlock();
      output[index] = normalisePtaWords(normaliseDashCapacity(raw));
      return;
    }
    const priceOnly = line.match(PRICE_ONLY);
    if (priceOnly && pendingLabel) {
      emit(pendingLabel.index, pendingLabel.label, priceOnly[1], index);
      pendingLabel = null;
      return;
    }
    const colourPrice = readColourPrice(line, brands);
    if (colourPrice) {
      pendingLabel = null;
      emit(index, colourPrice.label, colourPrice.price);
      return;
    }
    if (COLOUR_LABEL.test(line) && !brandOf(`${line} x`, brands)) {
      // A colour whose price is on the next line ("All Colours" / "@385,000").
      pendingLabel = { label: ALL_COLOURS_LABEL.test(line) ? "All Colours" : line, index };
      return;
    }
    // Anything else ends the block and is left exactly as written.
    endBlock();
    output[index] = normalisePtaWords(normaliseDashCapacity(raw));
  });

  return { text: output.join("\n"), blocks, variantLines, origins };
}
