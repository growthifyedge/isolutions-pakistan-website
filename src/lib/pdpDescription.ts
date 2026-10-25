/**
 * PDP "Product Information" text for Gadgets: the Owner's description (products.content) shown as clean paragraphs.
 * Display only — the stored text is never changed. A blank line starts a new paragraph, a single line break stays a line
 * break, and runs of spaces/tabs inside a line show as one space. The result is plain text: React renders it, never HTML.
 */
import type { CatalogProduct } from "./catalog.ts";

export const isGadgetProduct = (product: Pick<CatalogProduct, "category">) => product.category?.slug === "gadgets";

/** Paragraphs, each a list of lines. Empty when the text is blank. */
export function descriptionParagraphs(text: string | null | undefined): string[][] {
  const plain = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!plain) return [];
  return plain
    .split(/\n[ \t]*\n\s*/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);
}
