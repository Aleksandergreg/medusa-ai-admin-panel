import { defineTool } from "../utils/define-tools";
import type {
    PromotionOrderAnalysis,
    PromotionProductStats,
    PromotionSummary
} from "../services/promotion-analytics-service";

type PromotionAnalyticsService = {
    getOrdersWithPromotions: (
        start: string,
        end: string,
        promotion_code?: string
    ) => Promise<PromotionOrderAnalysis[]>;
    getPromotionProductStats: (
        start: string,
        end: string,
        promotion_code?: string
    ) => Promise<PromotionProductStats[]>;
    getPromotionsSummary: (
        start: string,
        end: string
    ) => Promise<PromotionSummary[]>;
    getProductsByPromotionPerformance: (
        start: string,
        end: string,
        sort_by?: "quantity" | "revenue" | "orders",
        sort_order?: "asc" | "desc",
        limit?: number
    ) => Promise<PromotionProductStats[]>;
};

export function createPromotionAnalyticsTools(
    promotionAnalytics: PromotionAnalyticsService
): Array<ReturnType<typeof defineTool>> {
    // Helper function to coerce date range input
    const coerceRange = (
        input: Record<string, unknown>
    ): { start?: string; end?: string } => {
        // Try different possible field names for start
        const start =
            (input.start as string) ||
            (input.start_date as string) ||
            (input.from as string);

        // Try different possible field names for end
        const end =
            (input.end as string) ||
            (input.end_date as string) ||
            (input.to as string);

        return { start, end };
    };

    // Default date range (last 30 days)
    const defaultDateRange = {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString()
    };

    const orders_with_promotions = defineTool((z) => ({
        name: "orders_with_promotions",
        description:
            "Find all orders where customers used promotions/discounts. Shows order details, customer info, and discount amounts applied.",
        inputSchema: {
            start: z.string().datetime().optional(),
            end: z.string().datetime().optional(),
            start_date: z.string().datetime().optional(),
            end_date: z.string().datetime().optional(),
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional(),
            promotion_code: z.string().optional()
        },
        handler: async (input) => {
            // Coerce date range
            const { start: coercedStart, end: coercedEnd } = coerceRange(input);
            const start = coercedStart || defaultDateRange.start;
            const end = coercedEnd || defaultDateRange.end;
            const promotion_code = input.promotion_code as string | undefined;

            const orders = await promotionAnalytics.getOrdersWithPromotions(
                start,
                end,
                promotion_code
            );

            return {
                start,
                end,
                promotion_code,
                total_orders: orders.length,
                total_discount_amount: orders.reduce(
                    (sum, order) => sum + order.discount_total,
                    0
                ),
                total_revenue: orders.reduce(
                    (sum, order) => sum + order.order_total,
                    0
                ),
                orders
            };
        }
    }));

    const promotion_product_analysis = defineTool((z) => ({
        name: "promotion_product_analysis",
        description:
            "Analyze which products customers buy when they use promotions. Shows product performance during promotional periods.",
        inputSchema: {
            start: z.string().datetime().optional(),
            end: z.string().datetime().optional(),
            start_date: z.string().datetime().optional(),
            end_date: z.string().datetime().optional(),
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional(),
            promotion_code: z.string().optional()
        },
        handler: async (input) => {
            // Coerce date range
            const { start: coercedStart, end: coercedEnd } = coerceRange(input);
            const start = coercedStart || defaultDateRange.start;
            const end = coercedEnd || defaultDateRange.end;
            const promotion_code = input.promotion_code as string | undefined;

            const products = await promotionAnalytics.getPromotionProductStats(
                start,
                end,
                promotion_code
            );

            return {
                start,
                end,
                promotion_code,
                total_products: products.length,
                total_quantity_sold: products.reduce(
                    (sum, p) => sum + p.total_quantity_sold,
                    0
                ),
                total_revenue: products.reduce(
                    (sum, p) => sum + p.total_revenue,
                    0
                ),
                products
            };
        }
    }));

    const promotions_summary = defineTool((z) => ({
        name: "promotions_summary",
        description:
            "Get an overview of all promotion usage in a date range. Shows summary statistics about promotional orders.",
        inputSchema: {
            start: z.string().datetime().optional(),
            end: z.string().datetime().optional(),
            start_date: z.string().datetime().optional(),
            end_date: z.string().datetime().optional(),
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional()
        },
        handler: async (input) => {
            // Coerce date range
            const { start: coercedStart, end: coercedEnd } = coerceRange(input);
            const start = coercedStart || defaultDateRange.start;
            const end = coercedEnd || defaultDateRange.end;

            const summary = await promotionAnalytics.getPromotionsSummary(
                start,
                end
            );

            return {
                start,
                end,
                summary
            };
        }
    }));

    const promotion_products_performance = defineTool((z) => ({
        name: "promotion_products_performance",
        description:
            "Analyze product performance during promotional periods. Find best and worst performing products when customers use discounts. Can sort by quantity sold, revenue, or number of orders.",
        inputSchema: {
            start: z.string().datetime().optional(),
            end: z.string().datetime().optional(),
            start_date: z.string().datetime().optional(),
            end_date: z.string().datetime().optional(),
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional(),
            sort_by: z
                .enum(["quantity", "revenue", "orders"])
                .default("quantity"),
            sort_order: z.enum(["asc", "desc"]).default("desc"),
            limit: z.number().int().positive().max(100).default(20)
        },
        handler: async (input) => {
            // Coerce date range
            const { start: coercedStart, end: coercedEnd } = coerceRange(input);
            const start = coercedStart || defaultDateRange.start;
            const end = coercedEnd || defaultDateRange.end;
            const sort_by = input.sort_by as "quantity" | "revenue" | "orders";
            const sort_order = input.sort_order as "asc" | "desc";
            const limit = input.limit as number;

            const products =
                await promotionAnalytics.getProductsByPromotionPerformance(
                    start,
                    end,
                    sort_by,
                    sort_order,
                    limit
                );

            return {
                start,
                end,
                sort_by,
                sort_order,
                limit,
                total_products: products.length,
                products
            };
        }
    }));

    return [
        orders_with_promotions,
        promotion_product_analysis,
        promotions_summary,
        promotion_products_performance
    ];
}
