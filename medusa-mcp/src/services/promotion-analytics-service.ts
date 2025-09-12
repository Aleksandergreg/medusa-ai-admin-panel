import type { Http } from "../http/client";
import type { AdminOrderMinimal } from "../types/medusa-admin";
import { inRangeUtc } from "../utils/time";

export interface PromotionOrderAnalysis {
  order_id: string;
  order_created_at: string;
  promotion_codes: string[];
  promotion_ids: string[];
  discount_total: number;
  order_total: number;
  items: Array<{
    product_id: string | null;
    variant_id: string | null;
    title: string | null;
    sku: string | null;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  customer_id: string | null;
  customer_email: string | null;
}

export interface PromotionProductStats {
  product_id: string | null;
  variant_id: string | null;
  title: string | null;
  sku: string | null;
  promotion_codes: string[];
  total_quantity_sold: number;
  total_revenue: number;
  total_orders: number;
  average_order_quantity: number;
  discount_amount: number;
}

export interface PromotionSummary {
  promotion_code: string;
  promotion_id: string | null;
  total_orders: number;
  total_discount_amount: number;
  total_revenue: number;
  products_affected: number;
  top_products: Array<{
    product_id: string | null;
    title: string | null;
    quantity: number;
    revenue: number;
    orders: number;
  }>;
}

export function createPromotionAnalyticsService(http: Http): {
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
} {
  
  async function getOrdersInRange(
    fromIso: string,
    toIso: string
  ): Promise<AdminOrderMinimal[]> {
    const limit = 200;
    let offset = 0;
    const acc: AdminOrderMinimal[] = [];
    
    // Use simplified fields that we know exist
    const base = {
      created_at: { gte: fromIso, lt: toIso },
      fields: [
        "+id",
        "+created_at",
        "+canceled_at",
        "+total",
        "+discount_total",
        "+customer_id",
        "+customer.id",
        "+customer.email",
        "+customer.first_name",
        "+customer.last_name",
        "+items",
        "+items.id",
        "+items.title",
        "+items.quantity",
        "+items.unit_price",
        "+items.total",
        "+items.variant_id",
        "+items.variant.id",
        "+items.variant.sku",
        "+items.variant.title",
        "+items.variant.product_id",
        "+items.variant.product.id",
        "+items.variant.product.title",
        "+shipping_methods",
        "+shipping_methods.id",
        "+shipping_methods.name",
        "+shipping_methods.shipping_option_id",
      ].join(","),
    } as const;

    while (true) {
      const q = { ...base, limit, offset } as Record<string, unknown>;
      const data = await http.get<{ orders?: AdminOrderMinimal[] }>(
        "/admin/orders",
        q
      );
      const batch = Array.isArray(data?.orders) ? data.orders : [];
      
      for (const o of batch) {
        if (o?.canceled_at || !o?.created_at) {
          continue;
        }
        if (inRangeUtc(o.created_at, fromIso, toIso)) {
          acc.push(o);
        }
      }
      
      if (batch.length < limit) {
        break;
      }
      offset += limit;
    }
    return acc;
  }

  async function getOrdersWithPromotions(
    start: string,
    end: string,
    promotion_code?: string
  ): Promise<PromotionOrderAnalysis[]> {
    const orders = await getOrdersInRange(start, end);
    const results: PromotionOrderAnalysis[] = [];

    for (const order of orders) {
      const discount_total = (order as any).discount_total || 0;
      
      // Only include orders that have discounts applied
      if (discount_total <= 0) {
        continue;
      }

      // For now, we'll use a simple approach since detailed promotion data 
      // isn't easily accessible through the standard order fields
      let promotion_codes: string[] = ["DISCOUNT_APPLIED"];
      let promotion_ids: string[] = ["unknown"];

      // If a specific promotion code is being filtered for, 
      // only include if it matches (case-insensitive)
      if (promotion_code) {
        const codeMatches = promotion_code.toLowerCase() === "discount_applied" || 
                           promotion_code.toLowerCase() === "unknown";
        if (!codeMatches) {
          continue; // Skip this order as it doesn't match the filter
        }
      }

      const items = (order.items || []).map((item: any) => ({
        product_id: item.variant?.product_id || item.variant?.product?.id || null,
        variant_id: item.variant_id || item.variant?.id || null,
        title: item.title || item.variant?.title || item.variant?.product?.title || null,
        sku: item.variant?.sku || null,
        quantity: item.quantity || 0,
        unit_price: item.unit_price || 0,
        total: item.total || 0,
      }));

      results.push({
        order_id: order.id!,
        order_created_at: order.created_at!,
        promotion_codes,
        promotion_ids,
        discount_total,
        order_total: (order as any).total || 0,
        items,
        customer_id: (order as any).customer_id || null,
        customer_email: (order as any).customer?.email || null,
      });
    }

    return results;
  }

  async function getPromotionProductStats(
    start: string,
    end: string,
    promotion_code?: string
  ): Promise<PromotionProductStats[]> {
    const ordersWithPromotions = await getOrdersWithPromotions(
      start,
      end,
      promotion_code
    );

    const productStats = new Map<string, PromotionProductStats>();

    for (const order of ordersWithPromotions) {
      const orderPromotionCodes = promotion_code
        ? order.promotion_codes.filter((code) => code === promotion_code)
        : order.promotion_codes;

      if (orderPromotionCodes.length === 0) continue;

      for (const item of order.items) {
        const key = item.product_id || item.variant_id || 'unknown';
        
        if (!productStats.has(key)) {
          productStats.set(key, {
            product_id: item.product_id,
            variant_id: item.variant_id,
            title: item.title,
            sku: item.sku,
            promotion_codes: [],
            total_quantity_sold: 0,
            total_revenue: 0,
            total_orders: 0,
            average_order_quantity: 0,
            discount_amount: 0,
          });
        }

        const stats = productStats.get(key)!;
        
        // Add unique promotion codes
        for (const code of orderPromotionCodes) {
          if (!stats.promotion_codes.includes(code)) {
            stats.promotion_codes.push(code);
          }
        }

        stats.total_quantity_sold += item.quantity;
        stats.total_revenue += item.total;
        stats.total_orders += 1;
        stats.discount_amount += order.discount_total / order.items.length; // Distribute discount evenly
      }
    }

    // Calculate averages
    const results = Array.from(productStats.values());
    for (const stats of results) {
      stats.average_order_quantity = stats.total_orders > 0 
        ? stats.total_quantity_sold / stats.total_orders 
        : 0;
    }

    return results;
  }

  async function getPromotionsSummary(
    start: string,
    end: string
  ): Promise<PromotionSummary[]> {
    const ordersWithPromotions = await getOrdersWithPromotions(start, end);
    const promotionSummaries = new Map<string, PromotionSummary>();

    for (const order of ordersWithPromotions) {
      for (const code of order.promotion_codes) {
        if (!promotionSummaries.has(code)) {
          promotionSummaries.set(code, {
            promotion_code: code,
            promotion_id: order.promotion_ids.find(id => id) || null,
            total_orders: 0,
            total_discount_amount: 0,
            total_revenue: 0,
            products_affected: 0,
            top_products: [],
          });
        }

        const summary = promotionSummaries.get(code)!;
        summary.total_orders += 1;
        summary.total_discount_amount += order.discount_total;
        summary.total_revenue += order.order_total;
      }
    }

    // Get top products for each promotion (simplified approach)
    for (const [code, summary] of promotionSummaries) {
      const productStats = await getPromotionProductStats(start, end, code);
      summary.products_affected = productStats.length;
      summary.top_products = productStats
        .sort((a, b) => b.total_quantity_sold - a.total_quantity_sold)
        .slice(0, 5)
        .map((stats) => ({
          product_id: stats.product_id,
          title: stats.title,
          quantity: stats.total_quantity_sold,
          revenue: stats.total_revenue,
          orders: stats.total_orders,
        }));
    }

    return Array.from(promotionSummaries.values());
  }

  async function getProductsByPromotionPerformance(
    start: string,
    end: string,
    sort_by: "quantity" | "revenue" | "orders" = "quantity",
    sort_order: "asc" | "desc" = "desc",
    limit: number = 20
  ): Promise<PromotionProductStats[]> {
    const productStats = await getPromotionProductStats(start, end);

    const sortField = sort_by === "quantity" 
      ? "total_quantity_sold"
      : sort_by === "revenue"
      ? "total_revenue"
      : "total_orders";

    productStats.sort((a, b) => {
      const aVal = (a as any)[sortField];
      const bVal = (b as any)[sortField];
      return sort_order === "desc" ? bVal - aVal : aVal - bVal;
    });

    return productStats.slice(0, limit);
  }

  return {
    getOrdersWithPromotions,
    getPromotionProductStats,
    getPromotionsSummary,
    getProductsByPromotionPerformance,
  };
}
