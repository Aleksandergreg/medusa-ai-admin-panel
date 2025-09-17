import type { Http } from "../http/client";
import type {
    AdminVariantPreview,
    AdminVariantsListResponse
} from "../types/inventory";

export async function fetchVariantsPage(
    http: Http,
    params: { offset: number; limit: number; manageOnly: boolean }
): Promise<AdminVariantPreview[]> {
    const { offset, limit, manageOnly } = params;
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

    if (!Array.isArray(data?.variants)) {
        return [];
    }

    return data.variants;
}
