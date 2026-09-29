// Admin display and validation for explicit-variant facts, including the used-phone facts
// added in 202609240005 (condition_grade, battery_health_percent, battery_cycle_count).
// The database enforces the same rules (grade A++ only when used, BH 1-100, cycles >= 0).

export const CONDITION_GRADES = ["A++"] as const;

// SIM configuration (202609270003): optional; blank stays NULL and is never inferred.
export const SIM_CONFIGURATIONS = [
  { value: "physical_sim", label: "Physical SIM" },
  { value: "esim", label: "eSIM" },
  { value: "physical_plus_esim", label: "Physical + eSIM" },
  { value: "dual_esim", label: "Dual eSIM" },
] as const;

/** Display label for a stored SIM configuration; NULL (not supplied) has no label. */
export const simConfigurationLabel = (value: string | null | undefined) =>
  value ? SIM_CONFIGURATIONS.find((option) => option.value === value)?.label ?? value : null;

/** Blank selection saves NULL; any other value must be one of SIM_CONFIGURATIONS. */
export function parseSimConfiguration(value: string | null | undefined):
  | { ok: true; value: string | null }
  | { ok: false; message: string } {
  if (value === null || value === undefined || value.trim() === "") return { ok: true, value: null };
  return SIM_CONFIGURATIONS.some((option) => option.value === value)
    ? { ok: true, value }
    : { ok: false, message: "SIM Configuration must be Physical SIM, eSIM, Physical + eSIM or Dual eSIM." };
}

const PTA_LABELS: Record<string, string> = {
  approved: "PTA Approved",
  not_approved: "Non-PTA",
  not_applicable: "PTA not applicable",
  unknown: "PTA unknown",
};
const CONDITION_LABELS: Record<string, string> = {
  brand_new: "Brand New",
  used: "Used",
  open_box: "Open Box",
  refurbished: "Refurbished",
  unknown: "Condition unknown",
};
const DELIVERY_LABELS: Record<string, string> = {
  karachi_only: "Karachi Only",
  nationwide: "Nationwide",
};

export const ptaLabel = (value: string | null | undefined) => PTA_LABELS[value ?? "unknown"] ?? value ?? "PTA unknown";
export const conditionLabel = (value: string | null | undefined) =>
  CONDITION_LABELS[value ?? "unknown"] ?? value ?? "Condition unknown";
export const deliveryLabel = (value: string | null | undefined) =>
  value ? DELIVERY_LABELS[value] ?? value : "Delivery unresolved";

export type VariantFactsRow = {
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  pta_status: string;
  condition: string;
  condition_grade?: string | null;
  battery_health_percent?: number | null;
  battery_cycle_count?: number | null;
  delivery_scope: string | null;
  is_active?: boolean;
  quantity?: number;
};

/** Labelled facts for one variant row; unsupplied optional facts are shown as "—", never invented. */
export function variantFacts(row: VariantFactsRow): Array<{ label: string; value: string }> {
  return [
    { label: "RAM", value: row.ram_display || "—" },
    { label: "Storage", value: row.storage_display || "—" },
    { label: "Color", value: row.color_finish || "—" },
    { label: "PTA", value: ptaLabel(row.pta_status) },
    { label: "Condition", value: conditionLabel(row.condition) },
    { label: "Grade", value: row.condition_grade || "—" },
    { label: "Battery Health", value: row.battery_health_percent != null ? `${row.battery_health_percent}%` : "—" },
    { label: "Cycle Count", value: row.battery_cycle_count != null ? String(row.battery_cycle_count) : "—" },
    { label: "Delivery", value: deliveryLabel(row.delivery_scope) },
    { label: "Stock", value: `${row.quantity ?? 0}` },
    { label: "Status", value: row.is_active === false ? "Hidden" : "Active" },
  ];
}

export type UsedPhoneFactsInput = {
  condition: string;
  conditionGrade: string | null | undefined;
  batteryHealth: string | number | null | undefined;
  cycleCount: string | number | null | undefined;
};

export type UsedPhoneFacts = {
  condition_grade: string | null;
  battery_health_percent: number | null;
  battery_cycle_count: number | null;
};

const blank = (value: string | number | null | undefined) => value === null || value === undefined || String(value).trim() === "";

/**
 * Validates the editable used-phone facts. Blank stays NULL. Grade applies only to Used
 * variants (it is cleared for any other condition); Battery Health and Cycle Count are
 * optional for every condition.
 */
export function parseUsedPhoneFacts(input: UsedPhoneFactsInput):
  | { ok: true; values: UsedPhoneFacts }
  | { ok: false; message: string } {
  const grade = input.condition === "used" && input.conditionGrade ? input.conditionGrade : null;
  if (grade !== null && !(CONDITION_GRADES as readonly string[]).includes(grade))
    return { ok: false, message: "Condition Grade must be A++." };

  let batteryHealth: number | null = null;
  if (!blank(input.batteryHealth)) {
    const text = String(input.batteryHealth).trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || value < 1 || value > 100)
      return { ok: false, message: "Battery Health must be a whole number from 1 to 100." };
    batteryHealth = value;
  }

  let cycleCount: number | null = null;
  if (!blank(input.cycleCount)) {
    const text = String(input.cycleCount).trim();
    if (!/^\d+$/.test(text) || Number(text) > 2_147_483_647)
      return { ok: false, message: "Cycle Count must be a whole number of 0 or more." };
    cycleCount = Number(text);
  }

  return {
    ok: true,
    values: { condition_grade: grade, battery_health_percent: batteryHealth, battery_cycle_count: cycleCount },
  };
}
