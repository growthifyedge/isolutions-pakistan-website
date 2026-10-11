/**
 * One-time, deterministic extraction of PROPOSED product specifications from a Shopify export
 * (Body HTML text and a few structured metafields). Nothing here writes anywhere.
 *
 * Rules:
 * - A value is proposed only when the text states it directly; nothing is inferred from the model name,
 *   general knowledge or marketing adjectives. Every proposal carries its source and an evidence snippet.
 * - The same value stated more than once is de-duplicated. A spec stated with different values in different
 *   sentences is a Conflict (no value is chosen). Several values in ONE sentence are proposed combined and
 *   marked "Review". Ambiguous wording is "Review"; only one clear statement is "High".
 * - Values are normalised for presentation only (5,000mAh -> 5000 mAh, 6.67-inch -> 6.67 inches).
 */

export type SpecConfidence = "High" | "Review";
export type SpecSourceType = "Shopify Body HTML" | "Shopify Metafield";

export const SPEC_SECTIONS = ["Display", "Performance", "Software", "Camera", "Battery", "Connectivity", "Build", "Audio", "Security", "Other"] as const;
export type SpecSection = (typeof SPEC_SECTIONS)[number];

export type ExtractedSpec = {
  section: SpecSection;
  name: string;
  value: string;
  confidence: SpecConfidence;
  sourceType: SpecSourceType;
  evidence: string;
};

export type ExtractedConflict = {
  section: SpecSection;
  name: string;
  alternatives: { value: string; evidence: string; sourceType: SpecSourceType }[];
};

export type ExtractionInput = {
  productTitle: string;
  shopifyTitle?: string;
  bodyHtml: string;
  /** Shopify metafield columns for the handle, keyed by label (e.g. "Display technology"). */
  metafields?: Record<string, string>;
};

export type ExtractionResult = { specs: ExtractedSpec[]; conflicts: ExtractedConflict[]; text: string };

// ---------------- Text ----------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×", deg: "°" };

/** Safe HTML -> readable text: block tags become line breaks, tags/scripts are dropped, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>|<\/(p|div|li|ul|ol|h[1-6]|tr|table|section)\s*>|<hr\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? " ";
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

const PICTOGRAPHS = /[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D}/gu;
const clean = (value: string) => value.replace(PICTOGRAPHS, "").replace(/\s+/g, " ").trim();

/** Sentences (one per line / sentence boundary) with pictographs removed — the units evidence is quoted from. */
export function textUnits(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => clean(line).split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 1);
}

const snippet = (unit: string) => (unit.length > 180 ? `${unit.slice(0, 177)}…` : unit);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEGATION = /\b(no|not|without|non|lacks?|excluding|doesn['’]?t|isn['’]?t)\b[\s-]*$/i;
const negatedAt = (unit: string, index: number) => NEGATION.test(unit.slice(Math.max(0, index - 14), index));

type Candidate = { section: SpecSection; name: string; value: string; unit: string; review?: boolean };
type Matcher = (units: string[], context: { productNames: RegExp | null; brand: string | null }) => Candidate[];

const titleCase = (word: string) => (/^(amoled|oled|ips|lcd|pls|tft|ltpo|2x|ltps|hdr10\+?)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

// ---------------- Matchers (each returns directly stated candidates) ----------------

const screenSize: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    for (const m of unit.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*(?:-\s*)?(?:inch(?:es)?\b|(?<=\.\d{1,2})\s*["”″]|(?<=\.\d{1,2}["”″]))/gi)) {
      const index = m.index ?? 0;
      const size = Number(m[1]);
      if (size < 3 || size > 20 || unit[index - 1] === "/" || /sensor/i.test(unit.slice(index, index + 40))) continue;
      out.push({ section: "Display", name: "Screen Size", value: `${m[1]} inches`, unit });
    }
  }
  return out;
};

const displayType: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units)
    for (const m of unit.matchAll(/\b((?:(?:Dynamic|Super|Fluid|LTPO|Extreme|Foldable|Flexible|Curved)\s+){0,2})(AMOLED|OLED|IPS(?:\s+LCD)?|PLS(?:\s+LCD)?|TFT(?:\s+LCD)?|LCD)(\s*(?:2X|Plus|\+))?/gi)) {
      const value = `${m[1]}${m[2]}${m[3] ?? ""}`.trim().split(/\s+/).map(titleCase).join(" ");
      out.push({ section: "Display", name: "Display Type", value, unit });
    }
  return out;
};

const resolution: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    if (!/display|screen|panel|resolution/i.test(unit) || /video|record|\bfps\b|capture/i.test(unit)) continue;
    const named = [...unit.matchAll(/\b(Full HD\+?|FHD\+?|HD\+|QHD\+?|WQHD\+?|UHD|1\.5K|2K)(?=[\s,.;:)]|$)/gi)].map((m) => m[1]);
    const numeric = [...unit.matchAll(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b(?!\s*mm)/gi)].map((m) => `${m[1]} x ${m[2]} pixels`);
    if (named.length && numeric.length) out.push({ section: "Display", name: "Resolution", value: `${named[0].replace(/^full hd/i, "Full HD")} (${numeric[0]})`, unit });
    else if (named.length) out.push({ section: "Display", name: "Resolution", value: named[0].replace(/^full hd/i, "Full HD"), unit });
    else if (numeric.length) out.push({ section: "Display", name: "Resolution", value: numeric[0], unit });
  }
  return out;
};

const COMPARISON = /\b(over|than|versus|vs\.?|compared|from|upgrade|standard|typical|older|previous)\b/i;
const refreshRate: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    if (/sampling|\bpwm\b|touch/i.test(unit) && !/refresh/i.test(unit)) continue;
    const consumed: [number, number][] = [];
    for (const m of unit.matchAll(/(?<![\d.])(\d{2,3})\s*[-–]\s*(\d{2,3})\s*Hz\b/gi)) {
      if (Number(m[1]) >= 24 && Number(m[2]) <= 240) out.push({ section: "Display", name: "Refresh Rate", value: `${m[1]}-${m[2]}Hz`, unit });
      consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
    for (const m of unit.matchAll(/(up\s*to\s*)?(?<![\d.])(\d{2,3})\s*Hz\b/gi)) {
      const index = m.index ?? 0;
      const n = Number(m[2]);
      if (n < 24 || n > 240 || consumed.some(([a, b]) => index >= a - 4 && index < b)) continue;
      if (COMPARISON.test(unit.slice(Math.max(0, index - 34), index))) continue;
      out.push({ section: "Display", name: "Refresh Rate", value: `${m[1] ? "up to " : ""}${n}Hz`, unit });
    }
  }
  return out;
};

const peakBrightness: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units)
    for (const m of unit.matchAll(/(\d{3,5})\s*nits?\b/gi)) if (/peak/i.test(unit)) out.push({ section: "Display", name: "Peak Brightness", value: `${m[1]} nits`, unit });
  return out;
};

const CHIP_PREFIX = "(?:(MediaTek|Qualcomm|Samsung|Google|Unisoc|UNISOC|HiSilicon|Apple)\\s+)?";
// Model number: "G99", "T7250", "7s", "7300", "9500+", "7360-Turbo" — never "5G" or a process node like "4nm".
const CHIP_MODEL = "(?!5G\\b)(?!\\d+nm\\b)(?:[A-Za-z]{1,2}\\d{1,4}[A-Za-z0-9+]*|\\d{1,4}[A-Za-z+]?)(?:-[A-Za-z]+)?";
const CHIP_TAIL = "(?:Gen\\s*\\d+|Ultimate|Ultra|Pro|Plus|Max|Elite|Extreme|Accelerator|Turbo)\\b";
const chipset: Matcher = (units) => {
  const out: Candidate[] = [];
  const family = new RegExp(`\\b${CHIP_PREFIX}(Snapdragon|Dimensity|Helio|Exynos|Tensor|Kirin|Tiger)\\s+(${CHIP_MODEL})((?:\\s+${CHIP_TAIL}){0,3})`, "gi");
  const unisoc = /\b(Unisoc|UNISOC)\s+(?:(Tiger)\s+)?([A-Z]{1,2}\d{3,4}\w*)/g;
  for (const unit of units) {
    for (const m of unit.matchAll(family)) {
      const tail = m[4].replace(/\s+/g, " ");
      const brand = m[1] ? `${m[1]} ` : "";
      const familyName = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
      // A trailing "Pro / Plus / Max" may belong to the next phrase: such names go to the Owner as Review.
      out.push({ section: "Performance", name: "Chipset", value: `${brand}${familyName} ${m[3]}${tail}`.replace(/\s+/g, " ").trim(), unit, review: /\b(Pro|Plus|Max|Ultra)\b/i.test(tail) });
    }
    for (const m of unit.matchAll(unisoc)) out.push({ section: "Performance", name: "Chipset", value: `Unisoc ${m[2] ? "Tiger " : ""}${m[3]}`, unit });
  }
  return out;
};

const operatingSystem: Matcher = (units) => {
  const out: Candidate[] = [];
  const ui = /\b(XOS|HiOS|One UI|OxygenOS|ColorOS|realme UI|Realme UI|HyperOS|MIUI|Funtouch OS|OriginOS|Nothing OS|MagicOS|Hello UI)\s*(\d+(?:\.\d+)?)?/g;
  for (const unit of units) {
    for (const m of unit.matchAll(/Android\s*(\d{1,2}(?:\.\d)?)/gi)) {
      const before = unit.slice(Math.max(0, (m.index ?? 0) - 32), m.index ?? 0);
      if (/(up\s*to|upgrade|upgradable|updates?|upto|until)\b/i.test(before)) continue;
      out.push({ section: "Software", name: "Operating System", value: `Android ${m[1]}`, unit });
    }
    for (const m of unit.matchAll(ui)) out.push({ section: "Software", name: "UI", value: `${m[1]}${m[2] ? ` ${m[2]}` : ""}`.replace(/^realme UI/i, "realme UI"), unit });
  }
  return out;
};

const MP = /(\d{1,3}(?:\.\d)?)\s*MP\b/gi;
const camera: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    const matches = [...unit.matchAll(MP)];
    if (matches.length >= 2 && /(\d+(?:\.\d)?\s*MP\s*\+\s*){1,3}\d+(?:\.\d)?\s*MP/i.test(unit) && !/front|selfie/i.test(unit)) {
      const chain = /((?:\d+(?:\.\d)?\s*MP\s*\+\s*){1,3}\d+(?:\.\d)?\s*MP)/i.exec(unit)![1];
      out.push({ section: "Camera", name: "Rear Camera Setup", value: chain.replace(/\s*MP/gi, " MP").replace(/\s*\+\s*/g, " + "), unit, review: true });
      continue;
    }
    for (const [position, m] of matches.entries()) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const previousEnd = position > 0 ? (matches[position - 1].index ?? 0) + matches[position - 1][0].length : 0;
      const nextStart = position + 1 < matches.length ? (matches[position + 1].index ?? unit.length) : unit.length;
      const after = unit.slice(end, Math.min(end + 38, nextStart)).toLowerCase();
      const before = unit.slice(Math.max(previousEnd, start - 22), start).toLowerCase();
      const near = `${before} ${after}`;
      const value = `${m[1]} MP`;
      const make = (name: string): Candidate => ({ section: "Camera", name, value, unit });
      if (/ultra[\s-]?wide/.test(after) || /ultra[\s-]?wide\s*$/.test(before)) out.push(make("Ultrawide Camera"));
      else if (/tele(?:photo)?|periscope/.test(after)) out.push(make("Telephoto Camera"));
      else if (/macro/.test(after)) out.push(make("Macro Camera"));
      else if (/^\W*(?:sony\s+\w+\s+|samsung\s+\w+\s+|omnivision\s+\w+\s+)?(?:front|selfie)/.test(after) || /(?:front|selfie)\s*(?:camera|cam)?\s*(?:[:-]|with|of)?\s*$/.test(before)) out.push(make("Front Camera"));
      else if (/^\W*\(?wide\)?(?![\w-])/.test(after) || /^\W*(?:[\w.-]+\s+){0,3}?(?:main|primary|rear\b|wide[\s-]?angle)/.test(after) || /(?:main|primary|rear)\s*(?:camera|sensor)?\s*(?:[:-]|with|of)?\s*$/.test(before)) out.push(make("Main Camera"));
      else if (/depth|portrait|lidar|monochrome|ai\b/.test(near)) continue;
    }
  }
  return out;
};

const battery: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units)
    for (const m of unit.matchAll(/(\d{1,2},?\d{3})\s*mAh\b/gi)) {
      const end = (m.index ?? 0) + m[0].length;
      if (/\b(most|other|typical|typically|competitors?|than|over|above|below|beyond|exceeds?|cap at|compared|standard|average)\b/i.test(unit.slice(Math.max(0, (m.index ?? 0) - 42), m.index ?? 0))) continue;
      if (/^\W*(?:[\w-]+\s+){0,2}?(?:most|other|many|typical|average)\s+(?:phones|devices|smartphones|rivals)/i.test(unit.slice(end, end + 48))) continue;
      const mah = Number(m[1].replace(",", ""));
      if (mah >= 1000 && mah <= 30000) out.push({ section: "Battery", name: "Battery Capacity", value: `${mah} mAh`, unit });
    }
  return out;
};

const charging: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    if (!/charg/i.test(unit)) continue;
    for (const m of unit.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d)?)\s*W(?:att)?\b/g)) {
      const start = m.index ?? 0;
      const forward = unit.slice(start + m[0].length, start + m[0].length + 34).toLowerCase();
      const hits = ([["Reverse Charging", forward.search(/reverse/)], ["Wireless Charging", forward.search(/wireless/)], ["Wired Charging", forward.search(/fast|wired|flash|super|turbo|rapid|quick|charg/)]] as [string, number][]).filter(([, at]) => at >= 0);
      if (!hits.length) continue;
      const name = hits.sort((a, b) => a[1] - b[1])[0][0];
      out.push({ section: "Battery", name, value: `${m[1]}W`, unit });
    }
    if (!/(?<![\d.])\d{1,3}(?:\.\d)?\s*W\b/.test(unit)) {
      if (/reverse\s+(?:wired\s+|wireless\s+)?charging/i.test(unit) && !negatedAt(unit, unit.search(/reverse/i))) out.push({ section: "Battery", name: "Reverse Charging", value: "Supported", unit });
      if (/wireless\s+charging/i.test(unit) && !/reverse\s+wireless/i.test(unit) && !negatedAt(unit, unit.search(/wireless/i))) out.push({ section: "Battery", name: "Wireless Charging", value: "Supported", unit });
    }
  }
  return out;
};

const network: Matcher = (units, { productNames, brand }) => {
  const out: Candidate[] = [];
  const brandName = brand ? new RegExp(`\\b${escapeRegExp(brand)}(?:\\s+[\\w+-]+){0,5}\\s+5G\\b`, "gi") : null;
  for (const unit of units) {
    let text = productNames ? unit.replace(productNames, " ") : unit;
    if (brandName) text = text.replace(brandName, " ");
    // "A27 5G", "Reno16 5G", "Dimensity 7100 5G": the 5G is part of a model / chipset name, not a network statement.
    const fiveG = [...text.matchAll(/(?<![\d.])5G\b/g)].filter((m) => !/[A-Za-z]*\d[\w+-]*\s*$/.test(text.slice(0, m.index ?? 0)) && !negatedAt(text, m.index ?? 0));
    const found: string[] = [];
    if (fiveG.length) found.push("5G");
    if (/(?<![\d.])4G(?:\s*LTE)?\b/i.test(text) && !negatedAt(text, text.search(/4G/i))) found.push("4G LTE");
    if (found.length) out.push({ section: "Connectivity", name: "Network", value: found.join(", "), unit, review: found.length > 1 });
  }
  return out;
};

const wireless: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    for (const m of unit.matchAll(/Wi-?Fi\s*(7|6E|6|5|4)\b/gi)) out.push({ section: "Connectivity", name: "Wi-Fi", value: `Wi-Fi ${m[1].toUpperCase()}`, unit });
    for (const m of unit.matchAll(/Bluetooth\s*(\d(?:\.\d)?)(?![.\w])/gi)) out.push({ section: "Connectivity", name: "Bluetooth", value: `Bluetooth ${m[1]}`, unit });
    const nfc = unit.search(/\bNFC\b/);
    if (nfc >= 0 && !negatedAt(unit, nfc)) out.push({ section: "Connectivity", name: "NFC", value: "Supported", unit });
    const gps = unit.search(/\bGPS\b/);
    if (gps >= 0 && !negatedAt(unit, gps)) out.push({ section: "Connectivity", name: "GPS", value: "Supported", unit });
    if (/\bUSB[\s-]?(?:Type[\s-]?)?C\b/i.test(unit)) out.push({ section: "Connectivity", name: "USB Port", value: "USB Type-C", unit });
    const sims = new Set<string>();
    if (/\bdual[\s-]*(?:nano[\s-]*)?sim\b/i.test(unit)) sims.add("Dual SIM");
    if (/\bsingle[\s-]*sim\b/i.test(unit)) sims.add("Single SIM");
    if (/\be-?sim\b/i.test(unit)) sims.add("eSIM");
    if (sims.size) out.push({ section: "Connectivity", name: "SIM", value: [...sims].join(", "), unit, review: sims.size > 1 });
  }
  return out;
};

const build: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    for (const m of unit.matchAll(/\b(\d{2,3}(?:\.\d+)?)\s*[x×]\s*(\d{2,3}(?:\.\d+)?)\s*[x×]\s*(\d{1,2}(?:\.\d+)?)\s*mm\b/gi))
      out.push({ section: "Build", name: "Dimensions", value: `${m[1]} x ${m[2]} x ${m[3]} mm`, unit });
    if (/weigh|weight/i.test(unit))
      for (const m of unit.matchAll(/(\d{2,3}(?:\.\d)?)\s*(?:g|grams)\b/gi)) out.push({ section: "Build", name: "Weight", value: `${m[1]} g`, unit });
    const ip = [...new Set([...unit.matchAll(/\bIP\s?-?(\d{2}|X\d)\b/g)].map((m) => `IP${m[1]}`))];
    if (ip.length) out.push({ section: "Build", name: "Protection", value: ip.join(", "), unit, review: ip.length > 1 });
    for (const m of unit.matchAll(/\b((?:Corning\s+)?Gorilla\s+Glass(?:\s+(?:Victus\+?(?:\s*\d)?|Armor(?:\s*\d)?|DX\+?|\d))?|Dragontrail(?:\s+\w+)?|Panda\s+Glass)/gi))
      out.push({ section: "Build", name: "Display Protection", value: m[1].replace(/\s+/g, " "), unit });
  }
  return out;
};

const audioSecurity: Matcher = (units) => {
  const out: Candidate[] = [];
  for (const unit of units) {
    const speakers = /\b(stereo|dual)\s+speakers?\b/i.exec(unit);
    if (speakers) out.push({ section: "Audio", name: "Speakers", value: `${titleCase(speakers[1])} speakers`, unit });
    if (/3\.5\s*mm\s*(?:audio\s*|headphone\s*)?jack/i.test(unit) && !negatedAt(unit, unit.search(/3\.5/))) out.push({ section: "Audio", name: "Audio Jack", value: "3.5 mm", unit });
    const finger = /\b(side[\s-]mounted|in[\s-]display|under[\s-]display|rear[\s-]mounted|power[\s-]button)?\s*fingerprint\b/i.exec(unit);
    if (finger && !negatedAt(unit, finger.index)) {
      const qualifier = finger[1]?.trim().replace(/\s+/g, "-").toLowerCase();
      out.push({ section: "Security", name: "Fingerprint Sensor", value: qualifier ? qualifier.charAt(0).toUpperCase() + qualifier.slice(1) : "Supported", unit });
    }
    const face = unit.search(/\bface\s+(?:unlock|recognition|id)\b/i);
    if (face >= 0 && !negatedAt(unit, face)) out.push({ section: "Security", name: "Face Unlock", value: "Supported", unit });
    const sd = /\b(?:micro\s?SD|memory card|expandable (?:storage|memory))\b[^.]{0,50}?(?:up\s*to\s*)?(\d+\s*(?:GB|TB))?/i.exec(unit);
    if (sd && !negatedAt(unit, sd.index)) out.push({ section: "Other", name: "Expandable Storage", value: sd[1] && /up\s*to/i.test(sd[0]) ? `Up to ${sd[1].replace(/\s+/g, "")}` : "Supported", unit });
  }
  return out;
};

const MATCHERS: Matcher[] = [screenSize, displayType, resolution, refreshRate, peakBrightness, chipset, operatingSystem, camera, battery, charging, network, wireless, build, audioSecurity];

// ---------------- Structured metafields (Review only: generic taxonomy values) ----------------

const METAFIELD_MAP: Record<string, { section: SpecSection; name: string; map: (code: string) => string | null }> = {
  "Display technology": { section: "Display", name: "Display Type", map: (c) => ({ amoled: "AMOLED", oled: "OLED", lcd: "LCD", ips: "IPS" } as Record<string, string>)[c] ?? null },
  "Ingress protection (IP) rating": { section: "Build", name: "Protection", map: (c) => (/^ip(x?\d{1,2})$/.test(c) ? c.toUpperCase().replace(/-\d+$/, "") : null) },
  "USB connector type": { section: "Connectivity", name: "USB Port", map: (c) => (c === "usb-type-c" ? "USB Type-C" : null) },
  "SIM card capability": { section: "Connectivity", name: "SIM", map: (c) => (c === "dual" ? "Dual SIM" : c === "single" ? "Single SIM" : null) },
  "Biometric authentication method": { section: "Security", name: "Face Unlock", map: (c) => (c === "face-recognition" ? "Supported" : null) },
};

function metafieldCandidates(metafields: Record<string, string>): (Candidate & { sourceType: SpecSourceType; evidence: string })[] {
  const out: (Candidate & { sourceType: SpecSourceType; evidence: string })[] = [];
  for (const [label, rule] of Object.entries(METAFIELD_MAP)) {
    const raw = (metafields[label] ?? "").trim();
    if (!raw) continue;
    const codes = raw.replace(/^\[|\]$/g, "").split(/[;,]/).map((code) => code.replace(/["']/g, "").trim().toLowerCase()).filter(Boolean);
    const values = [...new Set(codes.map(rule.map).filter((value): value is string => Boolean(value)))];
    if (!values.length) continue;
    out.push({ section: rule.section, name: rule.name, value: values.join(", "), unit: raw, review: true, sourceType: "Shopify Metafield", evidence: `${label}: ${raw}` });
  }
  return out;
}

// ---------------- Merge ----------------

/** Speculative wording ("expect", "rumoured", "likely"…) is never High confidence. */
const HEDGED = /\b(expect(?:ed|s)?|rumou?r(?:ed|s)?|likely|reportedly|probably|may\s+(?:feature|come|offer)|could|estimated|approximately|around|variants?|versions?|depending on)\b/i;
const norm = (value: string) => value.toLowerCase().replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
const wordSuffix = (long: string, short: string) => norm(long) !== norm(short) && (` ${norm(long)} `).includes(` ${norm(short)} `);

/** Extracts proposals for ONE product from ONE Shopify source. Deterministic; nothing is invented. */
export function extractSpecifications(input: ExtractionInput): ExtractionResult {
  const text = htmlToText(input.bodyHtml);
  const units = textUnits(text);
  const names = [input.productTitle, input.shopifyTitle].filter((title): title is string => Boolean(title && title.trim())).map((title) => escapeRegExp(title.trim()).replace(/\\?\s+/g, "\\s+"));
  const brand = input.productTitle.trim().split(/\s+/)[0] || null;
  const productNames = names.length ? new RegExp(`(?:${names.join("|")})(?:\\s+5G)?`, "gi") : null;

  const all: (Candidate & { sourceType: SpecSourceType; evidence: string })[] = [];
  for (const matcher of MATCHERS)
    for (const candidate of matcher(units, { productNames, brand }))
      all.push({ ...candidate, review: candidate.review || HEDGED.test(candidate.unit), sourceType: "Shopify Body HTML", evidence: snippet(candidate.unit) });
  all.push(...metafieldCandidates(input.metafields ?? {}));

  const resolutions = all.filter((c) => c.name === "Resolution" && c.sourceType === "Shopify Body HTML");
  const namedValues = [...new Set(resolutions.filter((c) => !/pixels/.test(c.value)).map((c) => norm(c.value)))];
  const pixelValues = [...new Set(resolutions.filter((c) => /pixels/.test(c.value) && !/\(/.test(c.value)).map((c) => norm(c.value)))];
  if (namedValues.length === 1 && pixelValues.length === 1 && resolutions.every((c) => !/\(/.test(c.value))) {
    const named = resolutions.find((c) => norm(c.value) === namedValues[0])!;
    const pixels = resolutions.find((c) => norm(c.value) === pixelValues[0])!;
    for (let index = all.length - 1; index >= 0; index -= 1) if (all[index].name === "Resolution" && all[index].sourceType === "Shopify Body HTML") all.splice(index, 1);
    all.push({ ...named, value: `${named.value} (${pixels.value})`, evidence: `${named.evidence}  ⟷  ${pixels.evidence}` });
  }

  const groups = new Map<string, typeof all>();
  for (const candidate of all) groups.set(`${candidate.section}|${candidate.name}`, [...(groups.get(`${candidate.section}|${candidate.name}`) ?? []), candidate]);

  const specs: ExtractedSpec[] = [];
  const conflicts: ExtractedConflict[] = [];
  for (const [, members] of groups) {
    // Keep the most specific wording: "Dimensity 7100" is subsumed by "MediaTek Dimensity 7100".
    const distinct: typeof all = [];
    for (const member of members) {
      if (distinct.some((kept) => norm(kept.value) === norm(member.value))) continue;
      const covering = distinct.findIndex((kept) => wordSuffix(member.value, kept.value));
      if (covering >= 0) distinct[covering] = member;
      else if (!distinct.some((kept) => wordSuffix(kept.value, member.value))) distinct.push(member);
    }
    const { section, name } = members[0];
    if (distinct.length === 1) {
      const only = distinct[0];
      const metaOnly = members.every((member) => member.sourceType === "Shopify Metafield");
      specs.push({ section, name, value: only.value, confidence: only.review || metaOnly ? "Review" : "High", sourceType: only.sourceType, evidence: only.evidence });
      continue;
    }
    const units = new Set(distinct.map((member) => member.unit));
    if (units.size === 1 && distinct.every((member) => member.sourceType === "Shopify Body HTML")) {
      specs.push({ section, name, value: distinct.map((member) => member.value).join(" / "), confidence: "Review", sourceType: "Shopify Body HTML", evidence: distinct[0].evidence });
      continue;
    }
    conflicts.push({ section, name, alternatives: distinct.map((member) => ({ value: member.value, evidence: member.evidence, sourceType: member.sourceType })) });
  }
  const order = (section: SpecSection) => SPEC_SECTIONS.indexOf(section);
  specs.sort((a, b) => order(a.section) - order(b.section) || a.name.localeCompare(b.name));
  conflicts.sort((a, b) => order(a.section) - order(b.section) || a.name.localeCompare(b.name));
  return { specs, conflicts, text };
}

// ---------------- Shopify description source ----------------

export type ShopifyDescription = { handle: string; title: string; bodyHtml: string; metafields: Record<string, string> };

/** Per-Handle Body (HTML) + the first non-empty value of each product metafield column. `csvRows` is the shared CSV reader. */
export function parseShopifyDescriptions(rows: string[][]): Map<string, ShopifyDescription> {
  const out = new Map<string, ShopifyDescription>();
  if (rows.length === 0) return out;
  const header = rows[0].map((cell) => cell.replace(/^\ufeff/, "").trim());
  const column = (name: string) => header.indexOf(name);
  const handleIndex = column("Handle");
  const titleIndex = column("Title");
  const bodyIndex = column("Body (HTML)");
  const metaColumns = header.map((label, index) => ({ index, label: label.replace(/\s*\(product\.metafields\..*\)\s*$/, "") })).filter((entry, index) => /\(product\.metafields\./.test(header[index]));
  if (handleIndex < 0) return out;
  for (const row of rows.slice(1)) {
    const handle = (row[handleIndex] ?? "").trim();
    if (!handle) continue;
    const entry = out.get(handle) ?? { handle, title: "", bodyHtml: "", metafields: {} };
    if (!entry.title && titleIndex >= 0) entry.title = (row[titleIndex] ?? "").trim();
    if (!entry.bodyHtml && bodyIndex >= 0) entry.bodyHtml = row[bodyIndex] ?? "";
    for (const { index, label } of metaColumns) if (!entry.metafields[label] && (row[index] ?? "").trim()) entry.metafields[label] = (row[index] ?? "").trim();
    out.set(handle, entry);
  }
  return out;
}
