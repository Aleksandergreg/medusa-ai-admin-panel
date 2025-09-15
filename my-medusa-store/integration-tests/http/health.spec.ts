import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { shouldRunPgIntegration } from "./_helpers"
jest.setTimeout(60 * 1000)

if (shouldRunPgIntegration()) {
  medusaIntegrationTestRunner({
    inApp: true,
    env: {},
    testSuite: ({ api }) => {
      describe("Ping", () => {
        it("ping the server health endpoint", async () => {
          const response = await api.get('/health')
          expect(response.status).toEqual(200)
        })
      })
    },
  })
} else {
  describe("Ping (skipped)", () => {
    it.skip("requires Postgres; set RUN_PG_TESTS=1", () => {})
  })
}
