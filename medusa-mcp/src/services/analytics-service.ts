import type {
  AdminOrderMinimal,
  VariantResolution,
} from "../types/medusa-admin";

import type { OrdersRepo, VariantsRepo } from "../types/analytics-service";

const toNum = (x: unknown): number =>
  typeof x === "number" && Number.isFinite(x) ? x : Number(x) || 0;

export function createAnalyticsService(
  orders: OrdersRepo,
  variants: VariantsRepo
): {
  ordersCount: (start: string, end: string) => Promise<number>;
  salesAggregate: (params: {
    start: string;
    end: string;
    group_by: "product" | "variant" | "shipping";
    metric: "quantity" | "revenue" | "orders";
    limit?: number;
    sort?: "asc" | "desc";
  }) => Promise<
    Array<{
      product_id: string | null;
      variant_id: string | null;
      sku: string | null;
      title: string | null;
      shipping_method_id?: string | null;
      shipping_option_id?: string | null;
      quantity: number;
      revenue: number;
      orders: number;
      value: number;
    }>
  >;
  ordersStatusCount: (params: {
    start?: string;
    end?: string;
    payment_status?: string[];
    fulfillment_status?: string[];
    include_canceled?: boolean;
  }) => Promise<{
    total: number;
    breakdown: Array<{
      payment_status: string | null;
      fulfillment_status: string | null;
      count: number;
    }>;
  }>;
} {
  async function ordersCount(start: string, end: string): Promise<number> {
    const list = await orders.listInRange(start, end);
    return list.length;
  }

  async function salesAggregate(params: {
    start: string;
    end: string;
    group_by: "product" | "variant" | "shipping";
    metric: "quantity" | "revenue" | "orders";
    limit?: number;
    sort?: "asc" | "desc";
  }) {
    const { start, end, group_by, metric, limit = 5, sort = "desc" } = params;
    const list = await orders.withItems(start, end);

    // Product/Variant aggregation
    const agg = new Map<
      string,
      {
        product_id?: string;
        variant_id?: string;
        sku?: string | null;
        title?: string | null;
        quantity: number;
        revenue: number;
        orders: Set<string>;
      }
    >();

    if (group_by === "shipping") {
      const shipAgg = new Map<
        string,
        {
          shipping_method_id?: string | null;
          shipping_option_id?: string | null;
          title?: string | null;
          revenue: number;
          orders: Set<string>;
        }
      >();
      for (const o of list) {
        const oid = o.id ?? "";
        const methods = Array.isArray((o as any).shipping_methods)
          ? (o as any).shipping_methods
          : [];
        for (const sm of methods) {
          // Prefer grouping by shipping_option_id if available, else by a stable name, else by method id
          const smName: string | null =
            (sm as any).name ??
            (sm as any).detail?.name ??
            (sm as any).detail?.label ??
            (sm as any).shipping_option?.name ??
            null;
          const key =
            (sm as any).shipping_option_id || smName || (sm as any).id;
          if (!key) {
            continue;
          }
          const name: string | null = smName;
          const shipping_method_id: string | null = (sm as any).id ?? null;
          const shipping_option_id: string | null =
            (sm as any).shipping_option_id ??
            (sm as any).shipping_option?.id ??
            null;
          const amount =
            typeof (sm as any).total === "number"
              ? (sm as any).total
              : typeof (sm as any).subtotal === "number"
              ? (sm as any).subtotal
              : typeof (sm as any).amount === "number"
              ? (sm as any).amount
              : 0;

          const row = shipAgg.get(key) ?? {
            title: null,
            revenue: 0,
            orders: new Set<string>(),
            shipping_method_id: null,
            shipping_option_id: null,
          };
          row.revenue += amount;
          if (oid) {
            row.orders.add(oid);
          }
          row.title ??= name;
          row.shipping_method_id ??= shipping_method_id;
          row.shipping_option_id ??= shipping_option_id;
          shipAgg.set(key, row);
        }
      }

      const rows = [...shipAgg.values()].map((r) => ({
        product_id: null,
        variant_id: null,
        sku: null,
        title: r.title ?? null,
        shipping_method_id: r.shipping_method_id ?? null,
        shipping_option_id: r.shipping_option_id ?? null,
        quantity: 0,
        revenue: r.revenue,
        orders: r.orders.size,
        value: metric === "revenue" ? r.revenue : r.orders.size,
      }));

      rows.sort((a, b) =>
        sort === "desc" ? b.value - a.value : a.value - b.value
      );
      return rows.slice(0, Math.max(1, Math.min(50, limit)));
    }

    for (const o of list) {
      const oid = o.id ?? "";
      for (const it of o.items ?? []) {
        const qty = toNum(it.quantity);
        if (qty <= 0) {
          continue;
        }
        const price =
          typeof it.total === "number" ? it.total : toNum(it.unit_price) * qty;

        const variant_id =
          (it as any).variant_id ?? it?.variant?.id ?? undefined;
        let product_id =
          (it as any).product_id ??
          it?.variant?.product_id ??
          it?.variant?.product?.id ??
          undefined;

        if (group_by === "product" && !product_id && variant_id) {
          const resolved = await variants.resolve(variant_id);
          product_id = resolved.product_id ?? product_id;
          (it as any).title ??= resolved.title;
          (it as any).sku ??= resolved.sku;
        }

        const sku = (it as any).sku ?? it?.variant?.sku ?? null;
        const title =
          (it as any).title ??
          it?.variant?.title ??
          it?.variant?.product?.title ??
          null;

        const key = group_by === "variant" ? variant_id : product_id;
        if (!key) {
          continue;
        }

        const row = agg.get(key) ?? {
          quantity: 0,
          revenue: 0,
          orders: new Set<string>(),
        };
        row.quantity += qty;
        row.revenue += price;
        if (oid) {
          row.orders.add(oid);
        }
        row.product_id ??= product_id;
        row.variant_id ??= variant_id;
        row.sku ??= sku;
        row.title ??= title;
        agg.set(key, row);
      }
    }

    const rows = [...agg.values()].map((r) => ({
      product_id: r.product_id ?? null,
      variant_id: r.variant_id ?? null,
      sku: r.sku ?? null,
      title: r.title ?? null,
      shipping_method_id: null,
      shipping_option_id: null,
      quantity: r.quantity,
      revenue: r.revenue,
      orders: r.orders.size,
      value:
        metric === "quantity"
          ? r.quantity
          : metric === "revenue"
          ? r.revenue
          : r.orders.size,
    }));

    rows.sort((a, b) =>
      sort === "desc" ? b.value - a.value : a.value - b.value
    );
    return rows.slice(0, Math.max(1, Math.min(50, limit)));
  }

  async function ordersStatusCount(params: {
    start?: string;
    end?: string;
    payment_status?: string[];
    fulfillment_status?: string[];
    include_canceled?: boolean;
  }): Promise<{
    total: number;
    breakdown: Array<{
      payment_status: string | null;
      fulfillment_status: string | null;
      count: number;
    }>;
  }> {
    const {
      start,
      end,
      payment_status,
      fulfillment_status,
      include_canceled = false,
    } = params;

    // Get orders in the date range (or all orders if no range specified)
    const ordersList =
      start && end
        ? await orders.listInRange(start, end)
        : await orders.listInRange(
            "1970-01-01T00:00:00Z",
            "2099-12-31T23:59:59Z"
          );

    // Normalize status values to handle different API formats
    const normalizePaymentStatus = (status: unknown): string | null => {
      if (!status) {
        return null;
      }
      const str = String(status).toLowerCase().trim();
      if (str.includes("not paid") || str.includes("not_paid")) {
        return "not_paid";
      }
      if (str.includes("awaiting")) {
        return "awaiting";
      }
      if (str.includes("captured")) {
        return "captured";
      }
      if (str.includes("completed")) {
        return "completed";
      }
      if (
        str.includes("partially_refunded") ||
        str.includes("partially refunded")
      ) {
        return "partially_refunded";
      }
      if (str.includes("refunded")) {
        return "refunded";
      }
      if (str.includes("canceled") || str.includes("cancelled")) {
        return "canceled";
      }
      if (str.includes("requires_action")) {
        return "requires_action";
      }
      return String(status);
    };

    const normalizeFulfillmentStatus = (status: unknown): string | null => {
      if (!status) {
        return null;
      }
      const str = String(status).toLowerCase().trim();
      if (str.includes("not fulfilled") || str.includes("not_fulfilled")) {
        return "not_fulfilled";
      }
      if (
        str.includes("partially fulfilled") ||
        str.includes("partially_fulfilled")
      ) {
        return "partially_fulfilled";
      }
      if (
        str.includes("partially shipped") ||
        str.includes("partially_shipped")
      ) {
        return "partially_shipped";
      }
      if (
        str.includes("partially delivered") ||
        str.includes("partially_delivered")
      ) {
        return "partially_delivered";
      }
      if (
        str.includes("partially returned") ||
        str.includes("partially_returned")
      ) {
        return "partially_returned";
      }
      if (str.includes("delivered")) {
        return "delivered";
      }
      if (str.includes("shipped")) {
        return "shipped";
      }
      if (str.includes("returned")) {
        return "returned";
      }
      if (str.includes("fulfilled")) {
        return "fulfilled";
      }
      if (str.includes("canceled") || str.includes("cancelled")) {
        return "canceled";
      }
      return String(status);
    };

    // Filter orders by status criteria
    const filteredOrders = ordersList.filter((order) => {
      // Extract and normalize status fields from order
      const rawPaymentStatus = (order as Record<string, unknown>)
        .payment_status;
      const rawFulfillmentStatus = (order as Record<string, unknown>)
        .fulfillment_status;
      const orderCanceledAt = (order as Record<string, unknown>).canceled_at;

      const orderPaymentStatus = normalizePaymentStatus(rawPaymentStatus);
      const orderFulfillmentStatus =
        normalizeFulfillmentStatus(rawFulfillmentStatus);

      // Skip canceled orders unless explicitly included
      if (!include_canceled && orderCanceledAt) {
        return false;
      }

      // Filter by payment status if specified
      if (payment_status && payment_status.length > 0) {
        if (
          !orderPaymentStatus ||
          !payment_status.includes(orderPaymentStatus)
        ) {
          return false;
        }
      }

      // Filter by fulfillment status if specified
      if (fulfillment_status && fulfillment_status.length > 0) {
        if (
          !orderFulfillmentStatus ||
          !fulfillment_status.includes(orderFulfillmentStatus)
        ) {
          return false;
        }
      }

      return true;
    });

    // Create breakdown by status combinations
    const statusMap = new Map<string, number>();

    filteredOrders.forEach((order) => {
      const rawPaymentStatus = (order as Record<string, unknown>)
        .payment_status;
      const rawFulfillmentStatus = (order as Record<string, unknown>)
        .fulfillment_status;

      const paymentStatus = normalizePaymentStatus(rawPaymentStatus);
      const fulfillmentStatus =
        normalizeFulfillmentStatus(rawFulfillmentStatus);
      const key = `${paymentStatus}|${fulfillmentStatus}`;

      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    });

    // Convert to breakdown array
    const breakdown = Array.from(statusMap.entries()).map(([key, count]) => {
      const [paymentStatus, fulfillmentStatus] = key.split("|");
      return {
        payment_status: paymentStatus === "null" ? null : paymentStatus,
        fulfillment_status:
          fulfillmentStatus === "null" ? null : fulfillmentStatus,
        count,
      };
    });

    return {
      total: filteredOrders.length,
      breakdown,
    };
  }

  return { ordersCount, salesAggregate, ordersStatusCount };
}
