import { OpenAPISpec } from "../spec/loader";

export type HttpMethod =
    | "get"
    | "post"
    | "put"
    | "patch"
    | "delete"
    | "head"
    | "options";

export type Parameter = {
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required?: boolean;
    description?: string;
    schema?: { type?: string; [k: string]: unknown };
};

export type Operation = {
    operationId: string;
    method: HttpMethod;
    path: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters: Parameter[];
    requestBody?: unknown;
};

const STOPWORDS = new Set([
    "a",
    "about",
    "an",
    "and",
    "for",
    "from",
    "get",
    "gets",
    "give",
    "list",
    "lists",
    "me",
    "of",
    "or",
    "show",
    "shows",
    "tell",
    "the",
    "to",
    "what",
    "when",
    "where",
    "which",
    "with"
]);

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeToken(token: string): string {
    return token.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokenize(value: unknown): string[] {
    if (value === null || value === undefined) {
        return [];
    }
    const text = String(value)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .toLowerCase();
    return text
        .split(/\s+/)
        .map((segment) => normalizeToken(segment))
        .filter(Boolean)
        .filter((segment) => !STOPWORDS.has(segment));
}

function pickOperationEntries(pathItem: unknown): Array<[HttpMethod, Record<string, unknown>]> {
    if (!isObject(pathItem)) {
        return [];
    }
    const out: Array<[HttpMethod, Record<string, unknown>]> = [];
    const methods: HttpMethod[] = [
        "get",
        "post",
        "put",
        "patch",
        "delete",
        "head",
        "options"
    ];
    for (const m of methods) {
        const op = pathItem[m];
        if (isObject(op)) {
            out.push([m, op]);
        }
    }
    return out;
}

export class OpenApiRegistry {
    private spec: OpenAPISpec;
    private operations: Operation[] = [];

    constructor(spec: OpenAPISpec) {
        this.spec = spec;
        this.index();
    }

    private index(): void {
        const ops: Operation[] = [];
        for (const [path, pathItem] of Object.entries(this.spec.paths ?? {})) {
            const pi = pathItem as Record<string, unknown>;
            const pathParams: Parameter[] = Array.isArray(pi?.parameters)
                ? ((pi.parameters as unknown as Parameter[]) ?? [])
                : [];
            for (const [method, op] of pickOperationEntries(pathItem)) {
                const parameters: Parameter[] = [
                    ...pathParams,
                    ...(((op.parameters as unknown as Parameter[]) ?? []) as Parameter[])
                ];
                const operationId = String(op.operationId ?? `${method.toUpperCase()}_${path}`);
                const summary = typeof op.summary === "string" ? op.summary : undefined;
                const description = typeof op.description === "string" ? op.description : undefined;
                const tags = Array.isArray(op.tags) ? (op.tags as string[]) : undefined;
                const requestBody = op.requestBody;
                ops.push({
                    operationId,
                    method,
                    path,
                    summary,
                    description,
                    tags,
                    parameters,
                    requestBody
                });
            }
        }
        this.operations = ops;
    }

    list(): Operation[] {
        return this.operations;
    }

    getByOperationId(id: string): Operation | undefined {
        return this.operations.find((o) => o.operationId === id);
    }

    // Lightweight keyword search across id, summary, description, path, tags
    search(
        query: string,
        opts?: { tags?: string[]; methods?: HttpMethod[]; limit?: number }
    ): Operation[] {
        const q = query.toLowerCase().trim();
        const normalizedTokens = q
            .split(/\s+/)
            .map((token) => normalizeToken(token))
            .filter(Boolean);
        const tokens = (() => {
            const significant = normalizedTokens.filter((t) => !STOPWORDS.has(t));
            return significant.length ? significant : normalizedTokens;
        })();
        const tagSet = new Set((opts?.tags ?? []).map((t) => t.toLowerCase()));
        const methodSet = new Set(opts?.methods ?? []);

        const scored = this.operations
            .filter((op) =>
                (tagSet.size === 0 || (op.tags ?? []).some((t) => tagSet.has(t.toLowerCase()))) &&
                (methodSet.size === 0 || methodSet.has(op.method))
            )
            .map((op) => {
                const fields = [
                    op.operationId,
                    op.summary ?? "",
                    op.description ?? "",
                    op.path,
                    ...(op.tags ?? [])
                ];
                const haystack = fields.join(" \n ").toLowerCase();
                let score = 0;
                for (const token of tokens) {
                    if (token && haystack.includes(token)) {
                        score += 1;
                    }
                }
                if (q && (op.summary ?? "").toLowerCase().includes(q)) {
                    score += 2;
                }
                if (q && op.operationId.toLowerCase().includes(normalizeToken(q))) {
                    score += 2;
                }
                return { op, score };
            })
            .filter(({ score }) => (tokens.length ? score > 0 : true))
            .sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                return a.op.operationId.localeCompare(b.op.operationId);
            });

        const limit = opts?.limit ?? 10;
        return scored.slice(0, limit).map((s) => s.op);
    }

    // Returns a simplified schema view useful for models
    getSchemas(operationId: string): {
        pathParams: Parameter[];
        queryParams: Parameter[];
        headerParams: Parameter[];
        requestBodySchema?: unknown;
    } | null {
        const op = this.getByOperationId(operationId);
        if (!op) return null;
        const pathParams = op.parameters.filter((p) => p.in === "path");
        const queryParams = op.parameters.filter((p) => p.in === "query");
        const headerParams = op.parameters.filter((p) => p.in === "header");

        let requestBodySchema: unknown | undefined;
        if (op.requestBody && isObject(op.requestBody)) {
            const rb = op.requestBody as {
                content?: Record<string, { schema?: unknown }>;
            };
            requestBodySchema = rb.content?.["application/json"]?.schema;
        }
        return { pathParams, queryParams, headerParams, requestBodySchema };
    }
}
