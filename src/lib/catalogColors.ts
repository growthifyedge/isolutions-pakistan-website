// Centralised colour normalizer for rough wholesale stock lists. Deterministic only:
// obvious abbreviations and known colour words get canonical casing; anything else is
// kept exactly as written (title-cased) and reported as unknown so it can be reviewed.
// Never autocorrects arbitrary words.

// Unambiguous supplier abbreviations and known typos.
const COLOR_ALIASES: Record<string, string> = {
  blk: "Black",
  wht: "White",
  slv: "Silver",
  gry: "Grey",
  gray: "Grey",
  grn: "Green",
  blu: "Blue",
  prp: "Purple",
  pnk: "Pink",
  org: "Orange",
  brn: "Brown",
  gld: "Gold",
  nv: "Navy",
  nvy: "Navy",
  lav: "Lavender",
  forst: "Forest",
};

// Colour words (and common marketing colour words) accepted as written.
const KNOWN_COLOR_WORDS = new Set([
  "black", "white", "silver", "grey", "green", "blue", "purple", "pink", "orange", "brown",
  "gold", "navy", "lavender", "graphite", "cream", "mint", "yellow", "red", "cyan", "titanium",
  "charcoal", "platinum", "lilac", "peach", "volt", "envy", "forest", "obsidian", "natural",
  "midnight", "starlight", "indigo", "violet", "teal", "aqua", "coral", "rose", "beige",
  "bronze", "copper", "champagne", "emerald", "jade", "sapphire", "onyx", "olive", "lime",
  "maroon", "burgundy", "sage", "sand", "stone", "ivory", "pearl", "ocean", "sky", "ice",
  "icy", "frost", "glacier", "aurora", "sunset", "desert", "space", "deep", "light", "dark",
  "jet", "mist", "cosmic", "awesome", "starry", "shadow", "marble", "sea",
]);

export type NormalizedColor = { color: string; known: boolean };

const titleWord = (word: string) => word[0].toUpperCase() + word.slice(1).toLowerCase();

/** "wht" -> White, "slv" -> Silver, "forst" -> Forest, "light blue" -> Light Blue; unknown words kept and flagged. */
export function normalizeColor(value: string): NormalizedColor {
  let known = true;
  const color = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const key = word.toLowerCase();
      const alias = COLOR_ALIASES[key];
      if (alias) return alias;
      if (!KNOWN_COLOR_WORDS.has(key)) known = false;
      return titleWord(word);
    })
    .join(" ");
  return { color, known };
}
