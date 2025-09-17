/**
 * Validates the sales_aggregate MCP tool range coercion logic against the TypeScript source.
 */
import path from "node:path";

describe("medusa-mcp analytics sales_aggregate tool", () => {
  const factoryPath = path.resolve(process.cwd(), "../medusa-mcp/src/tools/analytics-tool-factory.ts");

  afterEach(() => {
    jest.useRealTimers();
  });

  it("normalizes date-only ranges to ISO datetimes", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAnalyticsTools } = require(factoryPath);

    const analytics = {
      salesAggregate: jest.fn().mockResolvedValue([
        {
          product_id: "prod_1",
          variant_id: null,
          sku: "sku_1",
          title: "Test Product",
          quantity: 4,
          revenue: 6000,
          orders: 3,
          value: 4,
        },
      ]),
    };

    const tools = createAnalyticsTools(analytics);
    const tool = tools.find((t: any) => t.name === "sales_aggregate");
    expect(tool).toBeTruthy();

    const output = await tool.handler({
      start_date: "2024-01-01",
      end_date: "2024-01-31",
      group_by: "product",
      metric: "quantity",
    });

    expect(analytics.salesAggregate).toHaveBeenCalledWith({
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-01-31T23:59:59.999Z",
      group_by: "product",
      metric: "quantity",
      limit: 5,
      sort: "desc",
      include_zero: true,
    });

    const payload = JSON.parse(output.content[0].text);
    expect(payload.start).toBe("2024-01-01T00:00:00.000Z");
    expect(payload.end).toBe("2024-01-31T23:59:59.999Z");
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results.length).toBe(1);
  });

  it("defaults to the last 30 days when no range provided", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2025-09-16T15:00:00.000Z"));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAnalyticsTools } = require(factoryPath);

    const analytics = {
      salesAggregate: jest.fn().mockResolvedValue([]),
    };

    const tools = createAnalyticsTools(analytics);
    const tool = tools.find((t: any) => t.name === "sales_aggregate");
    expect(tool).toBeTruthy();

    const result = await tool.handler({ group_by: "product", metric: "quantity" });

    expect(analytics.salesAggregate).toHaveBeenCalledWith({
      start: "2025-08-17T00:00:00.000Z",
      end: "2025-09-16T23:59:59.999Z",
      group_by: "product",
      metric: "quantity",
      limit: 5,
      sort: "desc",
      include_zero: true,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.start).toBe("2025-08-17T00:00:00.000Z");
    expect(payload.end).toBe("2025-09-16T23:59:59.999Z");
  });

  it("passes include_zero=false when explicitly disabled", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAnalyticsTools } = require(factoryPath);

    const analytics = {
      salesAggregate: jest.fn().mockResolvedValue([]),
    };

    const tools = createAnalyticsTools(analytics);
    const tool = tools.find((t: any) => t.name === "sales_aggregate");
    expect(tool).toBeTruthy();

    await tool.handler({
      start_date: "2024-05-01",
      end_date: "2024-05-31",
      group_by: "product",
      metric: "quantity",
      include_zero: false,
    });

    expect(analytics.salesAggregate).toHaveBeenCalledWith({
      start: "2024-05-01T00:00:00.000Z",
      end: "2024-05-31T23:59:59.999Z",
      group_by: "product",
      metric: "quantity",
      limit: 5,
      sort: "desc",
      include_zero: false,
    });
  });
});
