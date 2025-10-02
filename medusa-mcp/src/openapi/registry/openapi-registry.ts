import { OpenAPISpec } from "../spec/loader";
import { buildIndexedOperation, IndexedOperation } from "./indexed-operation";
import { buildQueryContext, scoreOperation } from "./scorer";
import { tokenizeQuery } from "./tokenizer";
import { HttpMethod, Operation, Parameter } from "./types";

export type { HttpMethod, Operation, Parameter } from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickOperationEntries(
    pathItem: unknown
): Array<[HttpMethod, Record<string, unknown>]> {
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
    private operations: IndexedOperation[] = [];

    constructor(spec: OpenAPISpec) {
        this.spec = spec;
        this.index();
    }

    private index(): void {
        const ops: IndexedOperation[] = [];
        for (const [path, pathItem] of Object.entries(this.spec.paths ?? {})) {
            const pi = pathItem as Record<string, unknown>;
            const pathParams: Parameter[] = Array.isArray(pi?.parameters)
                ? (pi.parameters as unknown as Parameter[]) ?? []
                : [];
            for (const [method, op] of pickOperationEntries(pathItem)) {
                const parameters: Parameter[] = [
                    ...pathParams,
                    ...(((op.parameters as unknown as Parameter[]) ??
                        []) as Parameter[])
                ];
                const operationId = String(
                    op.operationId ?? `${method.toUpperCase()}_${path}`
                );
                const summary =
                    typeof op.summary === "string" ? op.summary : undefined;
                const description =
                    typeof op.description === "string"
                        ? op.description
                        : undefined;
                const tags = Array.isArray(op.tags)
                    ? (op.tags as string[])
                    : undefined;
                const requestBody = op.requestBody;
                const operation: Operation = {
                    operationId,
                    method,
                    path,
                    summary,
                    description,
                    tags,
                    parameters,
                    requestBody
                };

                ops.push(buildIndexedOperation(operation));
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
        const { tokens, original } = tokenizeQuery(query);
        const queryContext = buildQueryContext(tokens, original);
        const tagSet = new Set(
            (opts?.tags ?? []).map((t: string) => t.toLowerCase())
        );
        const methodSet = new Set(opts?.methods ?? []);

        const scored = this.operations
            .filter(
                (op) =>
                    (tagSet.size === 0 ||
                        (op.tags ?? []).some((t) =>
                            tagSet.has(t.toLowerCase())
                        )) &&
                    (methodSet.size === 0 || methodSet.has(op.method))
            )
            .map((op) => {
                const analyzed = scoreOperation(op, queryContext);
                return { op, score: analyzed.score, details: analyzed.details };
            })
            .filter(({ score }) => (tokens.length ? score > 0 : true))
            .sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                return a.op.operationId.localeCompare(b.op.operationId);
            });

        const limit = opts?.limit ?? 10;
        const top = scored.slice(0, limit);

        return top.map((s) => s.op);
    }

    // Returns a simplified schema view useful for models
    getSchemas(operationId: string): {
        pathParams: Parameter[];
        queryParams: Parameter[];
        headerParams: Parameter[];
        requestBodySchema?: unknown;
    } | null {
        const op = this.getByOperationId(operationId);
        if (!op) {
            return null;
        }
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
