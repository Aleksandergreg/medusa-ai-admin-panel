import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { shouldRunPgIntegration } from "./_helpers";

jest.setTimeout(90 * 1000);

if (shouldRunPgIntegration()) {
  medusaIntegrationTestRunner({
    inApp: true,
    env: {},
    testSuite: ({ api }) => {
      describe("Internal Metrics", () => {
        it("GET /internal/metrics returns JSON summary", async () => {
          const res = await api.get("/internal/metrics");
          expect(res.status).toBe(200);
          expect(res.headers["content-type"]).toContain("application/json");
          expect(res.data).toHaveProperty("totals");
          expect(res.data).toHaveProperty("byTool");
        });
      });
    },
  });
} else {
  describe("Internal Metrics (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {});
  });
}
