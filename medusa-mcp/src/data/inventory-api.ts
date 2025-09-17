import type { Http } from "../http/client";
import type {
    AdminInventoryItemLevelsResponse,
    AdminInventoryItemsListResponse
} from "../types/inventory";

export async function fetchInventoryItemsPage(
    http: Http,
    params: { skus: string[]; limit: number; offset: number }
): Promise<AdminInventoryItemsListResponse> {
    const { skus, limit, offset } = params;
    if (!Array.isArray(skus) || skus.length === 0) {
        return { inventory_items: [] };
    }

    return await http.get<AdminInventoryItemsListResponse>(
        "/admin/inventory-items",
        {
            sku: skus,
            limit,
            offset
        }
    );
}

export async function fetchInventoryItemLocationLevels(
    http: Http,
    inventoryItemId: string,
    params: { limit: number; offset: number }
): Promise<AdminInventoryItemLevelsResponse> {
    const { limit, offset } = params;
    return await http.get<AdminInventoryItemLevelsResponse>(
        `/admin/inventory-items/${encodeURIComponent(inventoryItemId)}/location-levels`,
        { limit, offset }
    );
}
