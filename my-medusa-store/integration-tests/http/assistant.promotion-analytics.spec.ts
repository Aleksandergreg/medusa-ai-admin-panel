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
          { name: "orders_with_promotions", description: "Find all orders where customers used promotions/discounts" },
        ],
      }),
      callTool: async (name: string, args: any) => {
        toolCalls.push({ name, args });
        if (name === "orders_with_promotions") {
          // Default date range is last 30 days when no start/end provided
          const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const defaultEnd = new Date().toISOString();
          
          const start = args?.start || args?.start_date || args?.from || defaultStart;
          const end = args?.end || args?.end_date || args?.to || defaultEnd;
          const promotion_code = args?.promotion_code;
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  start,
                  end,
                  promotion_code,
                  total_orders: 15,
                  total_discount_amount: 250.75,
                  total_revenue: 1875.50,
                  orders: [
                    {
                      order_id: "order_01",
                      order_created_at: "2024-09-01T10:00:00Z",
                      promotion_codes: ["SAVE20"],
                      promotion_ids: ["promo_01"],
                      discount_total: 20.00,
                      order_total: 100.00,
                      items: [
                        {
                          product_id: "prod_01",
                          variant_id: "var_01",
                          title: "Test Product",
                          sku: "TEST-SKU",
                          quantity: 2,
                          unit_price: 50.00,
                          total: 100.00
                        }
                      ],
                      customer_id: "cust_01",
                      customer_email: "customer@example.com"
                    },
                    {
                      order_id: "order_02",
                      order_created_at: "2024-09-02T14:30:00Z",
                      promotion_codes: ["WELCOME10"],
                      promotion_ids: ["promo_02"],
                      discount_total: 15.50,
                      order_total: 139.50,
                      items: [
                        {
                          product_id: "prod_02",
                          variant_id: "var_02",
                          title: "Another Product",
                          sku: "ANOTHER-SKU",
                          quantity: 1,
                          unit_price: 155.00,
                          total: 155.00
                        }
                      ],
                      customer_id: "cust_02",
                      customer_email: "customer2@example.com"
                    }
                  ]
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

      describe("Assistant promotion analytics tools (stubbed MCP)", () => {
        it("should use default date range fallback when no start/end dates provided", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "orders_with_promotions",
              tool_args: {}, // No date parameters provided
            })
            .mockResolvedValueOnce({ 
              action: "final_answer", 
              answer: "Found 15 orders with promotions in the last 30 days." 
            });

          const res = await api.post("/admin/assistant", {
            prompt: "Show me orders with promotions",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          
          // Verify the tool was called with no date parameters
          expect(toolCalls?.[0]).toMatchObject({
            name: "orders_with_promotions",
            args: {},
          });
          
          // Verify response has the expected shape and default date range is applied
          expect(res.data?.data).toHaveProperty("start");
          expect(res.data?.data).toHaveProperty("end");
          expect(res.data?.data).toHaveProperty("total_orders", 15);
          expect(res.data?.data).toHaveProperty("total_discount_amount", 250.75);
          expect(res.data?.data).toHaveProperty("total_revenue", 1875.50);
          expect(res.data?.data).toHaveProperty("orders");
          expect(Array.isArray(res.data?.data?.orders)).toBe(true);
          
          // Verify the default date range spans approximately 30 days
          const startDate = new Date(res.data?.data?.start);
          const endDate = new Date(res.data?.data?.end);
          const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          expect(daysDiff).toBeGreaterThanOrEqual(29);
          expect(daysDiff).toBeLessThanOrEqual(31); // Allow for slight variation
        });

        it("should filter by specific promotion code when provided", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "orders_with_promotions",
              tool_args: { 
                promotion_code: "SAVE20",
                start: "2024-09-01T00:00:00Z",
                end: "2024-09-30T23:59:59Z"
              },
            })
            .mockResolvedValueOnce({ 
              action: "final_answer", 
              answer: "Found orders using the SAVE20 promotion code." 
            });

          const res = await api.post("/admin/assistant", {
            prompt: "Show me orders that used the SAVE20 promotion code in September",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          
          // Verify the tool was called with the promotion code filter
          expect(toolCalls?.[0]).toMatchObject({
            name: "orders_with_promotions",
            args: { 
              promotion_code: "SAVE20",
              start: "2024-09-01T00:00:00Z",
              end: "2024-09-30T23:59:59Z"
            },
          });
          
          // Verify response structure and data
          expect(res.data?.data).toMatchObject({
            start: "2024-09-01T00:00:00Z",
            end: "2024-09-30T23:59:59Z",
            promotion_code: "SAVE20",
            total_orders: 15,
            total_discount_amount: 250.75,
            total_revenue: 1875.50
          });
          
          // Verify orders array structure
          expect(Array.isArray(res.data?.data?.orders)).toBe(true);
          expect(res.data?.data?.orders?.length).toBeGreaterThan(0);
          
          // Verify order structure
          const firstOrder = res.data?.data?.orders?.[0];
          expect(firstOrder).toHaveProperty("order_id");
          expect(firstOrder).toHaveProperty("order_created_at");
          expect(firstOrder).toHaveProperty("promotion_codes");
          expect(firstOrder).toHaveProperty("promotion_ids");
          expect(firstOrder).toHaveProperty("discount_total");
          expect(firstOrder).toHaveProperty("order_total");
          expect(firstOrder).toHaveProperty("items");
          expect(firstOrder).toHaveProperty("customer_id");
          expect(firstOrder).toHaveProperty("customer_email");
          
          // Verify items array structure
          expect(Array.isArray(firstOrder?.items)).toBe(true);
          const firstItem = firstOrder?.items?.[0];
          expect(firstItem).toHaveProperty("product_id");
          expect(firstItem).toHaveProperty("variant_id");
          expect(firstItem).toHaveProperty("title");
          expect(firstItem).toHaveProperty("sku");
          expect(firstItem).toHaveProperty("quantity");
          expect(firstItem).toHaveProperty("unit_price");
          expect(firstItem).toHaveProperty("total");
        });

        it("should handle different date parameter formats", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool", 
              tool_name: "orders_with_promotions",
              tool_args: { 
                start_date: "2024-08-01T00:00:00Z",
                end_date: "2024-08-31T23:59:59Z"
              },
            })
            .mockResolvedValueOnce({ 
              action: "final_answer", 
              answer: "Found promotion orders for August 2024." 
            });

          const res = await api.post("/admin/assistant", {
            prompt: "Show me promotion orders for August 2024",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          
          // Verify the tool accepts alternative date parameter names
          expect(toolCalls?.[0]).toMatchObject({
            name: "orders_with_promotions",
            args: { 
              start_date: "2024-08-01T00:00:00Z",
              end_date: "2024-08-31T23:59:59Z"
            },
          });
          
          // Verify the response uses the provided dates
          expect(res.data?.data).toMatchObject({
            start: "2024-08-01T00:00:00Z",
            end: "2024-08-31T23:59:59Z"
          });
        });
      });
    },
  });
} else {
  describe("Assistant promotion analytics tools (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}