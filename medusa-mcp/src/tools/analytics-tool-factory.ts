import { defineTool } from "../utils/define-tools";

type AnalyticsService = {
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
};

export function createAnalyticsTools(
  analytics: AnalyticsService
): Array<ReturnType<typeof defineTool>> {
  // alias coercers
  const coerceRange = (
    input: Record<string, unknown>
  ): { start?: string; end?: string } => {
    const s =
      (input.start as string | undefined) ||
      (input.start_date as string | undefined) ||
      (input.from as string | undefined);
    const e =
      (input.end as string | undefined) ||
      (input.end_date as string | undefined) ||
      (input.to as string | undefined);
    return { start: s, end: e };
  };

  const coerceGroupBy = (
    input: Record<string, unknown>
  ): "product" | "variant" | "shipping" | undefined => {
    const raw =
      (input.group_by as string | undefined) ||
      (input.grouping as string | undefined) ||
      (input.group as string | undefined) ||
      (input.groupby as string | undefined);
    if (!raw) {
      return undefined;
    }
    const v = String(raw).toLowerCase().trim();
    if (v.startsWith("product")) {
      return "product";
    }
    if (v.startsWith("variant")) {
      return "variant";
    }
    if (
      v.startsWith("shipping") ||
      v.startsWith("shipping_method") ||
      v.startsWith("shipping-method") ||
      v.startsWith("shipping option") ||
      v.startsWith("shipping_option")
    ) {
      return "shipping";
    }
    return undefined;
  };

  const coerceMetric = (
    input: Record<string, unknown>
  ): "quantity" | "revenue" | "orders" | undefined => {
    const raw =
      (input.metric as string | undefined) ||
      (input.measure as string | undefined) ||
      (input.by as string | undefined) ||
      (input.agg as string | undefined) ||
      (input.aggregate as string | undefined);
    if (!raw) {
      return undefined;
    }
    const v = String(raw).toLowerCase().trim();
    if (["quantity", "qty", "units", "unit"].includes(v)) {
      return "quantity";
    }
    if (["orders", "order", "order_count", "num_orders", "count"].includes(v)) {
      return "orders";
    }
    if (
      [
        "revenue",
        "sales",
        "amount",
        "gmv",
        "turnover",
        "sum",
        "total",
        "total_sales",
        "sum_sales",
      ].includes(v)
    ) {
      return "revenue";
    }
    return undefined;
  };

  const orders_count = defineTool((z) => ({
    name: "orders_count",
    description:
      "Count non-canceled orders in a UTC date range [start, end). Returns { count }.",
    inputSchema: {
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const { start, end } = coerceRange(input);
      if (!start || !end) {
        throw new Error(
          "Missing required range. Provide (start,end) or (start_date,end_date) or (from,to) as ISO date-times."
        );
      }
      const schema = z.object({
        start: z.string().datetime(),
        end: z.string().datetime(),
      });
      const parsed = schema.safeParse({ start, end });
      if (!parsed.success) {
        throw new Error(`Invalid input: ${parsed.error.message}`);
      }
      const count = await analytics.ordersCount(start, end);
      return { start, end, count };
    },
  }));

  const sales_aggregate = defineTool((z) => ({
    name: "sales_aggregate",
    description:
      "Aggregate sales in a UTC date range with grouping and metric. Group by: product, variant, or shipping (method). Metric accepts: quantity (qty/units), revenue (sales/amount/total/sum), orders (count).",
    inputSchema: {
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),

      // Accept any string for group_by and metric; we coerce/validate in handler
      group_by: z.string().optional(),
      grouping: z.string().optional(),
      group: z.string().optional(),
      groupby: z.string().optional(),

      metric: z.string().optional(),
      measure: z.string().optional(),
      by: z.string().optional(),
      agg: z.string().optional(),
      aggregate: z.string().optional(),

      limit: z.number().int().min(1).max(50).default(5),
      sort: z.union([z.literal("desc"), z.literal("asc")]).default("desc"),
      order: z.string().optional(),
      order_by: z.string().optional(),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const rng = coerceRange(input);
      if (!rng.start || !rng.end) {
        throw new Error(
          "Missing required range. Provide (start,end) or (start_date,end_date) or (from,to) as ISO date-times."
        );
      }

      const group_by = coerceGroupBy(input);
      const metric = coerceMetric(input);
      if (!group_by) {
        throw new Error(
          "Missing or invalid grouping. Use 'group_by' (or 'grouping') with 'product', 'variant', or 'shipping' (method)."
        );
      }
      if (!metric) {
        throw new Error(
          "Missing or invalid metric. Use 'metric' (or 'measure') with 'quantity'|'revenue'|'orders' (aliases: qty/units, sales/amount/total/sum, count)."
        );
      }

      const limit =
        typeof input.limit === "number" && Number.isInteger(input.limit)
          ? Math.max(1, Math.min(50, input.limit))
          : 5;
      // Sort coercion: support 'order' and 'order_by' like "quantity asc"
      const sortToken = ((): string => {
        const o = (input.order as string | undefined)?.toLowerCase();
        const ob = (input.order_by as string | undefined)?.toLowerCase();
        if (o === "asc" || o === "desc") {
          return o;
        }
        if (ob?.includes("asc")) {
          return "asc";
        }
        if (ob?.includes("desc")) {
          return "desc";
        }
        return String(input.sort ?? "desc").toLowerCase();
      })();
      const sort = (sortToken === "asc" ? "asc" : "desc") as "asc" | "desc";

      const schema = z.object({
        start: z.string().datetime(),
        end: z.string().datetime(),
        group_by: z.union([
          z.literal("product"),
          z.literal("variant"),
          z.literal("shipping"),
        ]),
        metric: z.union([
          z.literal("quantity"),
          z.literal("revenue"),
          z.literal("orders"),
        ]),
        limit: z.number().int().min(1).max(50),
        sort: z.union([z.literal("desc"), z.literal("asc")]),
      });
      const parsed = schema.safeParse({
        start: rng.start,
        end: rng.end,
        group_by,
        metric,
        limit,
        sort,
      });
      if (!parsed.success) {
        throw new Error(`Invalid input: ${parsed.error.message}`);
      }

      const rows = await analytics.salesAggregate({
        start: parsed.data.start,
        end: parsed.data.end,
        group_by: parsed.data.group_by,
        metric: parsed.data.metric,
        limit: parsed.data.limit,
        sort: parsed.data.sort,
      });

      const titleGroup =
        parsed.data.group_by === "shipping"
          ? "shipping methods"
          : `${parsed.data.group_by}s`;
      return {
        start: parsed.data.start,
        end: parsed.data.end,
        group_by: parsed.data.group_by,
        metric: parsed.data.metric,
        results: rows,
        xKey: "rank",
        yKey: "value",
        title: `Top ${titleGroup} by ${parsed.data.metric}`,
      };
    },
  }));

  const orders_status_analysis = defineTool((z) => ({
    name: "orders_status_analysis",
    description:
      "Universal order analysis tool for all payment and fulfillment status combinations. " +
      "PAYMENT STATUSES: not_paid, awaiting, captured, completed, partially_refunded, refunded, canceled, requires_action. " +
      "FULFILLMENT STATUSES: not_fulfilled, partially_fulfilled, fulfilled, partially_shipped, shipped, partially_returned, returned, canceled, requires_action. " +
      "IMPORTANT: When user asks about 'refunds', consider BOTH 'refunded' AND 'partially_refunded'. When asked about 'failed payments', consider BOTH 'failed' AND 'not_paid'. When asked about 'paid orders', use ['captured', 'completed']. " +
      "Examples: unpaid orders (payment_status: 'not_paid'), delivered/shipped orders (fulfillment_status: ['shipped', 'fulfilled']), paid unfulfilled orders (payment_status: ['captured','completed'] + fulfillment_status: ['not_fulfilled','partially_fulfilled']).",
    inputSchema: {
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),

      payment_status: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Filter by payment status. Available values: not_paid (items not paid), awaiting (awaiting payment), captured (payment captured), completed (payment completed), partially_refunded (partially refunded), refunded (fully refunded), canceled (payment canceled), requires_action (payment requires action). IMPORTANT: For refund queries, use BOTH 'refunded' and 'partially_refunded'. For failed payment queries, use BOTH 'failed' and 'not_paid'. Can be a string or array."
        ),
      payment_statuses: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("Alias for payment_status"),

      fulfillment_status: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Filter by fulfillment status. Available values: not_fulfilled (items not fulfilled), partially_fulfilled (some items fulfilled), fulfilled (all items fulfilled), partially_shipped (some items shipped), shipped (all items shipped), partially_returned (some items returned), returned (all items returned), canceled (fulfillment canceled), requires_action (fulfillment requires action). Can be a string or array."
        ),
      fulfillment_statuses: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("Alias for fulfillment_status"),

      include_canceled: z
        .boolean()
        .default(false)
        .describe("Include canceled orders in analysis"),

      group_by_status: z
        .boolean()
        .default(true)
        .describe("Group results by status combinations"),

      // Convenience shortcuts for common queries
      preset: z
        .enum([
          "problematic_payments",
          "unpaid_orders",
          "paid_unfulfilled",
          "all_unfulfilled",
          "delivered_orders",
          "shipped_orders",
          "returned_orders",
        ])
        .optional()
        .describe(
          "Use preset filters: problematic_payments (not_paid,awaiting,canceled,requires_action), unpaid_orders (not_paid), paid_unfulfilled (captured/completed + not_fulfilled/partially_fulfilled), all_unfulfilled (not_fulfilled/partially_fulfilled), delivered_orders (fulfilled), shipped_orders (shipped/partially_shipped), returned_orders (returned/partially_returned)"
        ),

      include_partial: z
        .boolean()
        .default(true)
        .describe(
          "For unfulfilled queries, include partially_fulfilled orders"
        ),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const { start, end } = coerceRange(input);

      // Extract status filters and normalize to arrays
      const normalizeStatus = (value: unknown): string[] | undefined => {
        if (!value) {
          return undefined;
        }
        if (typeof value === "string") {
          return [value];
        }
        if (Array.isArray(value)) {
          return value;
        }
        return undefined;
      };

      // Handle preset configurations
      let paymentStatuses =
        normalizeStatus(input.payment_status) ||
        normalizeStatus(input.payment_statuses);
      let fulfillmentStatuses =
        normalizeStatus(input.fulfillment_status) ||
        normalizeStatus(input.fulfillment_statuses);

      const preset = input.preset as string | undefined;
      const includePartial = input.include_partial !== false;

      // Apply preset filters
      if (preset) {
        switch (preset) {
          case "problematic_payments":
            paymentStatuses = [
              "not_paid",
              "awaiting",
              "canceled",
              "requires_action",
            ];
            break;
          case "unpaid_orders":
            paymentStatuses = ["not_paid"];
            break;
          case "paid_unfulfilled":
            paymentStatuses = ["captured", "completed"];
            fulfillmentStatuses = includePartial
              ? ["not_fulfilled", "partially_fulfilled"]
              : ["not_fulfilled"];
            break;
          case "all_unfulfilled":
            fulfillmentStatuses = includePartial
              ? ["not_fulfilled", "partially_fulfilled"]
              : ["not_fulfilled"];
            break;
          case "delivered_orders":
            fulfillmentStatuses = ["fulfilled"];
            break;
          case "shipped_orders":
            fulfillmentStatuses = includePartial
              ? ["shipped", "partially_shipped"]
              : ["shipped"];
            break;
          case "returned_orders":
            fulfillmentStatuses = includePartial
              ? ["returned", "partially_returned"]
              : ["returned"];
            break;
        }
      }

      const includeCanceled = Boolean(input.include_canceled);
      const groupByStatus = input.group_by_status !== false;

      const result = await analytics.ordersStatusCount({
        start,
        end,
        payment_status: paymentStatuses,
        fulfillment_status: fulfillmentStatuses,
        include_canceled: includeCanceled,
      });

      // Generate descriptive title based on filters
      const generateTitle = (): string => {
        if (preset) {
          switch (preset) {
            case "problematic_payments":
              return "Orders with Problematic Payments (Including Unpaid)";
            case "unpaid_orders":
              return "Unpaid Orders";
            case "paid_unfulfilled":
              return "Paid Orders Not Fulfilled";
            case "all_unfulfilled":
              return "All Orders Not Fulfilled (Any Payment Status)";
            case "delivered_orders":
              return "Orders That Have Been Fulfilled";
            case "shipped_orders":
              return "Orders That Have Been Shipped";
            case "returned_orders":
              return "Orders That Have Been Returned";
          }
        }

        const parts = [];
        if (paymentStatuses?.length) {
          parts.push(`Payment: ${paymentStatuses.join(", ")}`);
        }
        if (fulfillmentStatuses?.length) {
          parts.push(`Fulfillment: ${fulfillmentStatuses.join(", ")}`);
        }
        return parts.length
          ? `Orders - ${parts.join(" | ")}`
          : "Order Status Analysis";
      };

      return {
        start,
        end,
        filters: {
          payment_status: paymentStatuses,
          fulfillment_status: fulfillmentStatuses,
          include_canceled: includeCanceled,
          preset: preset || null,
          include_partial: includePartial,
        },
        total: result.total,
        breakdown: groupByStatus ? result.breakdown : undefined,
        count: result.total,
        title: generateTitle(),
      };
    },
  }));

  return [orders_count, sales_aggregate, orders_status_analysis];
}
