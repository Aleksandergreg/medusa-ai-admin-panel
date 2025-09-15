import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { shouldRunPgIntegration } from "./_helpers";

const path = require("node:path");
const jwt = require("jsonwebtoken");

// Allow ample time for app boot + DB ops in CI
jest.setTimeout(90 * 1000);

// Planner stub so the assistant deterministically calls the real MCP tool we want
const plannerPath = path.resolve(process.cwd(), "src/modules/assistant/planner.ts");
jest.doMock(plannerPath, () => ({
  __esModule: true,
  planNextStepWithGemini: jest
    .fn()
    .mockResolvedValueOnce({
      action: "call_tool",
      tool_name: "low_inventory_products_count",
      tool_args: { threshold: 10, manage_inventory_only: true },
    })
    .mockResolvedValueOnce({ action: "final_answer", answer: "Done." }),
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
      const ADMIN_EMAIL = "admin+ci@example.com";
      const ADMIN_PASSWORD = "test-password-123";

      const attachAdminKey = async () => {
        const { createApiKeysWorkflow } = require("@medusajs/core-flows");
        const container = await getContainer();
        const { result } = await createApiKeysWorkflow(container).run({
          input: { api_keys: [{ type: "secret", title: "CI Admin Key", created_by: "ci" }] },
        });
        const apiKey = result?.[0]?.token;
        if (!apiKey || !String(apiKey).startsWith("sk_")) {
          throw new Error("Failed to create admin API key for test auth");
        }
        api.defaults.headers.common["Authorization"] = `Basic ${apiKey}`;
      };

      const ensureAdminIdentity = async () => {
        const container = await getContainer();
        // Use the SDK endpoint shape via our axios baseURL rather than guessing route paths
        // 1) Request registration token then create user via workflow
        const res = await api.post(`/auth/user/emailpass/register`, {
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
        });
        const token: string = res.data?.token;
        if (!token) throw new Error("Auth identity registration did not return a token");
        const decoded: any = jwt.decode(token) || {};
        const authIdentityId: string | undefined = decoded?.auth_identity_id;
        if (!authIdentityId) throw new Error("Missing auth_identity_id in registration token");

        const { createUserAccountWorkflow } = require("@medusajs/core-flows/dist/user/workflows/create-user-account.js");
        await createUserAccountWorkflow(container).run({
          input: {
            authIdentityId,
            userData: { email: ADMIN_EMAIL, first_name: "CI", last_name: "Admin" },
          },
        });
        const baseURL: string = api.defaults.baseURL || "http://localhost:9000";
        process.env.MEDUSA_BACKEND_URL = baseURL;
        process.env.MEDUSA_USERNAME = ADMIN_EMAIL;
        process.env.MEDUSA_PASSWORD = ADMIN_PASSWORD;
      };

      beforeAll(async () => {
        await attachAdminKey();
        await ensureAdminIdentity();
      });

      // Refresh auth context in case DB is reset between tests (future‑proof)
      beforeEach(async () => {
        await attachAdminKey();
      });

      it("calls real MCP inventory count via assistant", async () => {
        const res = await api.post("/admin/assistant", {
          prompt: "Count products with low inventory",
          wantsChart: false,
        });

        expect(res.status).toBe(200);
        // We cannot guarantee non-zero counts on an empty DB; assert shape instead
        expect(res.data?.data).toBeDefined();
        expect(typeof res.data?.data?.count).toBe("number");
        // The assistant writes a final answer (from stubbed planner)
        expect(typeof res.data?.answer).toBe("string");
        // And records history with at least one MCP tool call
        expect(Array.isArray(res.data?.history)).toBe(true);
        expect(res.data.history?.[0]?.tool_name).toBe("low_inventory_products_count");
      });
    },
  });
} else {
  describe("Assistant MCP E2E (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}
