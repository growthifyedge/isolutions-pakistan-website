// Read-only compatibility for supplier/master .xlsx files that ExcelJS cannot open as written.
//
// Some spreadsheet generators write valid Office Open XML in a form ExcelJS does not read:
// namespace-prefixed elements (<x:workbook xmlns:x="...">), a byte-order mark before the XML
// declaration, absolute relationship targets (Target="/xl/styles.xml") and legacy VML comment
// drawings with non-standard part names. This rewrites those parts, in memory only, into the
// equivalent default form so ExcelJS can read the cell data. It is used only to READ master
// workbooks; workbooks for upload are always written by buildCatalogWorkbook.

/**
 * Namespaces ExcelJS reads only as the default namespace. Others keep their prefixes
 * (ExcelJS expects e.g. <cp:coreProperties> in docProps/core.xml).
 */
const DEFAULT_FORM_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://schemas.openxmlformats.org/package/2006/content-types",
]);

/** Rewrites one XML part: drops a BOM and turns a prefixed spreadsheet root into the default namespace. */
export function normalizeXmlPart(xml: string) {
  let result = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const root = result.match(/^(?:<\?xml[^>]*\?>\s*)?<([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\b([^>]*)>/);
  if (root) {
    const prefix = root[1];
    const declaration = root[2].match(new RegExp(`\\bxmlns:${prefix}="([^"]+)"`));
    // Only when the root has no default namespace of its own, so no two namespaces collide.
    if (declaration && DEFAULT_FORM_NAMESPACES.has(declaration[1]) && !/\sxmlns="/.test(root[2])) {
      result = result
        .replaceAll(`<${prefix}:`, "<")
        .replaceAll(`</${prefix}:`, "</")
        .replace(`xmlns:${prefix}="${declaration[1]}"`, `xmlns="${declaration[1]}"`);
    }
  }
  return result;
}

/** Path of `target` relative to the folder `fromDir` ("xl/worksheets/", "xl/comments1.xml" -> "../comments1.xml"). */
function relativePath(fromDir: string, target: string) {
  const from = fromDir.split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  while (from.length && to.length > 1 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}

/** Rewrites a .rels part: relative internal targets; comment and VML drawing links dropped. */
export function normalizeRelationshipsPart(xml: string, partName: string) {
  const sourceDir = partName.replace(/_rels\/[^/]*$/, "");
  return normalizeXmlPart(xml)
    .replace(/<Relationship\b[^>]*\bType="[^"]*\/(?:comments|vmlDrawing)"[^>]*\/>/g, "")
    .replace(/<Relationship\b[^>]*>/g, (tag) =>
      /\bTargetMode="External"/.test(tag)
        ? tag
        : tag.replace(/\bTarget="\/([^"]*)"/, (_, target: string) => `Target="${relativePath(sourceDir, target)}"`),
    );
}

/**
 * Returns a normalized copy of an .xlsx package for reading. Cell notes (comments) are not
 * carried over; everything else is unchanged. The original bytes are never modified.
 */
export async function normalizeXlsxForReading(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir || !/\.(?:xml|rels)$/i.test(name)) continue;
    const original = await entry.async("string");
    let xml = name.endsWith(".rels") ? normalizeRelationshipsPart(original, name) : normalizeXmlPart(original);
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) xml = xml.replace(/<legacyDrawing\b[^>]*\/>/g, "");
    if (xml !== original) zip.file(name, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}
