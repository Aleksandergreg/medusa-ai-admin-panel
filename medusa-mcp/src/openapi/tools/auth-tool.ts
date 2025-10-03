import { defineTool } from "../../utils/define-tools";
import { MedusaClient } from "../../clients/medusa/client";

export function createAuthTool(medusa: MedusaClient) {
    return defineTool((z) => ({
        name: "auth.setToken",
        description:
            "Set or override the Authorization Bearer token used for API calls.",
        inputSchema: {
            token: z.string().min(1)
        },
        handler: async (input) => {
            medusa.setAuthToken(String(input.token));
            return { ok: true };
        }
    }));
}
