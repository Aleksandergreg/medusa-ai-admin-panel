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
          { name: "low_inventory_products_count", description: "Count products below threshold" },
          { name: "low_inventory_products_list", description: "List products below threshold" },
        ],
      }),
      callTool: async (name: string, args: any) => {
        toolCalls.push({ name, args });
        if (name === "low_inventory_products_count") {
          const threshold = Number(args?.threshold ?? 50);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ threshold, count: 3, variants_count: 4 }),
              },
            ],
          };
        }
        if (name === "low_inventory_products_list") {
          const threshold = Number(args?.threshold ?? 50);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  threshold,
                  count: 2,
                  variants_count: 3,
                  products: [
                    { id: "prod_1", title: "Alpha Tee", low_variants_count: 2 },
                    { id: "prod_2", title: "Beta Hoodie", low_variants_count: 1 },
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

      describe("Assistant inventory tools (stubbed MCP)", () => {
        it("counts low-inventory products below threshold", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "low_inventory_products_count",
              tool_args: { threshold: 50, manage_inventory_only: true },
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "There are 3 products below threshold." });

          const res = await api.post("/admin/assistant", {
            prompt: "How many products have inventory below 50?",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          expect(toolCalls?.[0]).toMatchObject({
            name: "low_inventory_products_count",
            args: { threshold: 50, manage_inventory_only: true },
          });
          expect(res.data?.data).toMatchObject({ threshold: 50, count: 3, variants_count: 4 });
          expect(String(res.data?.answer)).toMatch(/3/);
        });

        it("lists low-inventory products below threshold", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "low_inventory_products_list",
              tool_args: { threshold: 25, limit: 2, include_variants: false },
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "Here are the products with low inventory." });

          const res = await api.post("/admin/assistant", {
            prompt: "Show products below 25 units.",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          expect(toolCalls?.[0]).toMatchObject({
            name: "low_inventory_products_list",
            args: { threshold: 25, limit: 2, include_variants: false },
          });
          expect(res.data?.data).toMatchObject({ threshold: 25, count: 2 });
          expect(Array.isArray(res.data?.data?.products)).toBe(true);
          expect(res.data?.data?.products?.length).toBeGreaterThan(0);
        });
      });
    },
  });
} else {
  describe("Assistant inventory tools (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}
