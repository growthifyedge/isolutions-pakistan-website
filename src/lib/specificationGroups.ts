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
