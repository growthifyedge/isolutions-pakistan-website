import { ChangeEvent, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  FileUp,
  Play,
  Upload,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  BulkProduct,
  BulkVariant,
  BatchDefaults,
  applyBatchDefaults,
  bulkInventoryPreview,
  matchingActiveRealCategoryTaxonomy,
  matchingActiveRealTaxonomy,
  requiresExplicitPricedVariant,
  normalizedPriceDisplay,
  normalizeRawCatalog,
  parseBulkCatalog,
  unresolvedVariantFacts,
} from "../lib/bulkCatalog";
import {
  CATALOG_SKU_PREFIX_BY_CATEGORY_SLUG,
  ANDROID_MOBILE_WARRANTY,
  STAGING_PROFILES,
  applyStagingProfile,
  catalogSkuPending,
  normalizeStockLines,
  type CatalogSkuPrefix,
  type StagingProfileId,
} from "../lib/catalogSheet";
import {
  canApplyCatalogImport,
  catalogImportConfirmation,
  catalogImportCounts,
  resolveImportWarranty,
  matchImportVariant,
  type CatalogImportResult,
  type ExistingVariantFacts,
} from "../lib/catalogImport";
import {
  buildCatalogWorkbook,
  catalogStagingMissingFacts,
  catalogSheetToBulkParseResult,
  readCatalogWorkbook,
  validateCatalogSheet,
  type CatalogReference,
} from "../lib/catalogWorkbook";
import { simConfigurationLabel } from "../lib/variantFacts";

type Taxonomy = {
  id: string;
  name: string;
  slug: string;
  data_class: "real" | "development";
  is_active: boolean;
};
type ExistingProduct = {
  id: string;
  title: string;
  slug: string;
  brand_id: string | null;
  category_id: string;
  publication_status: "draft" | "published" | "archived";
  default_pta_status: BulkVariant["ptaStatus"];
  default_delivery_scope: BulkVariant["deliveryScope"];
  default_condition: BulkVariant["condition"];
  default_warranty: string | null;
  product_variants: Array<ExistingVariantFacts & {
    id: string;
    sku: string;
    ram_display: string | null;
    storage_display: string | null;
    color_finish: string | null;
    price_minor: number;
    compare_at_price_minor: number | null;
    pta_status: BulkVariant["ptaStatus"];
    condition: BulkVariant["condition"];
    warranty_override: string | null;
    delivery_scope: BulkVariant["deliveryScope"];
  }>;
};

type PreviewVariant = BulkVariant & {
  action: string;
  id: string | null;
  /** Existing variant SKU (kept as-is), or "" for a new variant: assigned on import. */
  skuResolved: string;
  /** Prefix the database will use for a new variant's SKU; null if the category has none. */
  skuPrefix: CatalogSkuPrefix | null;
  inventoryLabel: string;
};
type PreviewProduct = Omit<BulkProduct, "variants"> & {
  action: string;
  id: string | null;
  slugResolved: string;
  brandId: string | null;
  categoryId: string | null;
  variants: PreviewVariant[];
  blocked: string[];
  taxonomyNotes: string[];
  brandAction: "REUSE BRAND" | "CREATE BRAND" | "NO BRAND" | "NEEDS REVIEW";
  categoryAction: "REUSE CATEGORY" | "CREATE CATEGORY" | "NEEDS REVIEW";
  /** v2 Replace Existing: active variants missing from the file (they will be hidden). */
  hiddenVariants: Array<{ sku: string; label: string }>;
};

const normalized = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? "";
const slugify = (value: string) =>
  normalized(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function matchesVariant(
  existing: ExistingProduct["product_variants"][number],
  variant: BulkVariant,
) {
  return (
    normalized(existing.ram_display) === normalized(variant.ram) &&
    normalized(existing.storage_display) === normalized(variant.storage) &&
    normalized(existing.color_finish) === normalized(variant.color) &&
    (variant.ptaSource !== "Owner supplied explicitly" ||
      variant.ptaStatus === "unknown" ||
      existing.pta_status === variant.ptaStatus) &&
    (variant.conditionSource !== "Owner supplied explicitly" ||
      variant.condition === "unknown" ||
      existing.condition === variant.condition)
  );
}

function downloadWorkbook(bytes: Uint8Array<ArrayBuffer>, filename: string) {
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BulkImport() {
  const [source, setSource] = useState("");
  const [rawSource, setRawSource] = useState("");
  const [stockSource, setStockSource] = useState("");
  const [stagingProfile, setStagingProfile] = useState<StagingProfileId>("none");
  const [preview, setPreview] = useState<PreviewProduct[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [format, setFormat] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [importResult, setImportResult] = useState<CatalogImportResult | null>(null);
  const [message, setMessage] = useState("");
  const [batchDefaults, setBatchDefaults] = useState<BatchDefaults>({
    brand: null,
    category: null,
    condition: null,
    deliveryScope: null,
    warranty: null,
    ptaStatus: null,
    inventory: null,
  });

  const parseAndPreview = async (
    parsedInput?: ReturnType<typeof parseBulkCatalog>,
  ) => {
    if (!parsedInput && !source.trim()) {
      setMessage(
        "Paste rough catalog text or upload a CSV file before parsing.",
      );
      return;
    }
    if (!supabase) {
      setMessage(
        "Preview unavailable: Supabase environment is not configured.",
      );
      return;
    }
    setWorking(true);
    setResult(null);
    setImportResult(null);
    setMessage("");
    setPreview([]);
    try {
      const parsed = parsedInput ?? parseBulkCatalog(source);
      if (parsed.format !== "catalog_sheet")
        parsed.products = applyBatchDefaults(parsed.products, batchDefaults);
      setFormat(parsed.format);
      setParseErrors(parsed.errors);
      if (!parsed.products.length) {
        throw new Error(
          parsed.errors[0] ??
            "No products could be parsed from the source data.",
        );
      }
      const [brandResult, categoryResult, productResult] = await Promise.all([
        supabase.from("brands").select("id,name,slug,data_class,is_active"),
        supabase.from("categories").select("id,name,slug,data_class,is_active"),
        supabase
          .from("products")
          .select(
            // product_variants(*) includes is_active and, once 202609240005 is applied,
            // the used-phone facts that take part in v2 matching.
            "id,title,slug,brand_id,category_id,publication_status,default_pta_status,default_condition,default_warranty,default_delivery_scope,product_variants(*)",
          ),
      ]);
      const queryError =
        brandResult.error ?? categoryResult.error ?? productResult.error;
      if (queryError) throw queryError;
      const brands = (brandResult.data ?? []) as Taxonomy[];
      const categories = (categoryResult.data ?? []) as Taxonomy[];
      const products = (productResult.data ?? []) as ExistingProduct[];
      const catalogSheet = parsed.format === "catalog_sheet";
      const rows = parsed.products.map((product): PreviewProduct => {
        const blocked = [...product.warnings];
        const realBrands = product.brandExplicit
          ? matchingActiveRealTaxonomy(brands, product.brand)
          : [];
        const developmentBrand = product.brandExplicit && brands.some(
          (item) =>
            item.data_class === "development" &&
            normalized(item.name) === normalized(product.brand),
        );
        if (realBrands.length > 1) blocked.push("Ambiguous real brand match");
        const brandAction =
          realBrands.length === 1
            ? "REUSE BRAND"
            : product.brandExplicit && realBrands.length === 0
              ? "CREATE BRAND"
              : "NO BRAND";
        const brandId = realBrands.length === 1 ? realBrands[0].id : null;
        let realCategories = product.category
          ? matchingActiveRealCategoryTaxonomy(categories, product.category)
          : [];
        const developmentCategory = product.category
          ? categories.some(
              (item) =>
                item.data_class === "development" &&
                normalized(item.name) === normalized(product.category),
            )
          : false;
        const requestedSlug = product.slug ?? slugify(product.title);
        // v2 product identity is Brand + Product Title, exactly as the import function checks.
        const candidates = product.slug && !catalogSheet
          ? products.filter((item) => item.slug === product.slug)
          : products.filter(
              (item) =>
                normalized(item.title) === normalized(product.title) &&
                item.brand_id === brandId,
            );
        if (candidates.length > 1) blocked.push("Ambiguous product match");
        const existing = candidates.length === 1 ? candidates[0] : null;
        if (product.requestedAction === "Create" && existing)
          blocked.push("Action is Create but this product already exists");
        if (product.requestedAction === "Replace Existing" && !existing && candidates.length === 0)
          blocked.push("Action is Replace Existing but no matching product exists");
        const existingCategory = existing
          ? categories.find((item) => item.id === existing.category_id) ?? null
          : null;
        if (
          realCategories.length === 0 &&
          existingCategory &&
          product.category &&
          (normalized(existingCategory.name) === normalized(product.category) ||
            existingCategory.slug === slugify(product.category))
        )
          realCategories = [existingCategory];
        if (realCategories.length > 1)
          blocked.push("Ambiguous real category match");
        if (
          product.category &&
          realCategories.length === 0 &&
          !product.categoryExplicit
        )
          blocked.push("Needs Owner Review: explicit Category required");
        const categoryAction =
          realCategories.length === 1
            ? "REUSE CATEGORY"
            : product.categoryExplicit && realCategories.length === 0
              ? "CREATE CATEGORY"
              : "NEEDS REVIEW";
        const categoryId =
          realCategories.length === 1 ? realCategories[0].id : null;
        // The SKU prefix comes from the product's category, exactly as the database
        // derives it when it assigns the SKU (MB/AC/GD/MC/IP).
        const effectiveCategoryId =
          categoryId ?? (existing && !product.category ? existing.category_id : null);
        const effectiveCategorySlug = categories.find(
          (item) => item.id === effectiveCategoryId,
        )?.slug;
        const skuPrefix: CatalogSkuPrefix | null =
          (effectiveCategorySlug &&
            CATALOG_SKU_PREFIX_BY_CATEGORY_SLUG[effectiveCategorySlug]) ||
          null;
        if (requiresExplicitPricedVariant(Boolean(existing), product.variants))
          blocked.push("No explicit priced variant parsed");
        if (!existing && !product.category)
          blocked.push("Category required for new product");
        if (catalogSheet) {
          // v2 never creates brands or categories and never changes a product's category.
          if (!product.productType) blocked.push("Product Type is required");
          if (product.brandExplicit && brandAction !== "REUSE BRAND")
            blocked.push("Brand must be an existing active brand");
          if (categoryAction !== "REUSE CATEGORY")
            blocked.push("Category must be an existing active category");
          if (existing && categoryId && existing.category_id !== categoryId)
            blocked.push("Category differs from the existing product; import does not change categories");
        }
        const taxonomyNotes: string[] = [];
        if (developmentBrand)
          taxonomyNotes.push(
            "Development brand collision shown; a separate real brand will be created",
          );
        if (developmentCategory)
          taxonomyNotes.push(
            "Development category collision shown; a separate real category will be created",
          );
        const preserveExistingConditionDefault = Boolean(
          existing &&
          product.defaultConditionSource === "unresolved" &&
          existing.default_condition !== "unknown",
        );
        const preserveExistingDeliveryDefault = Boolean(
          existing &&
          product.defaultDeliverySource === "unresolved" &&
          existing.default_delivery_scope !== null,
        );
        const preserveExistingWarrantyDefault = Boolean(
          existing &&
          product.defaultWarrantySource === "unresolved" &&
          existing.default_warranty,
        );
        const preserveExistingPtaDefault = Boolean(
          existing &&
          product.defaultPtaSource === "unresolved" &&
          existing.default_pta_status !== "unknown",
        );
        const effectiveDefaults = {
          condition: preserveExistingConditionDefault
            ? existing!.default_condition
            : product.defaultCondition,
          conditionSource: preserveExistingConditionDefault
            ? ("Owner supplied explicitly" as const)
            : product.defaultConditionSource,
          delivery: preserveExistingDeliveryDefault
            ? existing!.default_delivery_scope
            : product.defaultDeliveryScope,
          deliverySource: preserveExistingDeliveryDefault
            ? ("Owner supplied explicitly" as const)
            : product.defaultDeliverySource,
          warranty: preserveExistingWarrantyDefault
            ? existing!.default_warranty
            : product.defaultWarranty,
          warrantySource: preserveExistingWarrantyDefault
            ? ("Owner supplied explicitly" as const)
            : product.defaultWarrantySource,
          pta: preserveExistingPtaDefault
            ? existing!.default_pta_status
            : product.defaultPtaStatus,
          ptaSource: preserveExistingPtaDefault
            ? ("Owner supplied explicitly" as const)
            : product.defaultPtaSource,
        };
        const variants = product.variants.map(
          (parsedVariant): PreviewVariant => {
            // A blank or auto-filled Android "1 Year" warranty inherits an existing product default.
            const inheritedWarranty = resolveImportWarranty(
              { warranty: parsedVariant.warranty, source: parsedVariant.warrantySource },
              { productDefault: preserveExistingWarrantyDefault ? existing!.default_warranty : null },
            );
            const variant = {
              ...parsedVariant,
              condition:
                parsedVariant.conditionSource === "unresolved" &&
                preserveExistingConditionDefault
                  ? effectiveDefaults.condition!
                  : parsedVariant.condition,
              conditionSource:
                parsedVariant.conditionSource === "unresolved" &&
                preserveExistingConditionDefault
                  ? ("inherited from product" as const)
                  : parsedVariant.conditionSource,
              deliveryScope:
                parsedVariant.deliverySource === "unresolved" &&
                preserveExistingDeliveryDefault
                  ? effectiveDefaults.delivery
                  : parsedVariant.deliveryScope,
              deliverySource:
                parsedVariant.deliverySource === "unresolved" &&
                preserveExistingDeliveryDefault
                  ? ("inherited from product" as const)
                  : parsedVariant.deliverySource,
              warranty: inheritedWarranty.warranty,
              warrantySource: inheritedWarranty.source,
              ptaStatus:
                parsedVariant.ptaSource === "unresolved" &&
                preserveExistingPtaDefault
                  ? effectiveDefaults.pta!
                  : parsedVariant.ptaStatus,
              ptaSource:
                parsedVariant.ptaSource === "unresolved" &&
                preserveExistingPtaDefault
                  ? ("inherited from product" as const)
                  : parsedVariant.ptaSource,
            };
            // SKUs are identifiers only: variants match on product identity +
            // variant attributes, never on SKU. v2 uses the import function's rules
            // (including grade / battery health / cycle count, hidden variants too).
            const catalogMatch = catalogSheet
              ? matchImportVariant(existing?.product_variants ?? [], {
                  ram: parsedVariant.ram,
                  storage: parsedVariant.storage,
                  color: parsedVariant.color,
                  ptaStatus: parsedVariant.ptaStatus,
                  condition: parsedVariant.condition,
                  conditionGrade: parsedVariant.conditionGrade,
                  batteryHealth: parsedVariant.batteryHealth,
                  cycleCount: parsedVariant.cycleCount,
                })
              : null;
            const matches = catalogMatch
              ? catalogMatch.match
                ? [catalogMatch.match]
                : []
              : existing?.product_variants.filter((item) =>
                  matchesVariant(item, variant),
                ) ?? [];
            const variantBlocked = [...variant.warnings];
            if (matches.length > 1 || catalogMatch?.ambiguous)
              variantBlocked.push(
                catalogSheet
                  ? `${variant.source}: Matches more than one existing variant; add PTA, Condition, Battery Health or Cycle Count to tell them apart`
                  : "Ambiguous variant match",
              );
            const match = matches.length === 1 ? matches[0] : null;
            const inventoryIntent = bulkInventoryPreview(
              variant.inventory,
              Boolean(match),
            );
            const preserveExistingPta = Boolean(
              match &&
              variant.ptaSource !== "Owner supplied explicitly" &&
              match.pta_status !== "unknown",
            );
            const preserveExistingCondition = Boolean(
              match &&
              variant.conditionSource !== "Owner supplied explicitly" &&
              match.condition !== "unknown",
            );
            const preserveExistingDelivery = Boolean(
              match &&
              variant.deliverySource !== "Owner supplied explicitly" &&
              match.delivery_scope,
            );
            const effectivePtaStatus = preserveExistingPta
              ? match!.pta_status
              : variant.ptaStatus;
            const effectivePtaSource = preserveExistingPta
              ? "Owner supplied explicitly"
              : variant.ptaSource;
            const effectiveCondition = preserveExistingCondition
              ? match!.condition
              : variant.condition;
            const effectiveConditionSource = preserveExistingCondition
              ? "Owner supplied explicitly"
              : variant.conditionSource;
            // Only an Owner-supplied warranty replaces a matched variant's stored warranty.
            const { warranty: effectiveWarranty, source: effectiveWarrantySource } =
              resolveImportWarranty(
                { warranty: variant.warranty, source: variant.warrantySource },
                { variantOverride: match?.warranty_override },
              );
            const effectiveDelivery = preserveExistingDelivery
              ? match!.delivery_scope
              : variant.deliveryScope;
            const effectiveDeliverySource = preserveExistingDelivery
              ? "Owner supplied explicitly"
              : variant.deliverySource;
            // A matched existing variant keeps its SKU; a new variant is sent with a
            // blank SKU and the database assigns the next one for its prefix.
            const suppliedSku = variant.sku?.trim().toUpperCase() ?? "";
            const skuResolved = match?.sku ?? "";
            if (match) {
              if (suppliedSku && suppliedSku !== match.sku.toUpperCase())
                variantBlocked.push(
                  `${variant.source}: SKU ${suppliedSku} differs from the existing variant SKU ${match.sku}; existing SKUs are kept`,
                );
            } else {
              if (suppliedSku)
                variantBlocked.push(
                  `${variant.source}: SKU is assigned automatically; leave SKU blank for a new variant (got ${suppliedSku})`,
                );
              if (!skuPrefix)
                variantBlocked.push(
                  `${variant.source}: No SKU prefix for this category; use Mobile Phones, Accessories, Gadgets, Laptops or Tablets`,
                );
            }
            // v2 staging only blocks on genuinely required values; blank Warranty,
            // PTA, Condition, BH and Cycle Count are allowed while staging.
            const missingFacts =
              catalogSheet
                ? catalogStagingMissingFacts(variant)
                : unresolvedVariantFacts(variant, {
                    existingVariant: Boolean(match),
                  });
            variantBlocked.push(
              ...missingFacts.map(
                (fact) => `${variant.source}: Missing ${fact}`,
              ),
            );
            const unchanged = Boolean(
              match &&
              variant.inventory === null &&
              normalized(match.ram_display) === normalized(variant.ram) &&
              normalized(match.storage_display) === normalized(variant.storage) &&
              normalized(match.color_finish) === normalized(variant.color) &&
              match.price_minor === variant.priceMinor &&
              (variant.compareAtPriceMinor === null ||
                match.compare_at_price_minor === variant.compareAtPriceMinor) &&
              (effectivePtaSource === "unresolved" ||
                match.pta_status === effectivePtaStatus) &&
              (effectiveConditionSource === "unresolved" ||
                match.condition === effectiveCondition) &&
              (effectiveWarrantySource === "unresolved" ||
                match.warranty_override === effectiveWarranty) &&
              (effectiveDeliverySource === "unresolved" ||
                match.delivery_scope === effectiveDelivery),
            );
            return {
              ...variant,
              ptaStatus: effectivePtaStatus,
              ptaSource: effectivePtaSource,
              condition: effectiveCondition,
              conditionSource: effectiveConditionSource,
              warranty: effectiveWarranty,
              warrantySource: effectiveWarrantySource,
              deliveryScope: effectiveDelivery,
              deliverySource: effectiveDeliverySource,
              warnings: [...new Set(variantBlocked)],
              id: match?.id ?? null,
              skuResolved,
              skuPrefix,
              // v2 always sets the final stock to the Excel value (10 when blank).
              inventoryLabel: catalogSheet
                ? `Stock → ${variant.inventory ?? 10}`
                : inventoryIntent.label,
              action: variantBlocked.length
                ? "NEEDS REVIEW"
                : catalogSheet
                  ? match
                    ? match.is_active === false
                      ? "REACTIVATE VARIANT"
                      : "UPDATE VARIANT"
                    : "CREATE VARIANT"
                  : unchanged
                    ? "UNCHANGED"
                    : match
                      ? "UPDATE VARIANT"
                      : "CREATE VARIANT",
            };
          },
        );
        const seenSkus = new Set<string>();
        const seenCombinations = new Set<string>();
        for (const variant of variants) {
          const combination = [
            variant.ram,
            variant.storage,
            variant.color,
            variant.ptaStatus,
            variant.condition,
            variant.batteryHealth?.toString(),
            variant.cycleCount?.toString(),
          ]
            .map((value) => normalized(value))
            .join("|");
          if (variant.skuResolved && seenSkus.has(variant.skuResolved))
            variant.warnings.push(`${variant.source}: Duplicate SKU in batch`);
          if (seenCombinations.has(combination))
            variant.warnings.push(
              `${variant.source}: Duplicate structured variant in batch`,
            );
          seenSkus.add(variant.skuResolved);
          seenCombinations.add(combination);
          if (variant.warnings.length) variant.action = "NEEDS REVIEW";
        }
        if (variants.some((variant) => variant.warnings.length))
          blocked.push("One or more variants require review");
        // Replace Existing: active variants the file no longer lists will be hidden (never deleted).
        const matchedIds = new Set(variants.map((variant) => variant.id).filter(Boolean));
        const hiddenVariants =
          catalogSheet && existing
            ? existing.product_variants
                .filter((item) => item.is_active !== false && !matchedIds.has(item.id))
                .map((item) => ({
                  sku: item.sku,
                  label: [item.ram_display, item.storage_display, item.color_finish]
                    .filter(Boolean)
                    .join(" / ") || "Default",
                }))
            : [];
        return {
          hiddenVariants,
          ...product,
          defaultCondition: effectiveDefaults.condition,
          defaultConditionSource: effectiveDefaults.conditionSource,
          defaultDeliveryScope: effectiveDefaults.delivery,
          defaultDeliverySource: effectiveDefaults.deliverySource,
          defaultWarranty: effectiveDefaults.warranty,
          defaultWarrantySource: effectiveDefaults.warrantySource,
          defaultPtaStatus: effectiveDefaults.pta,
          defaultPtaSource: effectiveDefaults.ptaSource,
          seoTitle: product.seoTitle ?? (existing ? null : product.title),
          seoDescription:
            product.seoDescription ??
            (existing ? null : product.shortDescription),
          id: existing?.id ?? null,
          brandId: brandId ?? (existing ? existing.brand_id : null),
          categoryId: effectiveCategoryId,
          slugResolved: existing?.slug ?? requestedSlug,
          variants,
          blocked,
          taxonomyNotes,
          brandAction:
            !product.brandExplicit && existing?.brand_id
              ? "REUSE BRAND"
              : brandAction,
          categoryAction,
          action:
            catalogSheet
              ? blocked.length
                ? "NEEDS REVIEW"
                : existing
                  ? "REPLACE EXISTING"
                  : "CREATE"
              : blocked.length
                ? "BLOCKED"
                : existing
                  ? "UPDATE PRODUCT"
                  : "CREATE PRODUCT",
        };
      });
      setPreview(rows);
      setMessage(
        `Preview ready: ${rows.length} product${rows.length === 1 ? "" : "s"} parsed. No database writes performed.`,
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "Unknown parsing or preview error.";
      setMessage(`Parse and preview failed: ${detail}`);
    } finally {
      setWorking(false);
    }
  };

  const loadCatalogReference = async (): Promise<CatalogReference> => {
    if (!supabase) throw new Error("Supabase environment is not configured.");
    const client = supabase;
    // All variants, active or not: new SKUs must be unique across the whole catalog.
    // Paged, because a single request returns at most 1000 rows.
    const loadExistingSkus = async () => {
      const pageSize = 1000;
      const skus: CatalogReference["existingSkus"] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from("product_variants")
          .select("sku,products(slug)")
          .order("id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as Array<{
          sku: string;
          products: { slug: string } | { slug: string }[] | null;
        }>;
        for (const item of page) {
          const product = Array.isArray(item.products) ? item.products[0] : item.products;
          skus.push({ sku: item.sku, productSlug: product?.slug ?? "" });
        }
        if (page.length < pageSize) return skus;
      }
    };
    const [brandResult, categoryResult, existingSkus] = await Promise.all([
      client.from("brands").select("name").eq("data_class", "real").eq("is_active", true),
      client.from("categories").select("name").eq("data_class", "real").eq("is_active", true),
      loadExistingSkus(),
    ]);
    const error = brandResult.error ?? categoryResult.error;
    if (error) throw error;
    return {
      brands: (brandResult.data ?? []).map((item) => item.name as string),
      categories: (categoryResult.data ?? []).map((item) => item.name as string),
      existingSkus,
    };
  };

  const normalizeStock = async () => {
    const reference = await loadCatalogReference();
    const { rows } = normalizeStockLines(stockSource, {
      brands: reference.brands.map((name) => ({ name })),
    });
    return {
      reference,
      ...validateCatalogSheet(applyStagingProfile(rows, stagingProfile), [], reference),
    };
  };

  const runCatalogStep = async (step: () => Promise<void>) => {
    setWorking(true);
    setMessage("");
    try {
      await step();
    } catch (error) {
      setMessage(
        `Excel staging failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
    } finally {
      setWorking(false);
    }
  };

  const normalizeStockAndPreview = () =>
    runCatalogStep(async () => {
      const data = await normalizeStock();
      await parseAndPreview(catalogSheetToBulkParseResult(data));
    });

  const generateExcel = () =>
    runCatalogStep(async () => {
      const { reference, rows, specifications } = await normalizeStock();
      downloadWorkbook(
        await buildCatalogWorkbook(rows, specifications, reference),
        `isolutions-catalog-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      setMessage(
        `Excel generated: ${rows.length} row${rows.length === 1 ? "" : "s"}, ${rows.filter((row) => row.needsReview).length} needing review. No database writes performed.`,
      );
    });

  const downloadTemplate = () =>
    runCatalogStep(async () => {
      downloadWorkbook(
        await buildCatalogWorkbook([], [], await loadCatalogReference()),
        "isolutions-catalog-template.xlsx",
      );
      setMessage("Blank catalog template downloaded.");
    });

  const uploadExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await runCatalogStep(async () => {
      const data = await readCatalogWorkbook(
        await file.arrayBuffer(),
        await loadCatalogReference(),
      );
      if (data.fileErrors.length && !data.rows.length) {
        setPreview([]);
        setParseErrors(data.fileErrors);
        setMessage(`Excel upload blocked: ${data.fileErrors.join(" ")}`);
        return;
      }
      await parseAndPreview(catalogSheetToBulkParseResult(data));
    });
  };

  const normalizeAndPreview = () => {
    if (!rawSource.trim()) {
      setMessage("Paste raw product data before normalizing it.");
      return;
    }
    const normalized = normalizeRawCatalog(rawSource);
    setSource(rawSource);
    void parseAndPreview(normalized);
  };

  // Bulk Upload v2: one atomic call to apply_catalog_bulk_import_v2. The database
  // re-validates everything and assigns SKUs; nothing is published.
  const applyCatalogImport = async () => {
    if (!supabase || !canApplyCatalogImport(format, preview, parseErrors)) return;
    const counts = catalogImportCounts(preview);
    if (!confirm(`Apply this import?\n\n${catalogImportConfirmation(counts)}`)) return;
    setWorking(true);
    setMessage("");
    setResult(null);
    setImportResult(null);
    const supplied = (value: string | null | undefined) =>
      value && value !== "unknown" ? value : null;
    const batch = {
      products: preview.map((product) => ({
        action: product.action === "REPLACE EXISTING" ? "Replace Existing" : "Create",
        source: product.source,
        product_type: product.productType ?? null,
        brand: product.brandExplicit ? product.brand : null,
        title: product.title,
        category: product.category,
        specifications: product.specifications.map((specification) => ({
          group: specification.group,
          label: specification.label,
          value: specification.value,
        })),
        variants: product.variants.map((variant) => ({
          source: variant.source,
          // Existing SKU for a matched variant; blank for a new one (assigned on import).
          sku: variant.skuResolved || null,
          ram: variant.ram,
          storage: variant.storage,
          color: variant.color,
          price_minor: variant.priceMinor,
          compare_at_price_minor: variant.compareAtPriceMinor,
          stock: variant.inventory,
          pta_status: supplied(variant.ptaStatus),
          condition: supplied(variant.condition),
          condition_grade: variant.conditionGrade ?? null,
          battery_health_percent: variant.batteryHealth ?? null,
          battery_cycle_count: variant.cycleCount ?? null,
          sim_configuration: variant.simConfiguration ?? null,
          warranty: variant.warranty,
          delivery_scope: variant.deliveryScope,
        })),
      })),
    };
    const { data, error } = await supabase.rpc("apply_catalog_bulk_import_v2", {
      p_batch: batch,
    });
    if (error) {
      setMessage(`Import failed; nothing was changed. ${error.message}`);
    } else {
      setImportResult(data as CatalogImportResult);
      setPreview([]);
      setFormat("");
      setMessage("Products imported successfully.");
    }
    setWorking(false);
  };

  const apply = async () => {
    if (format === "catalog_sheet") return applyCatalogImport();
    if (
      !supabase ||
      preview.some((product) => product.blocked.length) ||
      parseErrors.length
    )
      return;
    setWorking(true);
    const batch = {
      products: preview.map((product) => ({
        id: product.id,
        title: product.title,
        slug: product.slugResolved,
        brand: product.brand,
        brand_id: product.brandId,
        category: product.category,
        category_id: product.categoryId,
        short_description: product.shortDescription,
        seo_title: product.seoTitle,
        seo_description: product.seoDescription,
        default_pta_status: product.defaultPtaStatus,
        default_pta_source: product.defaultPtaSource,
        default_condition: product.defaultCondition,
        default_condition_source: product.defaultConditionSource,
        default_delivery_scope: product.defaultDeliveryScope,
        default_delivery_source: product.defaultDeliverySource,
        default_warranty: product.defaultWarranty,
        default_warranty_source: product.defaultWarrantySource,
        content: product.notes.length ? product.notes.join("\n") : null,
        specifications: product.specifications,
        variants: product.variants.map((variant) => ({
          source: variant.source,
          id: variant.id,
          action: variant.action,
          // Blank for a new variant: the database assigns its SKU.
          sku: variant.skuResolved,
          ram_display: variant.ram,
          storage_display: variant.storage,
          color_finish: variant.color,
          price_minor: variant.priceMinor,
          compare_at_price_minor: variant.compareAtPriceMinor,
          pta_status: variant.ptaStatus,
          condition: variant.condition,
          warranty_override: variant.warranty,
          delivery_scope: variant.deliveryScope,
          inventory: variant.inventory,
        })),
      })),
    };
    const { data, error } = await supabase.rpc("apply_catalog_bulk_import", {
      p_batch: batch,
    });
    if (error) setMessage(error.message);
    else {
      setResult(data as Record<string, number>);
      setMessage("Approved batch applied atomically.");
    }
    setWorking(false);
  };

  const uploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setSource(await file.text());
  };

  // Excel v2 previews apply through apply_catalog_bulk_import_v2; Apply stays disabled
  // while any product or row needs review.
  const stagingOnly = format === "catalog_sheet";
  const importCounts = stagingOnly ? catalogImportCounts(preview) : null;
  const blocked = stagingOnly
    ? !canApplyCatalogImport(format, preview, parseErrors)
    : parseErrors.length > 0 ||
      preview.some((product) => product.blocked.length > 0);
  const missingImages =
    importResult?.products.filter((product) => !product.has_primary_image) ?? [];
  const totals = preview.reduce(
    (summary, product) => {
      summary.products += 1;
      summary.variants += product.variants.length;
      summary.changes +=
        Number(product.action !== "BLOCKED") +
        product.variants.filter((variant) => variant.action !== "UNCHANGED")
          .length;
      return summary;
    },
    { products: 0, variants: 0, changes: 0 },
  );

  return (
    <section className="bulk-import">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">PHASE 4 · OWNER-APPROVED DATA</span>
          <h1>Bulk catalog import</h1>
          <p>
            Paste rough product blocks or upload CSV. Nothing writes until this
            preview is approved.
          </p>
        </div>
      </div>
      <div className="bulk-step">
        <b>Bulk Upload v2 · Excel staging</b>
        <span>Raw stock → Excel → review → upload → preview · no database writes</span>
      </div>
      <label className="bulk-profile">
        Profile
        <select
          aria-label="Staging profile"
          value={stagingProfile}
          onChange={(event) => setStagingProfile(event.target.value as StagingProfileId)}
        >
          <option value="none">None / Mixed Stock</option>
          {Object.entries(STAGING_PROFILES).map(([id, profile]) => (
            <option value={id} key={id}>
              {profile.label}
            </option>
          ))}
        </select>
        <small>
          {stagingProfile === "none"
            ? "Explicit row values only; blank PTA and Condition stay blank."
            : `Fills blank values only (explicit row values always win): ${STAGING_PROFILES[stagingProfile].supplies.join(" · ")} · Stock stays 10 unless a Qty is given.`}{" "}
          Android (non-Apple) Mobile Phones with no warranty get {ANDROID_MOBILE_WARRANTY} (Android mobile default); a stated warranty is never changed.
        </small>
      </label>
      <label className="bulk-raw-source">
        Raw stock lines
        <textarea
          aria-label="Raw stock lines"
          value={stockSource}
          onChange={(event) => setStockSource(event.target.value)}
          placeholder={"Samsung A16 6/128 Black; 42500\niPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312"}
        />
      </label>
      <div className="bulk-actions">
        <button
          className="admin-primary"
          onClick={() => void normalizeStockAndPreview()}
          disabled={working || !stockSource.trim()}
          type="button"
        >
          <Play /> Normalize &amp; Preview
        </button>
        <button
          className="admin-secondary"
          onClick={() => void generateExcel()}
          disabled={working || !stockSource.trim()}
          type="button"
        >
          <FileDown /> Generate Excel
        </button>
        <button
          className="admin-secondary"
          onClick={() => void downloadTemplate()}
          disabled={working}
          type="button"
        >
          <FileDown /> Download Blank Template
        </button>
        <label className="admin-secondary">
          <FileUp /> Upload Excel
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => void uploadExcel(event)}
            disabled={working}
            hidden
          />
        </label>
      </div>
      <div className="bulk-step">
        <b>1. Source data</b>
        <span>PKR major units · missing facts remain unresolved</span>
      </div>
      <div className="bulk-step">
        <b>Smart Raw Import</b>
        <span>Rule-based normalization only · no database writes until approval</span>
      </div>
      <label className="bulk-raw-source">
        Raw Product Data
        <textarea
          aria-label="Raw product data"
          value={rawSource}
          onChange={(event) => setRawSource(event.target.value)}
          placeholder={"Samsung A57 12/256 blue/grey @ 165000\nPTA Approved\n1 Year Warranty\n5000mAh Battery\n6.7 AMOLED Display\n50MP Camera"}
        />
      </label>
      <div className="bulk-actions">
        <button
          className="admin-primary"
          onClick={normalizeAndPreview}
          disabled={working || !rawSource.trim()}
          type="button"
        >
          <Play /> Normalize &amp; Preview
        </button>
      </div>
      <fieldset className="bulk-defaults">
        <legend>Batch defaults</legend>
        <p>
          Optional Owner-supplied values. Explicit product and variant values
          always win.
        </p>
        <label>
          Brand
          <input
            value={batchDefaults.brand ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                brand: event.target.value.trimStart() || null,
              })
            }
            placeholder="Exact real brand name"
          />
        </label>
        <label>
          Category
          <input
            value={batchDefaults.category ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                category: event.target.value.trimStart() || null,
              })
            }
            placeholder="Exact real category name"
          />
        </label>
        <label>
          Condition
          <select
            value={batchDefaults.condition ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                condition: (event.target.value ||
                  null) as BatchDefaults["condition"],
              })
            }
          >
            <option value="">Unresolved</option>
            <option value="brand_new">Brand New</option>
            <option value="used">Used</option>
            <option value="open_box">Open Box</option>
            <option value="refurbished">Refurbished</option>
          </select>
        </label>
        <label>
          Delivery scope
          <select
            value={batchDefaults.deliveryScope ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                deliveryScope: (event.target.value ||
                  null) as BatchDefaults["deliveryScope"],
              })
            }
          >
            <option value="">Unresolved</option>
            <option value="karachi_only">Karachi only</option>
            <option value="nationwide">Nationwide</option>
          </select>
        </label>
        <label>
          Warranty
          <input
            value={batchDefaults.warranty ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                warranty: event.target.value.trimStart() || null,
              })
            }
            placeholder="Unresolved"
          />
        </label>
        <label>
          PTA status
          <select
            value={batchDefaults.ptaStatus ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                ptaStatus: (event.target.value ||
                  null) as BatchDefaults["ptaStatus"],
              })
            }
          >
            <option value="">Unresolved</option>
            <option value="approved">PTA Approved</option>
            <option value="not_approved">Non-PTA</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </label>
        <label>
          Inventory
          <input
            type="number"
            min="0"
            step="1"
            value={batchDefaults.inventory ?? ""}
            onChange={(event) =>
              setBatchDefaults({
                ...batchDefaults,
                inventory:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
            placeholder="Unresolved"
          />
        </label>
      </fieldset>
      <label className="bulk-raw-source">
        Structured source data
        <textarea
          aria-label="Bulk catalog source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="Apple 17 Pro Max&#10;Category: Mobile Phones&#10;256 GB Blue/Orange/Silver 472000&#10;Brand New&#10;Karachi only"
        />
      </label>
      <div className="bulk-actions">
        <label className="admin-secondary">
          <FileUp /> Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={uploadCsv}
            hidden
          />
        </label>
        <button
          className="admin-primary"
          onClick={() => void parseAndPreview()}
          disabled={working || !source.trim()}
          type="button"
        >
          <Play /> Parse and preview
        </button>
      </div>
      {message && (
        <p
          className={result || preview.length ? "admin-success" : "admin-error"}
          role={result || preview.length ? "status" : "alert"}
          aria-live="polite"
        >
          {message}
        </p>
      )}
      {preview.length > 0 && (
        <>
          <div className="bulk-step">
            <b>2–4. Preview and review</b>
            <span>
              {format} · {totals.products} products · {totals.variants} explicit
              variants · {totals.changes} proposed changes
            </span>
          </div>
          {parseErrors.map((error) => (
            <p className="admin-error" key={error}>
              {error}
            </p>
          ))}
          <div className="bulk-preview">
            {preview.map((product) => (
              <article
                key={`${product.brand}-${product.title}`}
                className="bulk-product"
              >
                <header>
                  <div>
                    <strong>{product.title}</strong>
                    <small>
                      {product.brand || "No brand"} ·{" "}
                      {product.category ?? "Category unresolved"} ·{" "}
                      {product.slugResolved}
                    </small>
                  </div>
                  <span
                    className={`bulk-status ${product.blocked.length ? "blocked" : "ready"}`}
                  >
                    {product.action}
                  </span>
                </header>
                <p className="bulk-meta">
                  {product.brandAction} · {product.categoryAction}
                </p>
                <p className="bulk-meta">
                  Defaults: PTA {product.defaultPtaStatus ?? "unresolved"} (
                  {product.defaultPtaSource}) · condition{" "}
                  {product.defaultCondition ?? "unresolved"} (
                  {product.defaultConditionSource}) · warranty{" "}
                  {product.defaultWarranty ?? "unresolved"} (
                  {product.defaultWarrantySource}) · delivery{" "}
                  {product.defaultDeliveryScope ?? "unresolved"} (
                  {product.defaultDeliverySource})
                </p>
                <p className="bulk-meta">
                  SEO: title {product.seoTitle ?? "blank"} · description{" "}
                  {product.seoDescription ?? "blank"}
                </p>
                {product.notes.map((note) => (
                  <p className="bulk-meta" key={`note-${note}`}>
                    Owner note: {note}
                  </p>
                ))}
                {product.specifications.map((specification) => (
                  <p
                    className="bulk-meta"
                    key={`${specification.label}-${specification.value}`}
                  >
                    Specification: {specification.group ? `${specification.group} · ` : ""}{specification.label} — {specification.value}
                  </p>
                ))}
                {product.diagnostics
                  .filter((item) => !item.blocksApply)
                  .map((item) => (
                    <p
                      className="bulk-meta"
                      key={`${item.line}-${item.reason}`}
                    >
                      {item.classification}: {item.line} — {item.reason}
                    </p>
                  ))}
                {product.blocked.map((warning) => (
                  <p className="bulk-warning" key={warning}>
                    <AlertTriangle /> {warning}
                  </p>
                ))}
                {product.taxonomyNotes.map((note) => (
                  <p className="bulk-warning" key={note}>
                    <CheckCircle2 /> {note}
                  </p>
                ))}
                {product.variants.map((variant) => (
                  <div
                    className="bulk-variant"
                    key={`${variant.source}-${variant.color}`}
                  >
                    <div>
                      <b>
                        {variant.ram ?? "RAM unresolved"} /{" "}
                        {variant.storage ?? "Storage unresolved"} /{" "}
                        {variant.color ?? "Color unresolved"}
                      </b>
                      <small>
                        {variant.skuResolved ||
                          (variant.skuPrefix
                            ? catalogSkuPending(variant.skuPrefix)
                            : "SKU prefix unknown for this category")}
                      </small>
                    </div>
                    <div>
                      <span>Entered: {variant.pricePkr ?? "unresolved"}</span>
                      <b>{normalizedPriceDisplay(variant)}</b>
                      <small>
                        Compare-at: {variant.compareAtPricePkr ?? "not supplied"}
                      </small>
                    </div>
                    <span>
                      {variant.ptaStatus} ({variant.ptaSource}) ·{" "}
                      {variant.condition} ({variant.conditionSource}) · warranty{" "}
                      {variant.warranty ?? "unresolved"} (
                      {variant.warrantySource}) ·{" "}
                      {variant.deliveryScope ?? "delivery unresolved"} (
                      {variant.deliverySource}) · {variant.inventoryLabel}
                      {variant.conditionGrade ? ` · grade ${variant.conditionGrade}` : ""}
                      {variant.batteryHealth != null ? ` · BH ${variant.batteryHealth}%` : ""}
                      {variant.cycleCount != null ? ` · ${variant.cycleCount} cycles` : ""}
                      {variant.simConfiguration ? ` · ${simConfigurationLabel(variant.simConfiguration)}` : ""}
                    </span>
                    <span
                      className={`bulk-status ${variant.warnings.length ? "blocked" : "ready"}`}
                    >
                      {variant.action}
                    </span>
                    {stagingOnly &&
                      variant.warnings.map((warning) => (
                        <p className="bulk-warning" key={warning}>
                          <AlertTriangle /> {warning}
                        </p>
                      ))}
                  </div>
                ))}
                {product.hiddenVariants.map((hidden) => (
                  <div className="bulk-variant" key={`hide-${hidden.sku}`}>
                    <div>
                      <b>{hidden.label}</b>
                      <small>{hidden.sku}</small>
                    </div>
                    <span>Not in this file: hidden from the store (kept with its SKU, stock and order history)</span>
                    <span className="bulk-status blocked">HIDE VARIANT</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
          <div className="bulk-step">
            <b>5. {stagingOnly ? "Apply import" : "Apply approved batch"}</b>
            <span>
              {stagingOnly && importCounts
                ? `Create ${importCounts.productsToCreate} · Replace ${importCounts.productsToReplace} products · Variants: create ${importCounts.variantsToCreate}, update ${importCounts.variantsToUpdate + importCounts.variantsToReactivate}, hide ${importCounts.variantsToHide} · Rows needing review: ${importCounts.rowsNeedingReview}${blocked ? " · Resolve all rows needing review before applying" : ""}`
                : blocked
                  ? "Resolve all blocked rows before apply"
                  : "Server authorization + atomic transaction"}
            </span>
          </div>
          <button
            className="admin-primary"
            disabled={working || blocked}
            onClick={apply}
          >
            <Upload /> {stagingOnly ? "Apply Import" : "Apply approved batch"}
          </button>
        </>
      )}
      {importResult && (
        <div className="bulk-result">
          <CheckCircle2 />
          <div>
            <b>Products imported successfully</b>
            <span>Products created: {importResult.products_created}</span>
            <span>Products replaced: {importResult.products_replaced}</span>
            <span>Variants created: {importResult.variants_created}</span>
            <span>
              Variants updated: {importResult.variants_updated}
              {importResult.variants_reactivated ? ` (+${importResult.variants_reactivated} brought back)` : ""}
            </span>
            <span>Variants hidden: {importResult.variants_hidden}</span>
            <span>
              Assigned SKUs:{" "}
              {importResult.assigned_skus.length
                ? importResult.assigned_skus.map((item) => item.sku).join(", ")
                : "none (existing SKUs kept)"}
            </span>
            {importResult.compare_at_cleared.length > 0 && (
              <span>
                Compare-at cleared (no longer above the new price):{" "}
                {importResult.compare_at_cleared.map((item) => item.sku).join(", ")}
              </span>
            )}
            <span>Products missing images: {missingImages.length}</span>
            <span>
              Ready for the next step (images, then publish):{" "}
              {importResult.products.map((product) => product.title).join(", ")}
            </span>
            {missingImages.length > 0 && (
              <a className="admin-secondary" href="/admin/products?missing=images">
                View Products Missing Images
              </a>
            )}
          </div>
        </div>
      )}
      {result && (
        <div className="bulk-result">
          <CheckCircle2 />
          <div>
            <b>6. Result report</b>
            {Object.entries(result).map(([key, value]) => (
              <span key={key}>
                {key.replaceAll("_", " ")}: {value}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
