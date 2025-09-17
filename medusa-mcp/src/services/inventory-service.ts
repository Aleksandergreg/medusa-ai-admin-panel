import type { Http } from "../http/client";

type CountParams = {
    threshold: number;
    manage_inventory_only?: boolean;
};

type LocationLevelSnapshot = {
    location_id: string | null;
    stocked_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
};

type LowInventoryVariantInventoryItem = {
    id: string;
    sku: string | null;
    stocked_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
    location_levels: Array<LocationLevelSnapshot>;
};

type LowInventoryVariant = {
    id: string;
    title: string | null;
    sku: string | null;
    inventory_quantity: number;
    reserved_quantity: number;
    stocked_quantity: number | null;
    available_quantity: number | null;
    inventory_items: Array<LowInventoryVariantInventoryItem>;
};

type LowInventoryProduct = {
    id: string;
    title: string | null;
    low_variants_count: number;
    low_variants: Array<LowInventoryVariant>;
};

type CountLowInventoryResult = {
    threshold: number;
    count: number;
    variants_count: number;
};

type ListLowInventoryResult = CountLowInventoryResult & {
    products: Array<LowInventoryProduct>;
};

type InventoryItemsLookup = {
    inventory_items?: Array<{
        id?: string;
        sku?: string | null;
        location_levels?: Array<{
            location_id?: string | null;
            stocked_quantity?: number | string | null;
            reserved_quantity?: number | string | null;
            available_quantity?: number | string | null;
        }>;
    }>;
};

type InventoryService = {
    countLowInventoryProducts(
        params: CountParams
    ): Promise<CountLowInventoryResult>;
    listLowInventoryProducts(
        params: CountParams
    ): Promise<ListLowInventoryResult>;
};

export function createInventoryService(http: Http): InventoryService {
    async function fetchVariantsPage(
        offset: number,
        limit: number,
        manageOnly: boolean
    ): Promise<
        Array<{
            id?: string;
            product_id?: string;
            title?: string | null;
            sku?: string | null;
            manage_inventory?: boolean;
            inventory_quantity?: number | string | null;
        }>
    > {
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
        const data = await http.get<{
            variants?: Array<{
                id?: string;
                product_id?: string;
                title?: string | null;
                sku?: string | null;
                manage_inventory?: boolean;
                inventory_quantity?: number | string | null;
            }>;
        }>("/admin/product-variants", query);
        return Array.isArray(data?.variants) ? (data!.variants as any[]) : [];
    }

    const toNumber = (value: unknown): number => {
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
        return 0;
    };

    async function enrichVariantsWithInventory(
        products: Array<LowInventoryProduct>
    ): Promise<void> {
        const skuToVariants = new Map<string, LowInventoryVariant[]>();
        for (const product of products) {
            for (const variant of product.low_variants) {
                const sku =
                    typeof variant.sku === "string" && variant.sku.trim() !== ""
                        ? variant.sku
                        : null;
                if (!sku) {
                    continue;
                }
                const grouped = skuToVariants.get(sku);
                if (grouped) {
                    grouped.push(variant);
                } else {
                    skuToVariants.set(sku, [variant]);
                }
            }
        }
        if (skuToVariants.size === 0) {
            return;
        }

        const aggregateBySku = new Map<
            string,
            {
                totalReserved: number;
                totalStocked: number;
                totalAvailable: number;
                items: Array<LowInventoryVariantInventoryItem>;
            }
        >();

        const skus = Array.from(skuToVariants.keys());
        const chunkSize = 20;

        for (let i = 0; i < skus.length; i += chunkSize) {
            const chunk = skus.slice(i, i + chunkSize);
            let offset = 0;
            const limit = 200;
            let hasMore = true;

            while (hasMore) {
                let payload: InventoryItemsLookup | undefined;
                try {
                    payload = await http.get<InventoryItemsLookup>(
                        "/admin/inventory-items",
                        {
                            sku: chunk,
                            limit,
                            offset,
                            expand: "location_levels",
                            fields: [
                                "+id",
                                "+sku",
                                "+location_levels",
                                "+location_levels.location_id",
                                "+location_levels.stocked_quantity",
                                "+location_levels.reserved_quantity",
                                "+location_levels.available_quantity"
                            ].join(",")
                        }
                    );
                } catch {
                    break;
                }

                const items = Array.isArray(payload?.inventory_items)
                    ? (payload!.inventory_items as any[])
                    : [];

                for (const item of items) {
                    const skuRaw = item?.sku;
                    const sku =
                        typeof skuRaw === "string" && skuRaw.trim() !== ""
                            ? skuRaw
                            : undefined;
                    if (!sku || !skuToVariants.has(sku)) {
                        continue;
                    }

                    const locationLevels = Array.isArray(item?.location_levels)
                        ? (item!.location_levels as any[])
                        : [];

                    const parsedLevels: Array<LocationLevelSnapshot> =
                        locationLevels.map((lvl) => {
                            const locationId =
                                typeof lvl?.location_id === "string" &&
                                lvl.location_id.trim() !== ""
                                    ? lvl.location_id
                                    : null;
                            return {
                                location_id: locationId,
                                stocked_quantity: toNumber(
                                    (lvl as any)?.stocked_quantity
                                ),
                                reserved_quantity: toNumber(
                                    (lvl as any)?.reserved_quantity
                                ),
                                available_quantity: toNumber(
                                    (lvl as any)?.available_quantity
                                )
                            };
                        });

                    const itemSummary: LowInventoryVariantInventoryItem = {
                        id:
                            typeof item?.id === "string" && item.id
                                ? item.id
                                : "",
                        sku,
                        stocked_quantity: parsedLevels.reduce(
                            (acc, lvl) => acc + lvl.stocked_quantity,
                            0
                        ),
                        reserved_quantity: parsedLevels.reduce(
                            (acc, lvl) => acc + lvl.reserved_quantity,
                            0
                        ),
                        available_quantity: parsedLevels.reduce(
                            (acc, lvl) => acc + lvl.available_quantity,
                            0
                        ),
                        location_levels: parsedLevels
                    };

                    const aggregate = aggregateBySku.get(sku) ?? {
                        totalReserved: 0,
                        totalStocked: 0,
                        totalAvailable: 0,
                        items: [] as Array<LowInventoryVariantInventoryItem>
                    };

                    aggregate.totalReserved += itemSummary.reserved_quantity;
                    aggregate.totalStocked += itemSummary.stocked_quantity;
                    aggregate.totalAvailable += itemSummary.available_quantity;
                    aggregate.items.push(itemSummary);

                    aggregateBySku.set(sku, aggregate);
                }

                if (items.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }
        }

        for (const [sku, variants] of skuToVariants.entries()) {
            const aggregate = aggregateBySku.get(sku);
            if (!aggregate) {
                continue;
            }
            for (const variant of variants) {
                variant.reserved_quantity = aggregate.totalReserved;
                variant.stocked_quantity = aggregate.totalStocked;
                variant.available_quantity = aggregate.totalAvailable;
                variant.inventory_items = aggregate.items.map((item) => ({
                    ...item,
                    location_levels: item.location_levels.map((lvl) => ({
                        ...lvl
                    }))
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
            let batch: any[] = [];
            try {
                batch = await fetchVariantsPage(offset, limit, manageOnly);
            } catch {
                batch = [];
            }
            if (batch.length === 0) {
                break;
            }
            for (const v of batch) {
                if (manageOnly && v?.manage_inventory !== true) {
                    continue;
                }
                const qtyRaw = v?.inventory_quantity as
                    | number
                    | string
                    | null
                    | undefined;
                const qty =
                    typeof qtyRaw === "number"
                        ? qtyRaw
                        : typeof qtyRaw === "string" && qtyRaw.trim() !== ""
                        ? Number(qtyRaw)
                        : undefined;
                if (
                    typeof qty === "number" &&
                    Number.isFinite(qty) &&
                    qty < threshold
                ) {
                    variantsCount += 1;
                    const pid = v?.product_id as string | undefined;
                    if (pid) {
                        productIds.add(pid);
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
            let batch: any[] = [];
            try {
                batch = await fetchVariantsPage(offset, limit, manageOnly);
            } catch {
                batch = [];
            }
            if (batch.length === 0) {
                break;
            }
            for (const v of batch) {
                if (manageOnly && v?.manage_inventory !== true) {
                    continue;
                }
                const qtyRaw = v?.inventory_quantity as
                    | number
                    | string
                    | null
                    | undefined;
                const qty =
                    typeof qtyRaw === "number"
                        ? qtyRaw
                        : typeof qtyRaw === "string" && qtyRaw.trim() !== ""
                        ? Number(qtyRaw)
                        : undefined;
                if (
                    typeof qty === "number" &&
                    Number.isFinite(qty) &&
                    qty < threshold
                ) {
                    variantsCount += 1;
                    const pid = v?.product_id as string | undefined;
                    if (!pid) {
                        continue;
                    }
                    let row = productsOut.find((r) => r.id === pid);
                    if (!row) {
                        row = {
                            id: pid,
                            title: null,
                            low_variants_count: 0,
                            low_variants: []
                        };
                        productsOut.push(row);
                    }
                    row.low_variants_count += 1;
                    row.low_variants.push({
                        id: (v?.id ?? "") as string,
                        title: (v?.title ?? null) as string | null,
                        sku: (v?.sku ?? null) as string | null,
                        inventory_quantity: qty,
                        reserved_quantity: 0,
                        stocked_quantity: null,
                        available_quantity: null,
                        inventory_items: []
                    });
                }
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
                const d = await http.get<{
                    product?: { id?: string; title?: string | null };
                }>(`/admin/products/${encodeURIComponent(row.id)}`, {
                    fields: ["+id", "+title"].join(",")
                });
                row.title = (d?.product?.title ?? null) as string | null;
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
