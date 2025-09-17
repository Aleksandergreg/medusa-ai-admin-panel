import type { Http } from "../http/client";
import type {
    AdminInventoryItemLevelsResponse,
    AdminInventoryItemsListResponse,
    AdminInventoryItemLevel,
    AdminVariantPreview,
    AdminVariantsListResponse,
    CountLowInventoryResult,
    CountParams,
    InventoryServiceDefinition,
    ListLowInventoryResult,
    LocationLevelSnapshot,
    LowInventoryProduct,
    LowInventoryVariant,
    LowInventoryVariantInventoryItem
} from "../types/inventory";

type InventoryService = InventoryServiceDefinition;

export function createInventoryService(http: Http): InventoryService {
    async function fetchVariantsPage(
        offset: number,
        limit: number,
        manageOnly: boolean
    ): Promise<AdminVariantPreview[]> {
        const query: Record<string, unknown> = {
            limit,
            offset,
            fields: [
                "+id",
                "+product_id",
                "+title",
                "+sku",
                "+manage_inventory",
                "+inventory_quantity"
            ].join(",")
        };
        if (manageOnly) {
            query.manage_inventory = true;
        }
        const data = await http.get<AdminVariantsListResponse>(
            "/admin/product-variants",
            query
        );
        if (!data?.variants || !Array.isArray(data.variants)) {
            return [];
        }
        return data.variants;
    }

    const toOptionalNumber = (value: unknown): number | undefined => {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed !== "") {
                const parsed = Number(trimmed);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
        }
        return undefined;
    };

    const toNumber = (value: unknown): number => toOptionalNumber(value) ?? 0;

    async function enrichVariantsWithInventory(
        products: Array<LowInventoryProduct>
    ): Promise<void> {
        const skuToVariants = new Map<string, LowInventoryVariant[]>();
        for (const product of products) {
            for (const variant of product.low_variants) {
                const skuValue =
                    typeof variant.sku === "string" && variant.sku.trim() !== ""
                        ? variant.sku
                        : null;
                if (!skuValue) {
                    continue;
                }
                const existing = skuToVariants.get(skuValue);
                if (existing) {
                    existing.push(variant);
                } else {
                    skuToVariants.set(skuValue, [variant]);
                }
            }
        }
        if (skuToVariants.size === 0) {
            return;
        }

        type InventoryAggregation = {
            totalReserved: number;
            totalStocked: number;
            totalAvailable: number;
            items: Array<LowInventoryVariantInventoryItem>;
        };

        const aggregateBySku = new Map<string, InventoryAggregation>();
        const locationLevelsCache = new Map<string, Array<LocationLevelSnapshot>>();

        const getOrCreateAggregate = (skuKey: string): InventoryAggregation => {
            const existing = aggregateBySku.get(skuKey);
            if (existing) {
                return existing;
            }
            const fresh: InventoryAggregation = {
                totalReserved: 0,
                totalStocked: 0,
                totalAvailable: 0,
                items: []
            };
            aggregateBySku.set(skuKey, fresh);
            return fresh;
        };

        const mapLocationLevels = (
            rawLevels: Array<AdminInventoryItemLevel> | null | undefined
        ): Array<LocationLevelSnapshot> => {
            if (!Array.isArray(rawLevels)) {
                return [];
            }

            return rawLevels.map((level) => {
                const locationId =
                    typeof level?.location_id === "string" && level.location_id.trim() !== ""
                        ? level.location_id
                        : null;

                return {
                    location_id: locationId,
                    stocked_quantity: toNumber(level?.stocked_quantity),
                    reserved_quantity: toNumber(level?.reserved_quantity),
                    available_quantity: toNumber(level?.available_quantity)
                };
            });
        };

        const resolveLocationLevels = async (
            inventoryItemId: string
        ): Promise<Array<LocationLevelSnapshot>> => {
            if (!inventoryItemId) {
                return [];
            }

            const cached = locationLevelsCache.get(inventoryItemId);
            if (cached) {
                return cached;
            }

            const collected: Array<LocationLevelSnapshot> = [];
            const limit = 200;
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                let response: AdminInventoryItemLevelsResponse | undefined;
                try {
                    response = await http.get<AdminInventoryItemLevelsResponse>(
                        `/admin/inventory-items/${encodeURIComponent(inventoryItemId)}/location-levels`,
                        { limit, offset }
                    );
                } catch {
                    break;
                }

                const levels = response?.inventory_levels ?? [];
                const page = mapLocationLevels(levels);
                if (page.length > 0) {
                    collected.push(...page);
                }

                if (levels.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }

            locationLevelsCache.set(inventoryItemId, collected);
            return collected;
        };

        const skus = Array.from(skuToVariants.keys());
        const chunkSize = 20;

        for (let i = 0; i < skus.length; i += chunkSize) {
            const chunk = skus.slice(i, i + chunkSize);
            let offset = 0;
            const limit = 200;
            let hasMore = true;

            while (hasMore) {
                let payload: AdminInventoryItemsListResponse | undefined;
                try {
                    payload = await http.get<AdminInventoryItemsListResponse>(
                        "/admin/inventory-items",
                        { sku: chunk, limit, offset }
                    );
                } catch {
                    break;
                }

                const items = payload?.inventory_items ?? [];
                for (const item of items) {
                    const skuValue =
                        typeof item?.sku === "string" && item.sku.trim() !== ""
                            ? item.sku
                            : undefined;

                    if (!skuValue || !skuToVariants.has(skuValue)) {
                        continue;
                    }

                    const baseStockedRaw = toOptionalNumber(item?.stocked_quantity);
                    const baseReservedRaw = toOptionalNumber(item?.reserved_quantity);
                    const baseAvailableRaw = toOptionalNumber(item?.available_quantity);

                    let parsedLevels = mapLocationLevels(item?.location_levels ?? undefined);
                    if (parsedLevels.length === 0) {
                        const itemId =
                            typeof item?.id === "string" && item.id.trim() !== ""
                                ? item.id
                                : "";
                        if (itemId) {
                            parsedLevels = await resolveLocationLevels(itemId);
                        }
                    }

                    if (
                        parsedLevels.length === 0 &&
                        (baseStockedRaw != null ||
                            baseReservedRaw != null ||
                            baseAvailableRaw != null)
                    ) {
                        parsedLevels = [
                            {
                                location_id: null,
                                stocked_quantity: baseStockedRaw ?? 0,
                                reserved_quantity: baseReservedRaw ?? 0,
                                available_quantity: baseAvailableRaw ?? 0
                            }
                        ];
                    }

                    const itemSummary: LowInventoryVariantInventoryItem = {
                        id:
                            typeof item?.id === "string" && item.id.trim() !== ""
                                ? item.id
                                : "",
                        sku: skuValue ?? null,
                        stocked_quantity: parsedLevels.reduce(
                            (acc, level) => acc + level.stocked_quantity,
                            0
                        ),
                        reserved_quantity: parsedLevels.reduce(
                            (acc, level) => acc + level.reserved_quantity,
                            0
                        ),
                        available_quantity: parsedLevels.reduce(
                            (acc, level) => acc + level.available_quantity,
                            0
                        ),
                        location_levels: parsedLevels
                    };

                    const aggregate = getOrCreateAggregate(skuValue);

                    aggregate.totalReserved += itemSummary.reserved_quantity;
                    aggregate.totalStocked += itemSummary.stocked_quantity;
                    aggregate.totalAvailable += itemSummary.available_quantity;
                    aggregate.items.push(itemSummary);
                }

                const currentBatchCount = payload?.inventory_items?.length ?? 0;
                if (currentBatchCount < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }
        }

        for (const [skuValue, variants] of skuToVariants.entries()) {
            const aggregate = aggregateBySku.get(skuValue);
            if (!aggregate) {
                continue;
            }

            for (const variant of variants) {
                variant.reserved_quantity = aggregate.totalReserved;
                variant.stocked_quantity = aggregate.totalStocked;
                variant.available_quantity = aggregate.totalAvailable;
                variant.inventory_items = aggregate.items.map((item) => ({
                    ...item,
                    location_levels: item.location_levels.map((level) => ({ ...level }))
                }));
            }
        }
    }

    async function countLowInventoryProducts(
        params: CountParams
    ): Promise<CountLowInventoryResult> {
        const threshold = Math.max(0, Math.floor(params.threshold ?? 0));
        const manageOnly = params.manage_inventory_only !== false; // default true

        const limit = 200;
        let offset = 0;
        const productIds = new Set<string>();
        let variantsCount = 0;

        let hasMore = true;
        while (hasMore) {
            let batch: AdminVariantPreview[] = [];
            try {
                batch = await fetchVariantsPage(offset, limit, manageOnly);
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
            if (batch.length < limit) {
                hasMore = false;
            } else {
                offset += limit;
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

        const limit = 200;
        let offset = 0;
        const productsOut: Array<LowInventoryProduct> = [];
        let variantsCount = 0;

        let hasMore = true;
        while (hasMore) {
            let batch: AdminVariantPreview[] = [];
            try {
                batch = await fetchVariantsPage(offset, limit, manageOnly);
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
            if (batch.length < limit) {
                hasMore = false;
            } else {
                offset += limit;
            }
        }

        try {
            await enrichVariantsWithInventory(productsOut);
        } catch {
            // ignore inventory enrichment failures
        }

        // Hydrate product titles
        for (const row of productsOut) {
            if (row.title) {
                continue;
            }
            try {
                const response = await http.get<{
                    product?: { id?: string; title?: string | null };
                }>(`/admin/products/${encodeURIComponent(row.id)}`, {
                    fields: ["+id", "+title"].join(",")
                });
                const productTitle =
                    typeof response?.product?.title === "string"
                        ? response.product.title
                        : null;
                row.title = productTitle;
            } catch {
                // ignore
            }
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
