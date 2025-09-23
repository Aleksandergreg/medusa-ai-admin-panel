import Medusa from "@medusajs/js-sdk";
import { config } from "dotenv";
import { defineTool } from "../utils/define-tools";
import { loadOpenApiSpec } from "./loader";
import { HttpMethod, OpenApiRegistry, Operation, Parameter } from "./registry";
import { reduceResponse } from "./reducer";

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
    private spec = loadOpenApiSpec();

    constructor() {
        this.sdk = new Medusa({
            baseUrl: MEDUSA_BACKEND_URL,
            debug: process.env.NODE_ENV === "development",
            publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
            auth: { type: "jwt" }
        });
        this.registry = new OpenApiRegistry(this.spec);
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

                    // Generic body field example and enum extraction
                    const bodyFieldExamples: Record<string, unknown> = {};
                    const bodyFieldEnums: Record<string, unknown[]> = {};
                    const requiredBodyFields = new Set<string>();

                    const resolveRef = (node: any): any => {
                        if (!node || typeof node !== "object") return node;
                        if (node.$ref && typeof node.$ref === "string") {
                            const ref = node.$ref as string;
                            const m = ref.match(/^#\/components\/schemas\/(.+)$/);
                            if (m) {
                                const name = m[1];
                                const resolved = this.spec.components?.schemas?.[name];
                                if (resolved) return resolved;
                            }
                        }
                        return node;
                    };

                    const walk = (node: any, path: string, parentRequired?: Set<string>): void => {
                        const n = resolveRef(node);
                        if (!n || typeof n !== "object") return;

                        // Merge required from current node
                        const reqList: string[] = Array.isArray(n.required) ? (n.required as string[]) : [];
                        const reqSet = new Set<string>([...(parentRequired ?? []), ...reqList]);

                        const recordExampleEnum = (schema: any, p: string) => {
                            if (!schema || typeof schema !== "object") return;
                            if (schema.example !== undefined) {
                                bodyFieldExamples[p] = schema.example;
                            } else if (Array.isArray(schema.examples) && schema.examples.length) {
                                bodyFieldExamples[p] = schema.examples[0];
                            }
                            if (Array.isArray(schema.enum) && schema.enum.length) {
                                bodyFieldEnums[p] = schema.enum;
                            }
                        };

                        // If object with properties
                        if (n.properties && typeof n.properties === "object") {
                            const props = n.properties as Record<string, any>;
                            for (const [k, v] of Object.entries(props)) {
                                const childPath = path ? `${path}.${k}` : k;
                                const child = resolveRef(v);
                                if (reqSet.has(k)) requiredBodyFields.add(childPath);
                                recordExampleEnum(child, childPath);
                                // Recurse
                                walk(child, childPath, reqSet);
                            }
                        }
                        // Handle arrays
                        if (n.type === "array" && n.items) {
                            const arrPath = path ? `${path}[]` : "[]";
                            recordExampleEnum(n, arrPath);
                            walk(n.items, arrPath, parentRequired);
                        }
                        // Compose
                        if (Array.isArray(n.allOf)) n.allOf.forEach((s: any) => walk(s, path, reqSet));
                        if (Array.isArray(n.oneOf)) n.oneOf.forEach((s: any) => walk(s, path, parentRequired));
                        if (Array.isArray(n.anyOf)) n.anyOf.forEach((s: any) => walk(s, path, parentRequired));
                    };

                    if (schemas?.requestBodySchema) {
                        walk(schemas.requestBodySchema as any, "");
                    }
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
                        bodyFieldExamples,
                        bodyFieldEnums,
                        requiredBodyFields: Array.from(requiredBodyFields)
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
                    const res = await this.sdk.client.fetch(finalPath, {
                        method: op.method,
                        headers,
                        body: (input.body as unknown) ?? {}
                    });
                    return res;
                }
            }))
        );

        // openapi.reduce
        tools.push(
            defineTool((z) => ({
                name: "openapi.reduce",
                description:
                    "Execute a GET OpenAPI operation and reduce a response array into grouped counts. Supports arrayPath, groupByPath with [] expansion, fallbackGroupBy, normalization and pagination completeness flag.",
                inputSchema: {
                    operationId: z.string().min(1),
                    pathParams: z.record(z.union([z.string(), z.number()])).optional(),
                    query: z.record(z.any()).optional(),
                    headers: z.record(z.string()).optional(),
                    arrayPath: z.string().min(1),
                    groupByPath: z.string().optional(),
                    fallbackGroupBy: z.array(z.string()).optional(),
                    normalize: z.enum(["lower-trim", "none"]).optional(),
                    topN: z.number().min(1).max(100).optional(),
                    // reuse write confirm semantics if user tries non-GET
                    confirm: z.boolean().optional()
                },
                handler: async (input) => {
                    const id = input.operationId as string;
                    const op = this.registry.getByOperationId(id);
                    if (!op) {
                        throw new Error(`Unknown operationId: ${id}`);
                    }
                    if (op.method !== "get") {
                        if (!input.confirm) {
                            throw new Error(
                                `Reducer only intended for GET; operation is ${op.method.toUpperCase()}. Set confirm=true to force.`
                            );
                        }
                    }

                    // Reuse execution logic (inline simplified GET fetch) instead of calling openapi.execute to avoid re-flattening query.
                    let finalPath = op.path;
                    const pathParams = (input.pathParams as Record<string, string | number> | undefined) ?? {};
                    for (const p of op.parameters.filter((p) => p.in === "path")) {
                        const v = pathParams[p.name];
                        if (v === undefined || v === null) continue;
                        finalPath = finalPath.replace(new RegExp(`\\{${p.name}\\}`, "g"), encodeURIComponent(String(v)));
                    }

                    // very light query build (delegate to execute's more advanced if needed later)
                    const query = (input.query as Record<string, unknown> | undefined) ?? {};

                    const headers: Record<string, string> = {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    };
                    if (this.adminToken) {
                        headers["Authorization"] = `Bearer ${this.adminToken}`;
                    }
                    const extraHeaders = (input.headers as Record<string, string> | undefined) ?? {};
                    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;

                    const res = await this.sdk.client.fetch(finalPath, {
                        method: op.method,
                        headers,
                        query
                    });

                    const reduced = reduceResponse(res, {
                        arrayPath: String(input.arrayPath),
                        groupByPath: input.groupByPath ? String(input.groupByPath) : undefined,
                        fallbackGroupBy: (input.fallbackGroupBy as string[] | undefined) ?? [],
                        normalize: (input.normalize as "lower-trim" | "none" | undefined) ?? "lower-trim",
                        topN: (input.topN as number | undefined) ?? 10
                    });

                    return {
                        operationId: id,
                        method: op.method,
                        path: op.path,
                        arrayPath: reduced.arrayPath,
                        groupByPathUsed: reduced.groupByPathUsed,
                        total: reduced.total,
                        missing: reduced.missing,
                        multiValued: reduced.multiValued,
                        incomplete: reduced.incomplete,
                        top: reduced.top,
                        groups: reduced.groups
                    };
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
