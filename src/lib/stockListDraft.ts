import { EXTENDED_RAM, canonicalModel, catalogSlug, type CatalogSheetRow } from "./catalogSheet.ts";
import { normalizeColor } from "./catalogColors.ts";
import type { ExcludedLine, ParsedStockList } from "./stockListDelta.ts";

// Durable Owner working state for Admin "Stock List Update": the raw list, the Owner's decisions
// (ambiguity resolutions, checkbox overrides) and nothing else. Pure functions plus an injectable
// Storage, so it is unit-testable without a browser. It never touches the database.
//
// What is deliberately NOT stored (and so can never be trusted after a reload):
//   - the catalog snapshot, the delta, the apply plan, or any "comparison is current" flag
//   - credentials, tokens or any Supabase data
// A restored draft always needs a fresh read-only Compare With Catalog before it can mean anything.

export const DRAFT_STORAGE_KEY = "isolutions.stock-update.draft.v1";
export const DRAFT_VERSION = 1;
const MAX_TEXT_LENGTH = 2_000_000;

// ---------------------------------------------------------------------------
// Resolutions
// ---------------------------------------------------------------------------

export type ResolutionType = "accept_color_as_entered" | "replace_color" | "set_physical_ram" | "move_token_to_model" | "skip_row";

export type Resolution =
  | { type: "accept_color_as_entered" }
  | { type: "replace_color"; color: string }
  | { type: "set_physical_ram"; ramGb: number }
  | { type: "move_token_to_model"; token: string }
  | { type: "skip_row" };

/** One Owner decision about one source row. Keyed by a content-based row key, so it survives re-parsing and line shifts. */
export type ResolutionRecord = { rowKey: string; resolution: Resolution; sourceLine: string; label: string; decidedAt: string };

export type StockDraft = {
  version: typeof DRAFT_VERSION;
  savedAt: string;
  fileName: string;
  text: string;
  /** Hash of `text`; a mismatch on load means the stored draft is damaged. */
  sourceFingerprint: string;
  /** The Owner had parsed this text. Parsing is re-run on restore (read-only); this only says whether to. */
  wasParsed: boolean;
  /** Informational only: when the last comparison ran. Never authorises anything. */
  lastComparedAt: string | null;
  resolutions: Record<string, ResolutionRecord>;
  /** Owner checkbox choices by row key (true = apply, false = leave out). Rows never toggled follow the defaults. */
  selectionOverrides: Record<string, boolean>;
};

export const emptyDraft = (): StockDraft => ({
  version: DRAFT_VERSION,
  savedAt: "",
  fileName: "",
  text: "",
  sourceFingerprint: fingerprintText(""),
  wasParsed: false,
  lastComparedAt: null,
  resolutions: {},
  selectionOverrides: {},
});

/** FNV-1a (32-bit), hex. Not cryptographic: it only detects damaged or changed drafts. */
export function fingerprintText(value: string): string {
  let hash = 0x811c9dc5;
  const text = value.replace(/\r\n?/g, "\n");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length}`;
}

export function describeResolution(resolution: Resolution): string {
  switch (resolution.type) {
    case "accept_color_as_entered":
      return "Colour accepted as entered";
    case "replace_color":
      return `Colour replaced with “${resolution.color}”`;
    case "set_physical_ram":
      return `Physical RAM set to ${resolution.ramGb} GB`;
    case "move_token_to_model":
      return `“${resolution.token}” moved to the model name`;
    case "skip_row":
      return "Row skipped";
  }
}

// ---------------------------------------------------------------------------
// Row keys + applying resolutions
// ---------------------------------------------------------------------------

/** Content-based key per parsed row (source text + colour + occurrence), independent of line numbers and delta ids. */
export function buildRowKeys(rows: readonly CatalogSheetRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${fingerprintText(row.sourceLine)}:${(row.color ?? "").trim().toLowerCase()}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  });
}

const COLOR_REASON = /^(?:Colour ".*" not recognised — verify|Multi-word colour value ".*" — verify)$/;

const MODEL_TOKEN = /^[2-6]g$/i;

/** Which Owner actions make sense for a (resolved) row, derived from its remaining review reasons. Skip is always available. */
export function resolutionOptions(row: CatalogSheetRow): { colorIssue: boolean; physicalRam: number | null; token: string | null } {
  const colorIssue = row.reviewReasons.some((reason) => COLOR_REASON.test(reason));
  const firstRamTerm = row.reviewReasons.includes(EXTENDED_RAM) ? Number(row.ram?.match(/^(\d+)\s*\+/)?.[1]) : NaN;
  const token = colorIssue ? row.color?.split(/\s+/).find((word) => MODEL_TOKEN.test(word)) ?? null : null;
  return { colorIssue, physicalRam: Number.isInteger(firstRamTerm) && firstRamTerm > 0 ? firstRamTerm : null, token };
}

export type ResolvedStockList = {
  parsed: ParsedStockList;
  /** One key per row of `parsed.rows`, aligned by index (the delta engine emits one entry per row, in order). */
  rowKeys: string[];
  /** Keys of the unresolved source rows, in parse order — what the Owner can still decide on. */
  baseKeys: string[];
  applied: string[];
  /** Decisions that no longer match any current row, or whose condition no longer holds (list edited). */
  unmatched: string[];
  skipped: ExcludedLine[];
};

const withoutColorReasons = (row: CatalogSheetRow) => row.reviewReasons.filter((reason) => !COLOR_REASON.test(reason));

function finish(row: CatalogSheetRow, reasons: string[], patch: Partial<CatalogSheetRow>, fields: Partial<CatalogSheetRow["fieldStatus"]>): CatalogSheetRow {
  return { ...row, ...patch, fieldStatus: { ...row.fieldStatus, ...fields }, reviewReasons: reasons, needsReview: reasons.length > 0 };
}

const removeToken = (color: string, token: string) =>
  color
    .split(/\s+/)
    .filter((word) => word.toLowerCase() !== token.toLowerCase())
    .join(" ");

/** Applies the Owner's decisions to a freshly parsed list. Pure: the input is never mutated. Decisions that cannot apply cleanly are reported, never forced. */
export function applyResolutions(parsed: ParsedStockList, resolutions: Readonly<Record<string, ResolutionRecord>>): ResolvedStockList {
  const baseKeys = buildRowKeys(parsed.rows);
  const keyIndex = new Map(baseKeys.map((key, index) => [key, index] as const));
  const handled = new Set<string>();
  const applied: string[] = [];
  const skipped: ExcludedLine[] = [];

  // Model suffixes move to every sibling colour of the same source line.
  const lineSuffix = new Map<string, string>();
  for (const record of Object.values(resolutions)) {
    const index = keyIndex.get(record.rowKey);
    const { resolution } = record;
    if (index === undefined || resolution.type !== "move_token_to_model") continue;
    const row = parsed.rows[index];
    if (row.color && row.color.split(/\s+/).some((word) => word.toLowerCase() === resolution.token.toLowerCase())) {
      lineSuffix.set(`${row.lineNumber}|${row.sourceLine}`, resolution.token);
    }
  }

  const rows: CatalogSheetRow[] = [];
  const rowKeys: string[] = [];
  parsed.rows.forEach((row, index) => {
    const key = baseKeys[index];
    const record = resolutions[key];
    const suffix = lineSuffix.get(`${row.lineNumber}|${row.sourceLine}`);
    let next: CatalogSheetRow | null = row;
    let ownResolution = false;

    if (record) {
      const { resolution } = record;
      if (resolution.type === "skip_row") {
        handled.add(key);
        applied.push(key);
        skipped.push({ lineNumber: row.lineNumber, line: row.sourceLine, reason: `Skipped by Owner: ${[row.model, row.ram, row.storage, row.color].filter(Boolean).join(" ")}` });
        next = null;
      } else if (resolution.type === "accept_color_as_entered" && row.color && withoutColorReasons(row).length !== row.reviewReasons.length) {
        next = finish(row, withoutColorReasons(row), {}, { color: "explicit" });
        ownResolution = true;
      } else if (resolution.type === "replace_color" && row.color && withoutColorReasons(row).length !== row.reviewReasons.length && resolution.color.trim()) {
        next = finish(row, withoutColorReasons(row), { color: normalizeColor(resolution.color).color }, { color: "explicit" });
        ownResolution = true;
      } else if (resolution.type === "set_physical_ram" && row.reviewReasons.includes(EXTENDED_RAM) && Number.isInteger(resolution.ramGb) && resolution.ramGb > 0 && resolution.ramGb <= 64) {
        const listed = row.ram?.replace(/\s*GB$/i, "") ?? "";
        next = finish(row, row.reviewReasons.filter((reason) => reason !== EXTENDED_RAM), { ram: `${resolution.ramGb} GB`, notes: [...row.notes, `Physical RAM set by Owner: ${resolution.ramGb} GB (listed ${listed})`] }, { ram: "explicit", notes: "explicit" });
        ownResolution = true;
      } else if (resolution.type === "move_token_to_model" && suffix) {
        const color = row.color ? removeToken(row.color, resolution.token) : "";
        if (!color) {
          handled.add(key);
          applied.push(key);
          next = null;
        } else {
          next = finish(row, withoutColorReasons(row), { color: normalizeColor(color).color }, { color: "explicit" });
          ownResolution = true;
        }
      }
      // Otherwise the row no longer fits this decision (the list was edited): leave it untouched; it is reported as unmatched.
      if (ownResolution) {
        handled.add(key);
        applied.push(key);
      }
    }

    // Move the token into the model name of every surviving sibling colour of that line.
    if (next && suffix && !(record?.resolution.type === "skip_row")) {
      const model = canonicalModel(`${next.model ?? row.model ?? ""} ${suffix.toUpperCase()}`);
      const hasSuffix = (next.model ?? "").toLowerCase().endsWith(` ${suffix.toLowerCase()}`);
      if (!hasSuffix && next.model) {
        const title = next.brand ? `${next.brand} ${model}` : model;
        next = { ...next, model, productTitle: title, slug: catalogSlug(title) || null };
      }
    }

    if (next) {
      rows.push(next);
      rowKeys.push(key);
    }
  });

  const unmatched = Object.keys(resolutions).filter((key) => !handled.has(key));
  const skippedExcluded = [...parsed.excluded, ...skipped];
  return { parsed: { ...parsed, rows, excluded: skippedExcluded }, rowKeys, baseKeys, applied, unmatched, skipped };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type DraftLoad =
  | { status: "none" }
  | { status: "restored"; draft: StockDraft }
  | { status: "reset"; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readResolution(value: unknown): Resolution | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "accept_color_as_entered":
    case "skip_row":
      return { type: value.type };
    case "replace_color":
      return typeof value.color === "string" && value.color.trim() && value.color.length <= 60 ? { type: "replace_color", color: value.color.trim() } : null;
    case "set_physical_ram":
      return typeof value.ramGb === "number" && Number.isInteger(value.ramGb) && value.ramGb > 0 && value.ramGb <= 64 ? { type: "set_physical_ram", ramGb: value.ramGb } : null;
    case "move_token_to_model":
      return typeof value.token === "string" && /^[A-Za-z0-9+]{1,12}$/.test(value.token) ? { type: "move_token_to_model", token: value.token } : null;
    default:
      return null;
  }
}

/** Validates an untrusted parsed-JSON value into a StockDraft, or null when it is not a usable current-version draft. Entries that fail validation are dropped, never guessed. */
export function sanitizeDraft(value: unknown): StockDraft | null {
  if (!isRecord(value) || value.version !== DRAFT_VERSION) return null;
  if (typeof value.text !== "string" || value.text.length > MAX_TEXT_LENGTH) return null;
  if (value.sourceFingerprint !== fingerprintText(value.text)) return null;
  const resolutions: Record<string, ResolutionRecord> = {};
  if (isRecord(value.resolutions)) {
    for (const [key, raw] of Object.entries(value.resolutions)) {
      if (!isRecord(raw)) continue;
      const resolution = readResolution(raw.resolution);
      if (!resolution || raw.rowKey !== key) continue;
      resolutions[key] = {
        rowKey: key,
        resolution,
        sourceLine: typeof raw.sourceLine === "string" ? raw.sourceLine.slice(0, 500) : "",
        label: typeof raw.label === "string" ? raw.label.slice(0, 200) : "",
        decidedAt: typeof raw.decidedAt === "string" ? raw.decidedAt : "",
      };
    }
  }
  const selectionOverrides: Record<string, boolean> = {};
  if (isRecord(value.selectionOverrides)) {
    for (const [key, flag] of Object.entries(value.selectionOverrides)) if (typeof flag === "boolean") selectionOverrides[key] = flag;
  }
  return {
    version: DRAFT_VERSION,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    fileName: typeof value.fileName === "string" ? value.fileName.slice(0, 200) : "",
    text: value.text,
    sourceFingerprint: value.sourceFingerprint as string,
    wasParsed: value.wasParsed === true,
    lastComparedAt: typeof value.lastComparedAt === "string" ? value.lastComparedAt : null,
    resolutions,
    selectionOverrides,
  };
}

/** Never throws: storage may be missing, blocked, or hold corrupt / old-schema content. */
export function loadDraft(storage: DraftStorage | null): DraftLoad {
  if (!storage) return { status: "none" };
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { status: "none" };
  }
  if (raw === null) return { status: "none" };
  const discard = (reason: string): DraftLoad => {
    try {
      storage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* nothing more to do */
    }
    return { status: "reset", reason };
  };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return discard("The saved draft was unreadable and has been discarded.");
  }
  if (isRecord(value) && value.version !== DRAFT_VERSION) return discard("The saved draft came from an incompatible version and has been discarded.");
  const draft = sanitizeDraft(value);
  if (!draft) return discard("The saved draft was damaged and has been discarded.");
  return { status: "restored", draft };
}

export function hasDraftContent(draft: StockDraft) {
  return Boolean(draft.text.trim()) || Object.keys(draft.resolutions).length > 0 || Object.keys(draft.selectionOverrides).length > 0;
}

/** Returns false when the browser refused the write (quota / blocked); the page stays usable and says so. An empty draft removes the key. */
export function saveDraft(storage: DraftStorage | null, draft: StockDraft, now: Date = new Date()): boolean {
  if (!storage) return false;
  try {
    if (!hasDraftContent(draft)) {
      storage.removeItem(DRAFT_STORAGE_KEY);
      return true;
    }
    const payload: StockDraft = { ...draft, version: DRAFT_VERSION, savedAt: now.toISOString(), sourceFingerprint: fingerprintText(draft.text) };
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Call ONLY after a future Apply has written AND read-back-verified every change. Failed or partial applies must keep the draft.
 * Apply is not implemented in this phase; this exists so the later phase has one correct place to clear.
 */
export function clearDraftAfterVerifiedApply(storage: DraftStorage | null, verification: { written: boolean; readBackVerified: boolean }): boolean {
  if (!verification.written || !verification.readBackVerified) return false;
  return clearDraft(storage);
}

// ---------------------------------------------------------------------------
// Stale-comparison safety
// ---------------------------------------------------------------------------

/** In-memory only, created by a live read-only Compare in THIS page session. Never serialised, so it can never be restored. */
export type ComparisonStamp = { sourceFingerprint: string; resolutionFingerprint: string; comparedAt: string };

export const resolutionFingerprint = (resolutions: Readonly<Record<string, ResolutionRecord>>) =>
  fingerprintText(
    Object.keys(resolutions)
      .sort()
      .map((key) => `${key}=${JSON.stringify(resolutions[key].resolution)}`)
      .join("\n"),
  );

export const makeComparisonStamp = (text: string, resolutions: Readonly<Record<string, ResolutionRecord>>, now: Date = new Date()): ComparisonStamp => ({
  sourceFingerprint: fingerprintText(text),
  resolutionFingerprint: resolutionFingerprint(resolutions),
  comparedAt: now.toISOString(),
});

/** The only gate a future Apply may use: a stamp from a live Compare of exactly the current text and decisions. A restored draft has no stamp, so this is false. */
export function comparisonAuthorizesApply(stamp: ComparisonStamp | null, text: string, resolutions: Readonly<Record<string, ResolutionRecord>>): boolean {
  return stamp !== null && stamp.sourceFingerprint === fingerprintText(text) && stamp.resolutionFingerprint === resolutionFingerprint(resolutions);
}

export function draftFromState(state: {
  text: string;
  fileName: string;
  wasParsed: boolean;
  lastComparedAt: string | null;
  resolutions: Record<string, ResolutionRecord>;
  selectionOverrides: Record<string, boolean>;
}): StockDraft {
  return { version: DRAFT_VERSION, savedAt: "", sourceFingerprint: fingerprintText(state.text), ...state };
}
