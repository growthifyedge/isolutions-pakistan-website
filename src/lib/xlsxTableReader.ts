/**
 * Minimal, read-only .xlsx table reader used when ExcelJS cannot open a workbook.
 *
 * Some tools (the Microsoft Open XML SDK, which ChatGPT uses to write Excel files) save valid workbooks whose XML uses
 * a namespace prefix (<x:workbook>, <x:row>, <x:c>) and absolute part paths (/xl/workbook.xml). Excel opens them, but
 * ExcelJS cannot. This reader returns each sheet's cell TEXT only (shared strings, inline strings, plain values); it
 * never evaluates formulas, follows links or runs anything. No dependency: the ZIP is read by hand and inflated with the
 * platform's DecompressionStream ("deflate-raw"), available in current browsers and Node.
 */
export type SheetTable = { name: string; rows: string[][] };

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: signature 0x06054b50, searched backwards (a comment may follow it).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("broken zip directory");
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, method, compressedSize, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function entryText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) throw new Error("workbook part too large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error("broken zip entry");
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("unsupported zip compression");
  // An exact copy of the entry's bytes (a Node Buffer's slice would still point at the whole file).
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  if (inflated.byteLength > MAX_ENTRY_BYTES) throw new Error("workbook part too large");
  return new TextDecoder().decode(inflated);
}

const decode = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const attribute = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`\\s(?:[\\w-]+:)?${name}="([^"]*)"`));
  return match ? decode(match[1]) : null;
};
/** All text runs of an element (<t> / <x:t>), joined — rich text and phonetic runs (<rPh>) excluded. */
const runs = (xml: string) =>
  [...xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "").matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) => decode(match[1])).join("");
const columnIndex = (reference: string) => {
  const letters = reference.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
};
const partPath = (target: string) => (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);

export async function readXlsxTables(input: ArrayBuffer | Uint8Array): Promise<SheetTable[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((entry) => [entry.name.replace(/^\//, ""), entry]));
  const read = async (path: string) => {
    const entry = byName.get(path);
    return entry ? entryText(bytes, entry) : null;
  };
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("not an Excel workbook");
  const targets = new Map(
    [...rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((match) => [attribute(match[0], "Id"), attribute(match[0], "Target")] as const),
  );
  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) => runs(match[1])) : [];
  const sheets: SheetTable[] = [];
  for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)) {
    const name = attribute(match[0], "name") ?? "";
    const target = targets.get(attribute(match[0], "id"));
    const xml = target ? await read(partPath(target)) : null;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const rowNumber = Number(attribute(`<r ${rowMatch[1]}>`, "r")) || rows.length + 1;
      const cells: string[] = [];
      for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const tag = `<c ${cellMatch[1]}>`;
        const reference = attribute(tag, "r");
        const column = reference ? columnIndex(reference) : cells.length;
        const body = cellMatch[2] ?? "";
        const type = attribute(tag, "t");
        const raw = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "inlineStr") value = runs(body);
        else if (raw !== undefined) value = decode(raw);
        if (column >= 0 && column < 200) {
          while (cells.length < column) cells.push("");
          cells[column] = value;
        }
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows[rowNumber - 1] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
