import type { Http } from "../http/client";
import type {
    AdminVariantPreview,
    CountLowInventoryResult,
    CountParams,
    InventoryServiceDefinition,
    ListLowInventoryResult,
    LowInventoryProduct
} from "../types/inventory";
import { fetchVariantsPage } from "../data/variants-api";
import { enrichVariantsWithInventory } from "./inventory-enrichment";
import { hydrateProductTitles } from "./product-title-hydration";
import { toOptionalNumber } from "../utils/number";

type InventoryService = InventoryServiceDefinition;

const VARIANT_PAGE_LIMIT = 200;

export function createInventoryService(http: Http): InventoryService {
    async function countLowInventoryProducts(
        params: CountParams
    ): Promise<CountLowInventoryResult> {
        const threshold = Math.max(0, Math.floor(params.threshold ?? 0));
        const manageOnly = params.manage_inventory_only !== false; // default true

        let offset = 0;
        const productIds = new Set<string>();
        let variantsCount = 0;
        let hasMore = true;

        while (hasMore) {
            let batch: AdminVariantPreview[] = [];
            try {
                batch = await fetchVariantsPage(http, {
                    offset,
                    limit: VARIANT_PAGE_LIMIT,
                    manageOnly
                });
            } catch {
                batch = [];
            }

            if (batch.length === 0) {
                break;
            }

            for (const variant of batch) {
                if (manageOnly && variant?.manage_inventory !== true) {
                    continue;
                }
                const quantity = toOptionalNumber(variant?.inventory_quantity);
                if (typeof quantity === "number" && quantity < threshold) {
                    variantsCount += 1;
                    const productId =
                        typeof variant?.product_id === "string" &&
                        variant.product_id.trim() !== ""
                            ? variant.product_id
                            : undefined;
                    if (productId) {
                        productIds.add(productId);
                    }
                }
            }

            if (batch.length < VARIANT_PAGE_LIMIT) {
                hasMore = false;
            } else {
                offset += VARIANT_PAGE_LIMIT;
            }
        }

        return {
            threshold,
            count: productIds.size,
            variants_count: variantsCount
        };
    }

    async function listLowInventoryProducts(
        params: CountParams
    ): Promise<ListLowInventoryResult> {
        const threshold = Math.max(0, Math.floor(params.threshold ?? 0));
        const manageOnly = params.manage_inventory_only !== false; // default true

        let offset = 0;
        const productsOut: LowInventoryProduct[] = [];
        let variantsCount = 0;
        let hasMore = true;

        while (hasMore) {
            let batch: AdminVariantPreview[] = [];
            try {
                batch = await fetchVariantsPage(http, {
                    offset,
                    limit: VARIANT_PAGE_LIMIT,
                    manageOnly
                });
            } catch {
                batch = [];
            }

            if (batch.length === 0) {
                break;
            }

            for (const variant of batch) {
                if (manageOnly && variant?.manage_inventory !== true) {
                    continue;
                }
                const quantity = toOptionalNumber(variant?.inventory_quantity);
                if (typeof quantity !== "number" || quantity >= threshold) {
                    continue;
                }

                variantsCount += 1;
                const productId =
                    typeof variant?.product_id === "string" &&
                    variant.product_id.trim() !== ""
                        ? variant.product_id
                        : undefined;
                if (!productId) {
                    continue;
                }

                let row = productsOut.find((entry) => entry.id === productId);
                if (!row) {
                    row = {
                        id: productId,
                        title: null,
                        low_variants_count: 0,
                        low_variants: []
                    };
                    productsOut.push(row);
                }

                row.low_variants_count += 1;

                const variantId =
                    typeof variant?.id === "string" && variant.id.trim() !== ""
                        ? variant.id
                        : "";
                const variantTitle =
                    typeof variant?.title === "string" ? variant.title : null;
                const variantSku =
                    typeof variant?.sku === "string" && variant.sku.trim() !== ""
                        ? variant.sku
                        : null;

                row.low_variants.push({
                    id: variantId,
                    title: variantTitle,
                    sku: variantSku,
                    inventory_quantity: quantity,
                    reserved_quantity: 0,
                    stocked_quantity: null,
                    available_quantity: null,
                    inventory_items: []
                });
            }

            if (batch.length < VARIANT_PAGE_LIMIT) {
                hasMore = false;
            } else {
                offset += VARIANT_PAGE_LIMIT;
            }
        }

        try {
            await enrichVariantsWithInventory(http, productsOut);
        } catch {
            // ignore inventory enrichment failures
        }

        try {
            await hydrateProductTitles(http, productsOut);
        } catch {
            // ignore product hydration failures
        }

        return {
            threshold,
            count: productsOut.length,
            variants_count: variantsCount,
            products: productsOut
        };
    }

    return {
        countLowInventoryProducts,
        listLowInventoryProducts
    };
}
