export type SpecificationRow = { group: string | null; label: string; value: string };
export type SpecificationGroup = { title: string; rows: SpecificationRow[] };

const OTHER = "Other";

/** Preferred display order; groups not listed follow in first-seen order, "Other" last. */
const GROUP_ORDER = [
  "Display",
  "Performance",
  "Memory",
  "Storage",
  "Camera",
  "Battery",
  "Connectivity",
  "Network",
  "Build",
  "Software",
  "Audio",
  "Security",
];

/** Groups rows by their Section, keeping row order within a group. Never drops or rewrites a row. */
export function groupSpecifications(rows: SpecificationRow[]): SpecificationGroup[] {
  const groups = new Map<string, SpecificationRow[]>();
  for (const row of rows) {
    const title = row.group?.trim() || OTHER;
    const key = title.toLowerCase();
    const existing = [...groups.keys()].find((k) => k.toLowerCase() === key) ?? title;
    groups.set(existing, [...(groups.get(existing) ?? []), row]);
  }
  const rank = (title: string) => {
    if (title === OTHER) return Number.MAX_SAFE_INTEGER;
    const index = GROUP_ORDER.findIndex((name) => name.toLowerCase() === title.toLowerCase());
    return index === -1 ? GROUP_ORDER.length : index;
  };
  return [...groups.entries()]
    .map(([title, groupRows], order) => ({ title, rows: groupRows, order }))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.order - b.order)
    .map(({ title, rows: groupRows }) => ({ title, rows: groupRows }));
}

/** PDP compact view (Owner-approved 2026-11-24): exactly these specifications, at most one row each, in this order. */
export const KEY_SPECIFICATIONS = [
  { key: "display-size", label: "Display Size", section: "Display", groups: ["Display"], match: /screen size|display size|^size$/i },
  { key: "display-type", label: "Display Type", section: "Display", groups: ["Display"], match: /display type|screen type|panel|display technology/i },
  { key: "processor", label: "Processor", section: "Performance", groups: ["Performance", "Processor", "Platform", "Chipset"], match: /chipset|processor|\bsoc\b|platform/i },
  { key: "rear-camera", label: "Rear Camera", section: "Camera", groups: ["Camera", "Cameras"], match: /^(rear|main|primary|back) cameras?$/i },
  { key: "front-camera", label: "Front Camera", section: "Camera", groups: ["Camera", "Cameras"], match: /^(front|selfie) cameras?$/i },
  { key: "battery-capacity", label: "Battery Capacity", section: "Battery", groups: ["Battery"], match: /battery capacity|^capacity$|battery size/i },
  { key: "fast-charging", label: "Fast Charging", section: "Battery", groups: ["Battery", "Charging"], match: /^(wired|fast) charging$|charging speed|^charging$/i },
] as const;
export const KEY_SPECIFICATION_LIMIT = KEY_SPECIFICATIONS.length;

export type KeySpecification = { key: (typeof KEY_SPECIFICATIONS)[number]["key"]; label: string; section: string; value: string; row: SpecificationRow };

const sameText = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A shorter way to SHOW a stored value in the compact view (the stored value itself is never changed; the full list
 * shows it as stored). Only a multi-lens camera line is shortened to its megapixels: "200 MP wide + 50 MP ultrawide"
 * → "200 MP + 50 MP". Anything else is shown as stored (spacing tidied).
 */
export function conciseSpecValue(key: KeySpecification["key"], value: string): string {
  const tidy = value.replace(/\s+/g, " ").trim();
  if (key === "rear-camera" || key === "front-camera") {
    const megapixels = [...tidy.matchAll(/(\d+(?:\.\d+)?)\s*MP\b/gi)].map((match) => `${match[1]} MP`);
    if (megapixels.length > 1 && /\+|,|\//.test(tidy)) return megapixels.join(" + ");
  }
  return tidy;
}

/**
 * The compact view: Display Size, Display Type, Processor, Rear Camera, Front Camera, Battery Capacity, Fast Charging —
 * the first stored row whose LABEL matches each (never chosen by value). A specification the phone does not have is
 * skipped, never replaced by another one; a value already shown is not repeated. `hiddenRows` = rows not shown. When
 * none matches, or nothing would be hidden, the compact view does not apply (`null`): every specification is shown.
 */
export function keySpecifications(groups: SpecificationGroup[]): { items: KeySpecification[]; hiddenRows: number } | null {
  const items: KeySpecification[] = [];
  const used = new Set<SpecificationRow>();
  for (const spec of KEY_SPECIFICATIONS) {
    const rows = groups.filter((group) => spec.groups.some((name) => name.toLowerCase() === group.title.toLowerCase())).flatMap((group) => group.rows);
    const row = rows.find((candidate) => spec.match.test(candidate.label.trim()) && !used.has(candidate));
    if (!row || !row.value.trim()) continue;
    if (items.some((item) => sameText(item.row.value) === sameText(row.value))) continue;
    used.add(row);
    items.push({ key: spec.key, label: spec.label, section: spec.section, value: conciseSpecValue(spec.key, row.value), row });
  }
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (!items.length || items.length === total) return null;
  return { items, hiddenRows: total - items.length };
}

/** The Top 7 as section cards (Display, Performance, Camera, Battery), in order; empty sections are left out. */
export function keySpecificationCards(items: readonly KeySpecification[]): { title: string; items: KeySpecification[] }[] {
  const cards: { title: string; items: KeySpecification[] }[] = [];
  for (const item of items) {
    const card = cards.find((entry) => entry.title === item.section);
    if (card) card.items.push(item);
    else cards.push({ title: item.section, items: [item] });
  }
  return cards;
}

const NOT_A_VALUE = /^(n\/?a|na|not available|not applicable|none|unknown|tbd|tba|-+|\u2014|\u2013)$/i;
/** Commercial facts are not specifications (they live on the variant / product): never shown in the specifications. */
const COMMERCIAL_LABEL = /\bpta\b|\bprice\b|warranty|\bstock\b|availability|\bcondition\b|delivery|shipping/i;

/**
 * What the PDP shows (display only; stored rows are never changed): rows with an empty or N/A value, commercial facts
 * (PTA, price, warranty, stock, condition, delivery) and exact repeats (same section, label and value) are left out.
 */
export function displayableSpecifications(rows: readonly SpecificationRow[]): SpecificationRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = row.value.replace(/\s+/g, " ").trim();
    if (!value || NOT_A_VALUE.test(value) || COMMERCIAL_LABEL.test(row.label)) return false;
    const key = `${(row.group ?? "").trim().toLowerCase()}|${row.label.replace(/\s+/g, " ").trim().toLowerCase()}|${value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Phone PDP "Show more" (Owner-approved 2026-11-24): at most this many specifications in total. */
export const FULL_SPECIFICATION_LIMIT = 25;

type SectionRule = { max: number; useful: readonly RegExp[] };
/** Per section: the most rows shown and the labels shown first (in this order). Other rows follow in stored order. */
const FULL_SECTION_RULES: Readonly<Record<string, SectionRule>> = {
  display: { max: 4, useful: [/screen size|display size/i, /display type|screen type|panel/i, /resolution/i, /refresh/i, /brightness/i] },
  performance: { max: 3, useful: [/chipset|processor|\bsoc\b/i, /^cpu$|\bcores?\b/i, /\bgpu\b/i] },
  camera: { max: 3, useful: [/^(rear|main|primary|back) cameras?$/i, /^(front|selfie) cameras?$/i, /video/i] },
  battery: { max: 3, useful: [/capacity/i, /wired charging|fast charging/i, /wireless charging/i] },
  connectivity: { max: 5, useful: [/^network$|\b5g\b/i, /sim support|^sim$/i, /wi-?fi/i, /bluetooth/i, /\bnfc\b/i, /\busb\b/i] },
  build: { max: 3, useful: [/dimension/i, /weight/i, /protection|\bip\d/i] },
  software: { max: 2, useful: [/operating system|^os$/i, /^ui$|\binterface\b/i] },
  audio: { max: 1, useful: [] },
  security: { max: 1, useful: [] },
  other: { max: 2, useful: [] },
};
const DEFAULT_SECTION_RULE: SectionRule = { max: 2, useful: [] };
/** Minor technical details: kept in the database, not listed on the PDP. */
const MINOR_DETAIL = /aperture|\bois\b|autofocus|flash|zoom|cooling|clock speed|powershare|removable|ultra-?wideband|satellite|privacy display|glass|\b(ultra ?wide|telephoto|macro|depth) camera\b/i;

/**
 * Phone PDP "Show more": the useful specifications only — at most 25 in total, each section capped (Display 4, Camera 3,
 * Battery 3, …), the Top 7 first, no minor technical details and no value repeated within a section. Rows keep their
 * stored order inside a section. Display only: every stored row stays in the database.
 */
export function fullSpecificationGroups(groups: SpecificationGroup[], keyItems: readonly KeySpecification[] = []): SpecificationGroup[] {
  const keyRows = new Set(keyItems.map((item) => item.row));
  let budget = FULL_SPECIFICATION_LIMIT;
  const result: SpecificationGroup[] = [];
  for (const group of groups) {
    if (budget <= 0) break;
    const rule = FULL_SECTION_RULES[group.title.toLowerCase()] ?? DEFAULT_SECTION_RULE;
    const limit = Math.min(rule.max, budget);
    const chosen: SpecificationRow[] = [];
    const add = (row: SpecificationRow | undefined) => {
      if (!row || chosen.length >= limit || chosen.includes(row)) return;
      if (chosen.some((other) => sameText(other.value) === sameText(row.value))) return;
      chosen.push(row);
    };
    for (const row of group.rows) if (keyRows.has(row)) add(row);
    for (const pattern of rule.useful) add(group.rows.find((row) => pattern.test(row.label.trim()) && !MINOR_DETAIL.test(row.label) && !chosen.includes(row)));
    for (const row of group.rows) if (!MINOR_DETAIL.test(row.label)) add(row);
    if (!chosen.length) continue;
    budget -= chosen.length;
    result.push({ title: group.title, rows: group.rows.filter((row) => chosen.includes(row)) });
  }
  return result;
}
