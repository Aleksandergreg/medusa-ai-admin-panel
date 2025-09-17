export type CountParams = {
    threshold: number;
    manage_inventory_only?: boolean;
};

export type LocationLevelSnapshot = {
    location_id: string | null;
    stocked_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
};

export type LowInventoryVariantInventoryItem = {
    id: string;
    sku: string | null;
    stocked_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
    location_levels: Array<LocationLevelSnapshot>;
};

export type LowInventoryVariant = {
    id: string;
    title: string | null;
    sku: string | null;
    inventory_quantity: number;
    reserved_quantity: number;
    stocked_quantity: number | null;
    available_quantity: number | null;
    inventory_items: Array<LowInventoryVariantInventoryItem>;
};

export type LowInventoryProduct = {
    id: string;
    title: string | null;
    low_variants_count: number;
    low_variants: Array<LowInventoryVariant>;
};

export type CountLowInventoryResult = {
    threshold: number;
    count: number;
    variants_count: number;
};

export type ListLowInventoryResult = CountLowInventoryResult & {
    products: Array<LowInventoryProduct>;
};

export type AdminVariantPreview = {
    id?: string;
    product_id?: string;
    title?: string | null;
    sku?: string | null;
    manage_inventory?: boolean;
    inventory_quantity?: number | string | null;
};

export type AdminVariantsListResponse = {
    variants?: Array<AdminVariantPreview>;
};

export type AdminInventoryItemLevel = {
    id?: string;
    location_id?: string | null;
    stocked_quantity?: number | string | null;
    reserved_quantity?: number | string | null;
    available_quantity?: number | string | null;
};

export type AdminInventoryItem = {
    id?: string;
    sku?: string | null;
    stocked_quantity?: number | string | null;
    reserved_quantity?: number | string | null;
    available_quantity?: number | string | null;
    location_levels?: Array<AdminInventoryItemLevel> | null;
};

export type AdminInventoryItemsListResponse = {
    inventory_items?: Array<AdminInventoryItem>;
};

export type AdminInventoryItemLevelsResponse = {
    inventory_levels?: Array<AdminInventoryItemLevel>;
};

export type AdminProductSummaryResponse = {
    product?: { id?: string; title?: string | null };
};
export type InventoryServiceDefinition = {
    countLowInventoryProducts(
        params: CountParams
    ): Promise<CountLowInventoryResult>;
    listLowInventoryProducts(
        params: CountParams
    ): Promise<ListLowInventoryResult>;
};
