import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { shouldRunPgIntegration } from "./_helpers";

import path from "node:path";
import jwt from "jsonwebtoken";

// Allow ample time for app boot + DB ops in CI
jest.setTimeout(90 * 1000);

// Planner stub so the assistant deterministically calls the analytics tools we want
const plannerPath = path.resolve(process.cwd(), "src/modules/assistant/planner.ts");
jest.doMock(plannerPath, () => ({
  __esModule: true,
  planNextStepWithGemini: jest.fn(),
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
        try {
          const { result } = await createApiKeysWorkflow(container).run({
            input: { api_keys: [{ type: "secret", title: "CI Admin Key", created_by: "ci" }] },
          });
          const apiKey = result?.[0]?.token;
          if (!apiKey || !String(apiKey).startsWith("sk_")) {
            throw new Error("Failed to create admin API key for test auth");
          }
          api.defaults.headers.common["Authorization"] = `Basic ${apiKey}`;
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (msg.includes("one active secret key")) {
            return; // Reuse existing header/key
          }
          throw e;
        }
      };

      const ensureAdminIdentity = async () => {
        const container = await getContainer();
        // Register admin identity (emailpass) and create the user
        const res = await api.post(`/auth/user/emailpass/register`, {
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
        });
        const token: string = res.data?.token;
        if (!token) throw new Error("Auth identity registration did not return a token");
        const decoded: any = jwt.decode(token) || {};
        const authIdentityId: string | undefined = decoded?.auth_identity_id;
        if (!authIdentityId) throw new Error("Missing auth_identity_id in registration token");

        const { createUserAccountWorkflow } = require("@medusajs/core-flows");
        await createUserAccountWorkflow(container).run({
          input: {
            authIdentityId,
            userData: { email: ADMIN_EMAIL, first_name: "CI", last_name: "Admin" },
          },
        });

        // Configure env so the real MCP server can login
        const baseURL: string = api.defaults.baseURL || "http://localhost:9000";
        process.env.MEDUSA_BACKEND_URL = baseURL;
        process.env.MEDUSA_USERNAME = ADMIN_EMAIL;
        process.env.MEDUSA_PASSWORD = ADMIN_PASSWORD;
      };

      const seedAnalyticsData = async () => {
        // Minimal seed: create a simple product with one variant via workflows (avoids fragile HTTP schema),
        // then generate a few orders
        const container = await getContainer();
        const { Modules, ProductStatus, ContainerRegistrationKeys } = require("@medusajs/framework/utils");
        const { createProductsWorkflow, createShippingProfilesWorkflow } = require("@medusajs/medusa/core-flows");

        // Try to get default shipping profile (required by product workflow)
        const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
        const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({ type: "default" });
        let shippingProfile = shippingProfiles?.[0];
        if (!shippingProfile) {
          try {
            const { result: profs } = await createShippingProfilesWorkflow(container).run({
              input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
            });
            shippingProfile = profs?.[0];
          } catch {}
        }

        // Prefer real currencies if regions exist; otherwise provide common fallbacks
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        let currencies: string[] = [];
        try {
          const { data: regions } = await query.graph({
            entity: "region",
            fields: ["currency_code"],
          });
          currencies = Array.from(
            new Set((regions || []).map((r: any) => r.currency_code).filter(Boolean))
          );
        } catch {}
        if (!currencies.length) currencies = ["usd", "eur"]; // safe defaults for tests

        // Create 1 minimal product if shipping profile is available; otherwise skip product creation
        if (shippingProfile?.id) {
          await createProductsWorkflow(container).run({
            input: {
              products: [
                {
                  title: "Test Product (analytics seed)",
                  status: ProductStatus.PUBLISHED,
                  shipping_profile_id: shippingProfile.id,
                  options: [
                    {
                      title: "Title",
                      values: ["Default"],
                    },
                  ],
                  variants: [
                    {
                      title: "Default",
                      sku: `tp-${Date.now()}`,
                      options: { Title: "Default" },
                      prices: currencies.map((c) => ({ currency_code: c, amount: 1500 })),
                    },
                  ],
                },
              ],
            },
          });
        }

        // Ensure shipping + create a handful of orders using the existing script
        const seedOrders = require("../../src/scripts/seed-orders").default;
        await seedOrders({ container });
      };

      beforeAll(async () => {
        await attachAdminKey();
        await ensureAdminIdentity();
      });

      beforeEach(async () => {
        // DB is truncated between tests; refresh the admin key and reseed minimal data
        await attachAdminKey();
        await seedAnalyticsData();
      });

      const { planNextStepWithGemini } = require(plannerPath);

      describe("Assistant analytics tools (real MCP)", () => {
        it("aggregates sales by product", async () => {
          const now = new Date();
          const start = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
          const end = now.toISOString();
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "sales_aggregate",
              tool_args: {
                start,
                end,
                group_by: "product",
                metric: "orders",
                limit: 3,
                sort: "desc",
              },
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "Here are the top products by orders." });

          const res = await api.post("/admin/assistant", {
            prompt: "Show top 3 products by orders last 7 days",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          const data = res.data?.data;
          expect(data).toBeDefined();
          expect(typeof data?.start).toBe("string");
          expect(typeof data?.end).toBe("string");
          // With seed orders, we expect at least 1 row
          const rows = Array.isArray(data?.results) ? data.results : [];
          expect(rows.length).toBeGreaterThan(0);
          expect(typeof res.data?.answer).toBe("string");
          expect(Array.isArray(res.data?.history)).toBe(true);
          expect(res.data.history?.[0]?.tool_name).toBe("sales_aggregate");
        });

        it("computes customer order frequency", async () => {
          planNextStepWithGemini
            .mockResolvedValueOnce({
              action: "call_tool",
              tool_name: "customer_order_frequency",
              tool_args: { min_orders: 2 },
            })
            .mockResolvedValueOnce({ action: "final_answer", answer: "Computed customer order frequency." });

          const res = await api.post("/admin/assistant", {
            prompt: "How frequently do customers order?",
            wantsChart: false,
          });

          expect(res.status).toBe(200);
          const data = res.data?.data;
          expect(data).toBeDefined();
          expect(Array.isArray(data?.customers)).toBe(true);
          expect(data?.customers.length).toBeGreaterThan(0);
          expect(data?.summary).toBeDefined();
          expect(typeof data?.summary?.total_customers_analyzed).toBe("number");
          expect(data?.summary?.total_customers_analyzed).toBeGreaterThan(0);
          expect(typeof res.data?.answer).toBe("string");
          expect(res.data?.history?.[0]?.tool_name).toBe("customer_order_frequency");
        });
      });
    },
  });
} else {
  describe("Assistant analytics e2e (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}
