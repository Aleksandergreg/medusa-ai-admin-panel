import type { Http } from "../http/client";
import type {
    AdminInventoryItemLevel,
    LowInventoryProduct,
    LowInventoryVariant,
    LowInventoryVariantInventoryItem,
    LocationLevelSnapshot
} from "../types/inventory";
import { fetchInventoryItemsPage, fetchInventoryItemLocationLevels } from "../data/inventory-api";
import { toNumber, toOptionalNumber } from "../utils/number";

const INVENTORY_PAGE_LIMIT = 200;
const VARIANT_CHUNK_SIZE = 20;

type InventoryAggregation = {
    totalReserved: number;
    totalStocked: number;
    totalAvailable: number;
    items: Array<LowInventoryVariantInventoryItem>;
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

export async function enrichVariantsWithInventory(
    http: Http,
    products: LowInventoryProduct[]
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
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            let response;
            try {
                response = await fetchInventoryItemLocationLevels(http, inventoryItemId, {
                    limit: INVENTORY_PAGE_LIMIT,
                    offset
                });
            } catch {
                break;
            }

            const levels = response?.inventory_levels ?? [];
            const page = mapLocationLevels(levels);
            if (page.length > 0) {
                collected.push(...page);
            }

            if (levels.length < INVENTORY_PAGE_LIMIT) {
                hasMore = false;
            } else {
                offset += INVENTORY_PAGE_LIMIT;
            }
        }

        locationLevelsCache.set(inventoryItemId, collected);
        return collected;
    };

    const skus = Array.from(skuToVariants.keys());

    for (let i = 0; i < skus.length; i += VARIANT_CHUNK_SIZE) {
        const chunk = skus.slice(i, i + VARIANT_CHUNK_SIZE);
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            let payload;
            try {
                payload = await fetchInventoryItemsPage(http, {
                    skus: chunk,
                    limit: INVENTORY_PAGE_LIMIT,
                    offset
                });
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
                    (baseStockedRaw != null || baseReservedRaw != null || baseAvailableRaw != null)
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

            if (items.length < INVENTORY_PAGE_LIMIT) {
                hasMore = false;
            } else {
                offset += INVENTORY_PAGE_LIMIT;
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
