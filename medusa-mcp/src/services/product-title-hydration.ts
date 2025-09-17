import type { Http } from "../http/client";
import type {
    AdminProductSummaryResponse,
    LowInventoryProduct
} from "../types/inventory";

const PRODUCT_FIELDS = ["+id", "+title"].join(",");

export async function hydrateProductTitles(
    http: Http,
    products: LowInventoryProduct[]
): Promise<void> {
    for (const product of products) {
        if (product.title) {
            continue;
        }

        try {
            const response = await http.get<AdminProductSummaryResponse>(
                `/admin/products/${encodeURIComponent(product.id)}`,
                { fields: PRODUCT_FIELDS }
            );

            const nextTitle =
                typeof response?.product?.title === "string"
                    ? response.product.title
                    : null;
            product.title = nextTitle;
        } catch {
            // swallow errors to keep best-effort hydration
        }
    }
}
