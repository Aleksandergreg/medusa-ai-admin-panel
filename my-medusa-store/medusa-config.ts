import { loadEnv, defineConfig } from "@medusajs/framework/utils";

const finalModelStrategy =
  (process.env.ASSISTANT_FINAL_MODEL_STRATEGY as
    | "always"
    | "adaptive"
    | "never"
    | undefined) ?? undefined;

const finalModelAdaptiveThreshold = (() => {
  const raw = process.env.ASSISTANT_FINAL_MODEL_THRESHOLD;
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
})();

loadEnv(process.env.NODE_ENV || "development", process.cwd());

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    {
      resolve: "./src/modules/assistant",
      options: {
        maxSteps: 25,
        modelName: process.env.ASSISTANT_MODEL_NAME || "gemini-2.5-flash",
        finalModelName: process.env.ASSISTANT_FINAL_MODEL_NAME,
        finalModelStrategy,
        finalModelAdaptiveThreshold,
        geminiApiKey: process.env.GEMINI_API_KEY,
        plannerMode: process.env.ASSISTANT_PLANNER_MODE || "live",
      },
    },
    {
      resolve: "./src/modules/abandoned-carts",
    },
  ],
});
