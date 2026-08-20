// TEST/DEVELOPMENT DATA ONLY — never treat these records as real iSolutions catalog or inventory.
export const adminDevelopmentProducts = [
  {
    id: "dev-01",
    title: "Development Flagship Phone",
    brand: "Test Brand",
    variants: 3,
    inventory: 7,
    status: "draft",
  },
  {
    id: "dev-02",
    title: "Development Studio Laptop",
    brand: "Test Brand",
    variants: 2,
    inventory: 2,
    status: "published",
  },
  {
    id: "dev-03",
    title: "Development ANC Headphones",
    brand: "Test Audio",
    variants: 1,
    inventory: 0,
    status: "draft",
  },
] as const;
export const adminDevelopmentVariants = [
  {
    sku: "DEV-PHONE-256-BL",
    ram: "12 GB",
    storage: "256 GB",
    finish: "Blush",
    priceMinor: 28_999_900,
    pta: "Approved",
    inventory: 4,
  },
  {
    sku: "DEV-PHONE-256-SV",
    ram: "12 GB",
    storage: "256 GB",
    finish: "Silver",
    priceMinor: 28_999_900,
    pta: "Approved",
    inventory: 3,
  },
  {
    sku: "DEV-PHONE-512-BL",
    ram: "12 GB",
    storage: "512 GB",
    finish: "Blush",
    priceMinor: 32_999_900,
    pta: "Approved",
    inventory: 0,
  },
] as const;
export const formatPkrMinor = (minor: number | bigint) => {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const rupees = value / 100n;
  const paisa = value % 100n;
  return `PKR ${new Intl.NumberFormat("en-PK").format(rupees)}${paisa ? `.${paisa.toString().padStart(2, "0")}` : ""}`;
};
