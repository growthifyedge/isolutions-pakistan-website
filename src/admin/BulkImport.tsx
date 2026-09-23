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
  generatedVariantSku,
  matchingActiveRealCategoryTaxonomy,
  matchingActiveRealTaxonomy,
  requiresExplicitPricedVariant,
  normalizedPriceDisplay,
  normalizeRawCatalog,
  parseBulkCatalog,
  unresolvedVariantFacts,
} from "../lib/bulkCatalog";
import { normalizeStockLines } from "../lib/catalogSheet";
import {
  buildCatalogWorkbook,
  catalogSheetToBulkParseResult,
  readCatalogWorkbook,
  validateCatalogSheet,
  type CatalogReference,
} from "../lib/catalogWorkbook";

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
  product_variants: Array<{
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
  skuResolved: string;
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
  const [preview, setPreview] = useState<PreviewProduct[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [format, setFormat] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
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
            "id,title,slug,brand_id,category_id,publication_status,default_pta_status,default_condition,default_warranty,default_delivery_scope,product_variants(id,sku,ram_display,storage_display,color_finish,price_minor,compare_at_price_minor,pta_status,condition,warranty_override,delivery_scope)",
          ),
      ]);
      const queryError =
        brandResult.error ?? categoryResult.error ?? productResult.error;
      if (queryError) throw queryError;
      const brands = (brandResult.data ?? []) as Taxonomy[];
      const categories = (categoryResult.data ?? []) as Taxonomy[];
      const products = (productResult.data ?? []) as ExistingProduct[];
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
        const candidates = product.slug
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
        if (requiresExplicitPricedVariant(Boolean(existing), product.variants))
          blocked.push("No explicit priced variant parsed");
        if (!existing && !product.category)
          blocked.push("Category required for new product");
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
              warranty:
                parsedVariant.warrantySource === "unresolved" &&
                preserveExistingWarrantyDefault
                  ? effectiveDefaults.warranty
                  : parsedVariant.warranty,
              warrantySource:
                parsedVariant.warrantySource === "unresolved" &&
                preserveExistingWarrantyDefault
                  ? ("inherited from product" as const)
                  : parsedVariant.warrantySource,
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
            const canonicalSku = generatedVariantSku(
              existing?.slug ?? requestedSlug,
              variant,
            );
            const matches =
              existing?.product_variants.filter(
                (item) =>
                  item.sku === variant.sku ||
                  item.sku === canonicalSku ||
                  matchesVariant(item, variant),
              ) ?? [];
            const variantBlocked = [...variant.warnings];
            if (matches.length > 1)
              variantBlocked.push("Ambiguous variant match");
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
            const preserveExistingWarranty = Boolean(
              match &&
              variant.warrantySource !== "Owner supplied explicitly" &&
              match.warranty_override,
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
            const effectiveWarranty = preserveExistingWarranty
              ? match!.warranty_override
              : variant.warranty;
            const effectiveWarrantySource = preserveExistingWarranty
              ? "Owner supplied explicitly"
              : variant.warrantySource;
            const effectiveDelivery = preserveExistingDelivery
              ? match!.delivery_scope
              : variant.deliveryScope;
            const effectiveDeliverySource = preserveExistingDelivery
              ? "Owner supplied explicitly"
              : variant.deliverySource;
            const skuResolved = canonicalSku || match?.sku || "";
            const missingFacts = unresolvedVariantFacts(variant, {
              sku: skuResolved,
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
              match.sku === skuResolved &&
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
              inventoryLabel: inventoryIntent.label,
              action: variantBlocked.length
                ? "NEEDS REVIEW"
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
          if (seenSkus.has(variant.skuResolved))
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
        return {
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
          categoryId:
            categoryId ??
            (existing && !product.category ? existing.category_id : null),
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
            parsed.format === "catalog_sheet"
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
    const [brandResult, categoryResult] = await Promise.all([
      supabase.from("brands").select("name").eq("data_class", "real").eq("is_active", true),
      supabase.from("categories").select("name").eq("data_class", "real").eq("is_active", true),
    ]);
    const error = brandResult.error ?? categoryResult.error;
    if (error) throw error;
    return {
      brands: (brandResult.data ?? []).map((item) => item.name as string),
      categories: (categoryResult.data ?? []).map((item) => item.name as string),
    };
  };

  const normalizeStock = async () => {
    const reference = await loadCatalogReference();
    const { rows } = normalizeStockLines(stockSource, {
      brands: reference.brands.map((name) => ({ name })),
    });
    return { reference, ...validateCatalogSheet(rows, [], reference) };
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

  const apply = async () => {
    if (
      !supabase ||
      format === "catalog_sheet" ||
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

  // Excel staging (Bulk Upload v2) is preview-only until the Phase 2 import RPC exists.
  const stagingOnly = format === "catalog_sheet";
  const blocked =
    stagingOnly ||
    parseErrors.length > 0 ||
    preview.some((product) => product.blocked.length > 0);
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
          placeholder="Apple 17 Pro Max&#10;Category: Smartphones&#10;256 GB Blue/Orange/Silver 472000&#10;Brand New&#10;Karachi only"
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
                      <small>{variant.skuResolved}</small>
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
              </article>
            ))}
          </div>
          <div className="bulk-step">
            <b>5. Apply approved batch</b>
            <span>
              {stagingOnly
                ? "Excel staging preview only · database import arrives in Phase 2"
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
            <Upload /> Apply approved batch
          </button>
        </>
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
