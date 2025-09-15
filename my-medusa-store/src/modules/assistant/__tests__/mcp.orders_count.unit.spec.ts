/**
 * Tool-level test against medusa-mcp's compiled analytics tool factory.
 * Stubs the analytics service and verifies the handler returns the expected MCP envelope.
 */
import path from "node:path";

describe("medusa-mcp analytics orders_count tool", () => {
  const factoryPath = path.resolve(process.cwd(), "../medusa-mcp/dist/tools/analytics-tool-factory.js");

  it("returns count using stubbed analytics service", async () => {
    // Dynamically import the factory from the sibling package
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAnalyticsTools } = require(factoryPath);

    const analytics = {
      ordersCount: jest.fn().mockResolvedValue(8),
    };

    const tools = createAnalyticsTools(analytics);
    const tool = tools.find((t: any) => t.name === "orders_count");
    expect(tool).toBeTruthy();

    const input = { start: "2025-07-01T00:00:00.000Z", end: "2025-08-01T00:00:00.000Z" };
    const result = await tool.handler(input);

    expect(analytics.ordersCount).toHaveBeenCalledWith(input.start, input.end);
    expect(result?.content?.[0]?.type).toBe("text");

    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({ start: input.start, end: input.end, count: 8 });
  });

  it("accepts alias keys ('from','to') for range", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAnalyticsTools } = require(factoryPath);
    const analytics = {
      ordersCount: jest.fn().mockResolvedValue(5),
    };
    const tools = createAnalyticsTools(analytics);
    const tool = tools.find((t: any) => t.name === "orders_count");

    const out = await tool.handler({ from: "2025-07-01T00:00:00.000Z", to: "2025-07-15T00:00:00.000Z" });
    const payload = JSON.parse(out.content[0].text);
    expect(payload.count).toBe(5);
  });
});

