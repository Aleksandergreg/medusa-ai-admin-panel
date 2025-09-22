import Medusa from "@medusajs/js-sdk";
import { config } from "dotenv";
import { defineTool } from "../utils/define-tools";
import { loadOpenApiSpec } from "./loader";
import { HttpMethod, OpenApiRegistry, Operation, Parameter } from "./registry";

config();

const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000";
const MEDUSA_USERNAME = process.env.MEDUSA_USERNAME ?? "medusa_user";
const MEDUSA_PASSWORD = process.env.MEDUSA_PASSWORD ?? "medusa_pass";

function toMethod(m: string): HttpMethod | null {
    const s = m.toLowerCase();
    if (
        s === "get" ||
        s === "post" ||
        s === "put" ||
        s === "patch" ||
        s === "delete" ||
        s === "head" ||
        s === "options"
    ) {
        return s;
    }
    return null;
}

export default class OpenApiToolsService {
    private sdk: Medusa;
    private adminToken = "";
    private registry: OpenApiRegistry;

    constructor() {
        this.sdk = new Medusa({
            baseUrl: MEDUSA_BACKEND_URL,
            debug: process.env.NODE_ENV === "development",
            publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
            auth: { type: "jwt" }
        });
        const spec = loadOpenApiSpec();
        this.registry = new OpenApiRegistry(spec);
    }

    async init(): Promise<void> {
        // Acquire admin token by default. Can be overridden by auth.setToken tool.
        try {
            const res = await this.sdk.auth.login("user", "emailpass", {
                email: MEDUSA_USERNAME,
                password: MEDUSA_PASSWORD
            });
            this.adminToken = res.toString();
        } catch (e) {
            // Non-fatal: server may run read-only if token is not needed for store endpoints.
            // Still allow the tools to run; writes will likely fail with 401.
            this.adminToken = "";
        }
    }

    private summarizeParams(params: Parameter[]): Array<{ name: string; in: string; required?: boolean; type?: string; description?: string }> {
        return params.map((p) => ({
            name: p.name,
            in: p.in,
            required: p.required,
            type: (p.schema?.type as string | undefined) ?? undefined,
            description: p.description
        }));
    }

    defineTools(): Array<ReturnType<typeof defineTool>> {
        const tools: Array<ReturnType<typeof defineTool>> = [];

        // openapi.search
        tools.push(
            defineTool((z) => ({
                name: "openapi.search",
                description:
                    "Search Medusa OpenAPI operations by natural language. Filters: tags, methods. Returns operation candidates.",
                inputSchema: {
                    query: z.string().min(1),
                    tags: z.array(z.string()).optional(),
                    methods: z
                        .array(
                            z.string().refine((v) => toMethod(v) !== null, {
                                message: "Invalid method"
                            })
                        )
                        .optional(),
                    limit: z.number().min(1).max(50).optional()
                },
                handler: async (input) => {
                    const methods = (input.methods as string[] | undefined)?.map((m) => toMethod(m)!) as HttpMethod[] | undefined;
                    const ops = this.registry.search(input.query as string, {
                        tags: input.tags as string[] | undefined,
                        methods,
                        limit: (input.limit as number | undefined) ?? 10
                    });
                    return ops.map((op) => ({
                        operationId: op.operationId,
                        method: op.method,
                        path: op.path,
                        summary: op.summary,
                        tags: op.tags,
                        // quick param overview
                        pathParams: this.summarizeParams(op.parameters.filter((p) => p.in === "path")),
                        queryParams: this.summarizeParams(op.parameters.filter((p) => p.in === "query"))
                    }));
                }
            }))
        );

        // openapi.schema
        tools.push(
            defineTool((z) => ({
                name: "openapi.schema",
                description: "Return parameter and body schemas for an operationId.",
                inputSchema: {
                    operationId: z.string().min(1)
                },
                handler: async (input) => {
                    const id = input.operationId as string;
                    const op = this.registry.getByOperationId(id);
                    if (!op) {
                        throw new Error(`Unknown operationId: ${id}`);
                    }
                    const schemas = this.registry.getSchemas(id);
                    const examplePath = op.path.replace(/\{(.*?)\}/g, ":$1");
                    return {
                        operationId: op.operationId,
                        method: op.method,
                        path: op.path,
                        examplePath,
                        summary: op.summary,
                        description: op.description,
                        tags: op.tags,
                        pathParams: this.summarizeParams(schemas?.pathParams ?? []),
                        queryParams: this.summarizeParams(schemas?.queryParams ?? []),
                        headerParams: this.summarizeParams(schemas?.headerParams ?? []),
                        requestBodySchema: schemas?.requestBodySchema
                    };
                }
            }))
        );

        // openapi.execute
        tools.push(
            defineTool((z) => ({
                name: "openapi.execute",
                description:
                    "Execute an OpenAPI operation by operationId. Provide pathParams, query, body. Writes require confirm=true.",
                inputSchema: {
                    operationId: z.string().min(1),
                    pathParams: z.record(z.union([z.string(), z.number()])).optional(),
                    query: z.record(z.any()).optional(),
                    headers: z.record(z.string()).optional(),
                    body: z.any().optional(),
                    confirm: z.boolean().optional()
                },
                handler: async (input) => {
                    const id = input.operationId as string;
                    const op = this.registry.getByOperationId(id);
                    if (!op) {
                        throw new Error(`Unknown operationId: ${id}`);
                    }

                    // Write gating
                    if (op.method !== "get" && op.method !== "head") {
                        if (!input.confirm) {
                            throw new Error(
                                `Operation ${id} uses ${op.method.toUpperCase()}. Set confirm=true to proceed.`
                            );
                        }
                    }

                    // Build path with pathParams
                    let finalPath = op.path;
                    const pathParams = (input.pathParams as Record<string, string | number> | undefined) ?? {};
                    for (const p of op.parameters.filter((p) => p.in === "path")) {
                        const v = pathParams[p.name];
                        if (v === undefined || v === null) {
                            // best-effort: leave placeholder if not provided
                            continue;
                        }
                        finalPath = finalPath.replace(new RegExp(`\\{${p.name}\\}`, "g"), encodeURIComponent(String(v)));
                    }

                    // Build query
                    const queryInput = (input.query as Record<string, unknown> | undefined) ?? {};
                    const queryEntries: [string, string][] = [];
                    for (const [k, v] of Object.entries(queryInput)) {
                        if (v === undefined || v === null) continue;
                        if (Array.isArray(v)) {
                            for (const vv of v) queryEntries.push([k, String(vv)]);
                        } else if (typeof v === "object") {
                            queryEntries.push([k, JSON.stringify(v)]);
                        } else {
                            queryEntries.push([k, String(v)]);
                        }
                    }
                    const query = new URLSearchParams(queryEntries);

                    // Headers
                    const headers: Record<string, string> = {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    };
                    if (this.adminToken) {
                        headers["Authorization"] = `Bearer ${this.adminToken}`;
                    }
                    const extraHeaders = (input.headers as Record<string, string> | undefined) ?? {};
                    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;

                    // Execute
                    if (op.method === "get" || op.method === "head") {
                        const res = await this.sdk.client.fetch(finalPath, {
                            method: op.method,
                            headers,
                            query
                        });
                        return res;
                    }
                    const res = await this.sdk.client.fetch(finalPath, {
                        method: op.method,
                        headers,
                        body: (input.body as unknown) ?? {}
                    });
                    return res;
                }
            }))
        );

        // auth.setToken (optional helper)
        tools.push(
            defineTool((z) => ({
                name: "auth.setToken",
                description: "Set or override the Authorization Bearer token used for API calls.",
                inputSchema: {
                    token: z.string().min(1)
                },
                handler: async (input) => {
                    this.adminToken = String(input.token);
                    return { ok: true };
                }
            }))
        );

        return tools;
    }
}

