import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { shouldRunPgIntegration } from "./_helpers";

const JULY_START = "2025-07-01T00:00:00.000Z";
const AUG_START = "2025-08-01T00:00:00.000Z";

// Absolute module paths to ensure mocks hit the same module ids used by the code under test
const path = require("node:path");
const plannerPath = path.resolve(process.cwd(), "src/modules/assistant/planner.ts");
const mcpManagerPath = path.resolve(process.cwd(), "src/lib/mcp/manager.ts");

// Hoisted mocks before the app loads any modules
let toolCalls: Array<{ name: string; args: any }>; // captured tool calls

jest.doMock(plannerPath, () => ({
  __esModule: true,
  planNextStepWithGemini: jest
    .fn()
    // First step: request tool call with July range
    .mockResolvedValueOnce({
      action: "call_tool",
      tool_name: "orders_count",
      tool_args: { start: JULY_START, end: AUG_START },
    })
    // Second step: finalize
    .mockResolvedValueOnce({
      action: "final_answer",
      answer: "There are 8 orders in July 2025.",
    }),
}));

jest.doMock(mcpManagerPath, () => ({
  __esModule: true,
  getMcp: jest.fn().mockImplementation(async () => {
    toolCalls = [];
    return {
      listTools: async () => ({
        tools: [{ name: "orders_count", description: "Counts orders" }],
      }),
      callTool: async (name: string, args: any) => {
        toolCalls.push({ name, args });
        // Simulate MCP tool envelope
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: 8, start: JULY_START, end: AUG_START }),
            },
          ],
        };
      },
    };
  }),
}));

jest.setTimeout(90 * 1000);

if (shouldRunPgIntegration()) {
  medusaIntegrationTestRunner({
    inApp: true,
    env: {
      STORE_CORS: "*",
      ADMIN_CORS: "*",
      AUTH_CORS: "*",
    },
    testSuite: ({ api, getContainer }) => {
      beforeAll(async () => {
        // Create a temporary secret admin API key and attach it as Basic auth
        const { createApiKeysWorkflow } = require("@medusajs/core-flows");
        const container = await getContainer();
        const { result } = await createApiKeysWorkflow(container).run({
          input: { api_keys: [{ type: "secret", title: "CI Admin Key", created_by: "ci" }] },
        });
        const token = result?.[0]?.token;
        if (!token || !String(token).startsWith("sk_")) {
          throw new Error("Failed to create admin API key for test auth");
        }
        api.defaults.headers.common["Authorization"] = `Basic ${token}`;
      });
      describe("Assistant orders_count (stubbed planner + MCP)", () => {
        it("invokes orders_count with July range and returns 8", async () => {
          const res = await api.post("/admin/assistant", {
            prompt: "How many orders are in July 2025?",
            wantsChart: false,
          });
          expect(res.status).toBe(200);
          // Tool call captured
          expect(toolCalls?.length).toBe(1);
          expect(toolCalls?.[0]?.name).toBe("orders_count");
          expect(toolCalls?.[0]?.args).toEqual({ start: JULY_START, end: AUG_START });
          // Assistant response contains the tool payload and answer mentions 8
          expect(res.data?.data).toMatchObject({ count: 8 });
          expect(String(res.data?.answer)).toMatch(/8/);
        });
      });
    },
  });
} else {
  describe("Assistant orders_count (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}
