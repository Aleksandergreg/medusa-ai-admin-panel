import { defineTool } from "../../utils/define-tools";
import { summarizeParams } from "./shared";
import { HttpMethod, OpenApiRegistry } from "../registry/openapi-registry";

function toMethod(method: string): HttpMethod | null {
    const normalized = method.toLowerCase();
    switch (normalized) {
        case "get":
        case "post":
        case "put":
        case "patch":
        case "delete":
        case "head":
        case "options":
            return normalized;
        default:
            return null;
    }
}

export function createSearchTool(registry: OpenApiRegistry) {
    return defineTool((z) => ({
        name: "openapi.search",
        description:
            "Search Medusa OpenAPI operations by natural language. Filters: tags, methods. Returns operation candidates.",
        inputSchema: {
            query: z.string().min(1),
            tags: z.array(z.string()).optional(),
            methods: z
                .array(
                    z.string().refine((value) => toMethod(value) !== null, {
                        message: "Invalid method"
                    })
                )
                .optional(),
            limit: z.number().min(1).max(50).optional()
        },
        handler: async (input) => {
            const methods = (input.methods as string[] | undefined)?.map((m) => toMethod(m)!) as
                | HttpMethod[]
                | undefined;
            const results = registry.search(input.query as string, {
                tags: input.tags as string[] | undefined,
                methods,
                limit: (input.limit as number | undefined) ?? 10
            });
            return results.map((operation) => ({
                operationId: operation.operationId,
                method: operation.method,
                path: operation.path,
                summary: operation.summary,
                tags: operation.tags,
                pathParams: summarizeParams(operation.parameters.filter((p) => p.in === "path")),
                queryParams: summarizeParams(operation.parameters.filter((p) => p.in === "query"))
            }));
        }
    }));
}
