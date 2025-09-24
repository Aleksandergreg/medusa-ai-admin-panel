import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z
    .object({
        MEDUSA_BACKEND_URL: z.string().url().optional(),
        MEDUSA_USERNAME: z.string().optional(),
        MEDUSA_PASSWORD: z.string().optional(),
        NODE_ENV: z.string().optional(),
        NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: z.string().optional()
    })
    .passthrough();

const parsed = envSchema.parse(process.env);

export const env = {
    medusaBackendUrl: parsed.MEDUSA_BACKEND_URL ?? "http://localhost:9000",
    medusaUsername: parsed.MEDUSA_USERNAME ?? "medusa_user",
    medusaPassword: parsed.MEDUSA_PASSWORD ?? "medusa_pass",
    publishableKey: parsed.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
    nodeEnv: parsed.NODE_ENV ?? "development",
    isDevelopment: (parsed.NODE_ENV ?? "development") === "development"
};

export type Env = typeof env;
