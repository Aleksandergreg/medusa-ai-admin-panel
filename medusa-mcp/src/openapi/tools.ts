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
                    // Derive operator hints for object-typed query params (e.g., created_at)
                    const queryParamHints = (op.parameters ?? [])
                        .filter((p) => p.in === "query")
                        .map((p) => {
                            const sch = p.schema as Record<string, unknown> | undefined;
                            const props = (sch?.type === "object" && (sch?.properties as Record<string, unknown> | undefined)) || undefined;
                            if (!props) return null;
                            const keys = Object.keys(props);
                            const operators = keys.filter((k) => k.startsWith("$"));
                            let example: string | undefined;
                            if (operators.includes("$gte") || operators.includes("$lte")) {
                                example = `${p.name}[$gte]=2025-01-01T00:00:00Z&${p.name}[$lte]=2025-12-31T23:59:59Z`;
                            } else if (operators.includes("$eq")) {
                                example = `${p.name}[$eq]=value`;
                            }
                            return {
                                name: p.name,
                                operators,
                                example
                            };
                        })
                        .filter(Boolean);

                    // Body hints: find any 'attribute' properties with examples (e.g., items.product.id)
                    const bodyHints = (() => {
                        const hints = new Set<string>();
                        const seen = new WeakSet<object>();
                        const visit = (node: unknown): void => {
                            if (!node || typeof node !== "object") return;
                            if (seen.has(node as object)) return;
                            seen.add(node as object);
                            const o = node as Record<string, unknown>;
                            if (o.properties && typeof o.properties === "object") {
                                const props = o.properties as Record<string, unknown>;
                                if (
                                    props.attribute &&
                                    typeof props.attribute === "object" &&
                                    (props.attribute as any).example
                                ) {
                                    const ex = String((props.attribute as any).example);
                                    hints.add(ex);
                                }
                                for (const v of Object.values(props)) visit(v);
                            }
                            if (Array.isArray(o.allOf)) o.allOf.forEach(visit);
                            if (Array.isArray(o.oneOf)) o.oneOf.forEach(visit);
                            if (Array.isArray(o.anyOf)) o.anyOf.forEach(visit);
                            if (o.items) visit(o.items);
                        };
                        if (schemas?.requestBodySchema) visit(schemas.requestBodySchema);
                        return hints.size ? { attributeExamples: Array.from(hints) } : undefined;
                    })();
                    const exampleUrl = (queryParamHints as Array<{ name: string; operators: string[]; example?: string }> | undefined)
                        ?.map((h) => h?.example)
                        .filter((e): e is string => Boolean(e))
                        .join("&");

                    return {
                        operationId: op.operationId,
                        method: op.method,
                        path: op.path,
                        examplePath,
                        exampleUrl: exampleUrl && exampleUrl.length ? `${examplePath}?${exampleUrl}` : undefined,
                        summary: op.summary,
                        description: op.description,
                        tags: op.tags,
                        pathParams: this.summarizeParams(schemas?.pathParams ?? []),
                        queryParams: this.summarizeParams(schemas?.queryParams ?? []),
                        headerParams: this.summarizeParams(schemas?.headerParams ?? []),
                        requestBodySchema: schemas?.requestBodySchema,
                        queryParamHints,
                        bodyParamHints: bodyHints
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
                    const opLikeKeys = new Set([
                        "$and",
                        "$or",
                        "$eq",
                        "$ne",
                        "$in",
                        "$nin",
                        "$not",
                        "$gt",
                        "$gte",
                        "$lt",
                        "$lte",
                        "$like",
                        "$re",
                        "$ilike",
                        "$fulltext",
                        "$overlap",
                        "$contains",
                        "$contained",
                        "$exists"
                    ]);
                    const normalizeOpKey = (k: string): string => {
                        if (k.startsWith("$")) return k;
                        const maybe = `$${k}`;
                        return opLikeKeys.has(maybe) ? maybe : k;
                    };
                    const queryObj: Record<string, unknown> = {};

                    const setKey = (key: string, val: unknown): void => {
                        const existing = queryObj[key];
                        if (existing === undefined) {
                            queryObj[key] = val;
                        } else if (Array.isArray(existing)) {
                            (existing as unknown[]).push(val);
                        } else {
                            queryObj[key] = [existing, val];
                        }
                    };

                    const append = (key: string, val: unknown): void => {
                        if (val === undefined || val === null) return;
                        if (val instanceof Date) {
                            setKey(key, val.toISOString());
                            return;
                        }
                        if (Array.isArray(val)) {
                            // Repeat the key for each primitive; index objects
                            val.forEach((item, idx) => {
                                if (
                                    item === null ||
                                    item === undefined ||
                                    typeof item === "string" ||
                                    typeof item === "number" ||
                                    typeof item === "boolean"
                                ) {
                                    setKey(key, String(item));
                                } else if (typeof item === "object") {
                                    append(`${key}[${idx}]`, item as Record<string, unknown>);
                                }
                            });
                            return;
                        }
                        if (typeof val === "object") {
                            // Flatten object as bracket notation
                            for (const [subK, subV] of Object.entries(val as Record<string, unknown>)) {
                                const norm = normalizeOpKey(subK);
                                append(`${key}[${norm}]`, subV);
                            }
                            return;
                        }
                        setKey(key, String(val));
                    };

                    for (const [k, v] of Object.entries(queryInput)) {
                        append(k, v);
                    }

                    const query = queryObj as Record<string, any>;

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
                    // Preflight body normalization for known patterns (non-breaking)
                    let body = (input.body as any) ?? {};
                    // Fix common mistake in promotion target rules: attribute must reference items.*
                    if (
                        op.operationId === "AdminPostPromotions" &&
                        body &&
                        typeof body === "object" &&
                        body.application_method &&
                        Array.isArray(body.application_method.target_rules)
                    ) {
                        body = { ...body, application_method: { ...body.application_method } };
                        body.application_method.target_rules = body.application_method.target_rules.map((r: any) => {
                            if (!r || typeof r !== "object") return r;
                            const attr = r.attribute as string | undefined;
                            if (!attr) return r;
                            // If user passed "product.id", normalize to "items.product.id"
                            if (attr === "product.id") {
                                return { ...r, attribute: "items.product.id" };
                            }
                            if (attr === "variant.id") {
                                return { ...r, attribute: "items.variant.id" };
                            }
                            // If attribute refers to product.* without items prefix, add it
                            if (/^(product\.|variant\.)/.test(attr)) {
                                return { ...r, attribute: `items.${attr}` };
                            }
                            return r;
                        });
                    }

                    const res = await this.sdk.client.fetch(finalPath, {
                        method: op.method,
                        headers,
                        body
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
