import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { shouldRunPgIntegration } from "./_helpers";

import * as path from "node:path";
const plannerPath = path.resolve(process.cwd(), "src/modules/assistant/planner.ts");
const mcpManagerPath = path.resolve(process.cwd(), "src/lib/mcp/manager.ts");

let toolCalls: Array<{ name: string; args: any }>;

// Integration app boot + migrations can take >5s in CI
jest.setTimeout(90 * 1000);

// Stub the planner; we'll set distinct responses per test using mock implementation
jest.doMock(plannerPath, () => ({
  __esModule: true,
  planNextStepWithGemini: jest.fn(),
}));

// Stub MCP client to capture calls and return deterministic payloads
jest.doMock(mcpManagerPath, () => ({
  __esModule: true,
  getMcp: jest.fn().mockImplementation(async () => {
    toolCalls = [];
    return {
      listTools: async () => ({
        tools: [
          {
            name: "promotion_product_analysis",
            description: "Analyze which products customers buy when they use promotions",
          },
        ],
      }),
      callTool: async (name: string, args: any) => {
        toolCalls.push({ name, args });

        if (name === "promotion_product_analysis") {
          const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const defaultEnd = new Date().toISOString();

          const start = args?.start || args?.start_date || args?.from || defaultStart;
          const end = args?.end || args?.end_date || args?.to || defaultEnd;
          const promotion_code = args?.promotion_code;

          // If a promotion_code filter is provided, tailor the response
          if (promotion_code === "SAVE20") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    start,
                    end,
                    promotion_code,
                    total_products: 2,
                    total_quantity_sold: 5,
                    total_revenue: 450.0,
                    products: [
                      {
                        product_id: "prod_01",
                        variant_id: "var_01",
                        title: "Discounted Tee",
                        sku: "TEE-SAVE20",
                        promotion_codes: ["SAVE20"],
                        total_quantity_sold: 3,
                        total_revenue: 270.0,
                        total_orders: 2,
                        average_order_quantity: 1.5,
                        discount_amount: 30.0,
                      },
                      {
                        product_id: "prod_02",
                        variant_id: "var_02",
                        title: "Sale Hat",
                        sku: "HAT-SAVE20",
                        promotion_codes: ["SAVE20"],
                        total_quantity_sold: 2,
                        total_revenue: 180.0,
                        total_orders: 2,
                        average_order_quantity: 1.0,
                        discount_amount: 20.0,
                      },
                    ],
                  }),
                },
              ],
            };
          }

          // Default response for no filter
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  start,
                  end,
                  promotion_code: promotion_code || null,
                  total_products: 3,
                  total_quantity_sold: 12,
                  total_revenue: 1200.0,
                  products: [
                    {
                      product_id: "prod_01",
                      variant_id: "var_01",
                      title: "Discounted Tee",
                      sku: "TEE-SAVE20",
                      promotion_codes: ["SAVE20"],
                      total_quantity_sold: 6,
                      total_revenue: 600.0,
                      total_orders: 4,
                      average_order_quantity: 1.5,
                      discount_amount: 60.0,
                    },
                    {
                      product_id: "prod_02",
                      variant_id: "var_02",
                      title: "Sale Hat",
                      sku: "HAT-SAVE20",
                      promotion_codes: ["SAVE20"],
                      total_quantity_sold: 4,
                      total_revenue: 400.0,
                      total_orders: 3,
                      average_order_quantity: 1.33,
                      discount_amount: 40.0,
                    },
                    {
                      product_id: "prod_03",
                      variant_id: "var_03",
                      title: "Clearance Socks",
                      sku: "SOCKS-CLEAR",
                      promotion_codes: ["CLEAR10"],
                      total_quantity_sold: 2,
                      total_revenue: 200.0,
                      total_orders: 2,
                      average_order_quantity: 1.0,
                      discount_amount: 10.0,
                    },
                  ],
                }),
              },
            ],
          };
        }

        // Default
        return { content: [{ type: "text", text: "{}" }] };
      },
    };
  }),
}));

if (shouldRunPgIntegration()) {
  medusaIntegrationTestRunner({
    inApp: true,
    env: {
      STORE_CORS: "*",
      ADMIN_CORS: "*",
      AUTH_CORS: "*",
    },
    testSuite: ({ api, getContainer }) => {
      const attachAdminKey = async () => {
        const { createApiKeysWorkflow } = require("@medusajs/core-flows");
        const container = await getContainer();
        try {
          const { result } = await createApiKeysWorkflow(container).run({
            input: { api_keys: [{ type: "secret", title: "CI Admin Key", created_by: "ci" }] },
          });
          const token = result?.[0]?.token;
          if (!token || !String(token).startsWith("sk_")) {
            throw new Error("Failed to create admin API key for test auth");
          }
          api.defaults.headers.common["Authorization"] = `Basic ${token}`;
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (msg.includes("one active secret key")) {
            // Key already exists (from beforeAll). Keep existing header.
            return;
          }
          throw e;
        }
      };

      beforeAll(async () => {
        await attachAdminKey();
      });

      // medusaIntegrationTestRunner resets DB between tests; refresh key each time
      beforeEach(async () => {
        await attachAdminKey();
      });

      const { planNextStepWithGemini } = require(plannerPath);

      describe("Assistant promotion_product_analysis tool (stubbed MCP)", () => {
        it("uses default date range when none provided", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "promotion_product_analysis",
              tool_args: {}, // No date parameters provided
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "Promotion product analysis complete." });

          const res = await api.post("/admin/assistant", {
            prompt: "Show me products sold with promotions",
            wantsChart: false,
          });

          expect(res.status).toBe(200);

          // Verify the tool was called with no date parameters
          expect(toolCalls?.[0]).toMatchObject({ name: "promotion_product_analysis", args: {} });

          // Verify response has the expected shape and default date range is applied
          expect(res.data?.data).toHaveProperty("start");
          expect(res.data?.data).toHaveProperty("end");
          expect(res.data?.data).toHaveProperty("total_products", 3);
          expect(res.data?.data).toHaveProperty("total_quantity_sold", 12);
          expect(res.data?.data).toHaveProperty("total_revenue", 1200.0);
          expect(Array.isArray(res.data?.data?.products)).toBe(true);
        });

        it("filters by promotion_code when provided", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "promotion_product_analysis",
              tool_args: {
                promotion_code: "SAVE20",
                start: "2024-09-01T00:00:00Z",
                end: "2024-09-30T23:59:59Z",
              },
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "Filtered promotion product analysis." });

          const res = await api.post("/admin/assistant", {
            prompt: "Show me products sold with SAVE20 in September",
            wantsChart: false,
          });

          expect(res.status).toBe(200);

          // Verify the tool was called with promotion_code
          expect(toolCalls?.[0]).toMatchObject({
            name: "promotion_product_analysis",
            args: {
              promotion_code: "SAVE20",
              start: "2024-09-01T00:00:00Z",
              end: "2024-09-30T23:59:59Z",
            },
          });

          expect(res.data?.data).toMatchObject({
            start: "2024-09-01T00:00:00Z",
            end: "2024-09-30T23:59:59Z",
            promotion_code: "SAVE20",
            total_products: 2,
            total_quantity_sold: 5,
            total_revenue: 450.0,
          });

          // Validate product structure
          expect(Array.isArray(res.data?.data?.products)).toBe(true);
          expect(res.data?.data?.products?.length).toBe(2);
          const first = res.data?.data?.products?.[0];
          expect(first).toHaveProperty("product_id");
          expect(first).toHaveProperty("variant_id");
          expect(first).toHaveProperty("title");
          expect(first).toHaveProperty("sku");
          expect(first).toHaveProperty("promotion_codes");
          expect(first).toHaveProperty("total_quantity_sold");
          expect(first).toHaveProperty("total_revenue");
          expect(first).toHaveProperty("total_orders");
          expect(first).toHaveProperty("average_order_quantity");
          expect(first).toHaveProperty("discount_amount");

          // Business logic checks
          expect(typeof first.total_quantity_sold).toBe("number");
          expect(typeof first.total_revenue).toBe("number");
          expect(first.total_revenue).toBeGreaterThan(0);
        });

        it("validates product-level business metrics", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "promotion_product_analysis",
              tool_args: {
                start: "2024-09-01T00:00:00Z",
                end: "2024-09-30T23:59:59Z",
              },
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "Product metrics validated." });

          const res = await api.post("/admin/assistant", {
            prompt: "Validate promotion product metrics for September",
            wantsChart: false,
          });

          expect(res.status).toBe(200);

          expect(toolCalls?.[0]).toMatchObject({
            name: "promotion_product_analysis",
            args: { start: "2024-09-01T00:00:00Z", end: "2024-09-30T23:59:59Z" },
          });

          const products = res.data?.data?.products;
          expect(Array.isArray(products)).toBe(true);
          expect(products?.length).toBeGreaterThan(0);

          const p = products[0];
          // average_order_quantity should equal total_quantity_sold / total_orders (approx)
          expect(p.average_order_quantity).toBeCloseTo(p.total_quantity_sold / p.total_orders, 3);

          // discount_amount should be non-negative and reasonable
          expect(p.discount_amount).toBeGreaterThanOrEqual(0);
          expect(p.discount_amount).toBeLessThanOrEqual(p.total_revenue);
        });
      });
    },
  });
} else {
  describe("Assistant promotion_product_analysis tool (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}
