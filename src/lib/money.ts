export type MinorUnitValue = number | bigint | string;

function minorBigInt(value: MinorUnitValue) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error("Money must be a safe integer minor-unit value.");
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value))
    throw new Error("Money must contain integer minor units only.");
  return BigInt(value);
}

export function parsePkrMajorToMinor(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      "Enter a non-negative PKR amount with at most two decimal places.",
    );
  }
  const [major, fraction = ""] = normalized.split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Price exceeds the supported safe integer range.");
  return Number(minor);
}

export function pkrMajorInputFromMinor(value: MinorUnitValue) {
  const minor = minorBigInt(value);
  const major = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, "0");
  return fraction === "00" ? major.toString() : `${major}.${fraction}`;
}

export function formatPkrMinor(value: MinorUnitValue) {
  const minor = minorBigInt(value);
  const major = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, "0");
  const formattedMajor = new Intl.NumberFormat("en-PK", {
    maximumFractionDigits: 0,
  }).format(major);
  return fraction === "00"
    ? `Rs ${formattedMajor}`
    : `Rs ${formattedMajor}.${fraction}`;
}

export function minimumActiveVariantPrice<
  T extends { priceMinor: MinorUnitValue; isActive?: boolean },
>(variants: T[]) {
  let minimum: bigint | null = null;
  for (const variant of variants) {
    if (variant.isActive === false) continue;
    const price = minorBigInt(variant.priceMinor);
    if (minimum === null || price < minimum) minimum = price;
  }
  if (minimum === null) return null;
  if (minimum > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Price exceeds the supported safe integer range.");
  return Number(minimum);
}
