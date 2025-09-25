import { defineTool } from "../../utils/define-tools";
import { MedusaClient } from "../../clients/medusa/client";
import { OpenApiRegistry, Operation, Parameter } from "../registry/openapi-registry";

type StrictQueryMode = "drop" | "error";

type QueryBuildResult = {
    query: Record<string, unknown>;
    droppedKeys: string[];
};

const OPERATOR_KEYS = new Set([
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

export function createExecuteTool(registry: OpenApiRegistry, medusa: MedusaClient) {
    return defineTool((z) => ({
        name: "openapi.execute",
        description:
            "Execute an OpenAPI operation by operationId. Provide pathParams, query, body. Writes require confirm=true.",
        inputSchema: {
            operationId: z.string().min(1),
            pathParams: z.record(z.union([z.string(), z.number()])).optional(),
            query: z.record(z.any()).optional(),
            headers: z.record(z.string()).optional(),
            body: z.any().optional(),
            confirm: z.boolean().optional(),
            schemaAware: z.boolean().optional(),
            strictQuery: z.enum(["drop", "error"]).optional()
        },
        handler: async (input) => {
            const id = input.operationId as string;
            const operation = registry.getByOperationId(id);
            if (!operation) {
                throw new Error(`Unknown operationId: ${id}`);
            }

            guardWriteOperations(operation, input.confirm as boolean | undefined);

            const schemaAware = (input.schemaAware as boolean | undefined) !== false;
            const strictQuery = ((input.strictQuery as StrictQueryMode | undefined) ?? "drop") as StrictQueryMode;
            const schemas = registry.getSchemas(id);

            const finalPath = buildPath(operation, (input.pathParams as Record<string, string | number> | undefined) ?? {});

            const { query, droppedKeys } = buildQuery(
                operation,
                schemas?.queryParams ?? [],
                (input.query as Record<string, unknown> | undefined) ?? {},
                schemaAware
            );

            if (strictQuery === "error" && droppedKeys.length) {
                throw new Error(`Query contains unsupported keys for ${id}: ${droppedKeys.join(", ")}`);
            }

            const extraHeaders = (input.headers as Record<string, string> | undefined) ?? {};

            if (operation.method === "get" || operation.method === "head") {
                return medusa.fetch(finalPath, {
                    method: operation.method,
                    headers: extraHeaders,
                    query
                });
            }

            return medusa.fetch(finalPath, {
                method: operation.method,
                headers: extraHeaders,
                body: (input.body as unknown) ?? {}
            });
        }
    }));
}

function guardWriteOperations(operation: Operation, confirm: boolean | undefined): void {
    if (operation.method === "get" || operation.method === "head") {
        return;
    }
    if (!confirm) {
        throw new Error(`Operation ${operation.operationId} uses ${operation.method.toUpperCase()}. Set confirm=true to proceed.`);
    }
}

function buildPath(operation: Operation, pathParams: Record<string, string | number>): string {
    let finalPath = operation.path;
    for (const param of operation.parameters.filter((p) => p.in === "path")) {
        const value = pathParams[param.name];
        if (value === undefined || value === null) {
            continue;
        }
        finalPath = finalPath.replace(new RegExp(`\\{${param.name}\\}`, "g"), encodeURIComponent(String(value)));
    }
    return finalPath;
}

function buildQuery(
    operation: Operation,
    queryParams: Parameter[],
    rawQuery: Record<string, unknown>,
    schemaAware: boolean
): QueryBuildResult {
    if (!schemaAware) {
        return { query: normalizeQuery(rawQuery), droppedKeys: [] };
    }
    const allowed = new Set(queryParams.map((param) => param.name));
    const filtered: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(rawQuery)) {
        if (allowed.has(key)) {
            filtered[key] = value;
        } else {
            dropped.push(key);
        }
    }
    return {
        query: normalizeQuery(filtered),
        droppedKeys: dropped
    };
}

function normalizeQuery(input: Record<string, unknown>): Record<string, unknown> {
    const queryObj: Record<string, unknown> = {};

    const setKey = (key: string, value: unknown) => {
        const existing = queryObj[key];
        if (existing === undefined) {
            queryObj[key] = value;
        } else if (Array.isArray(existing)) {
            (existing as unknown[]).push(value);
        } else {
            queryObj[key] = [existing, value];
        }
    };

    const append = (key: string, value: unknown): void => {
        if (value === undefined || value === null) {
            return;
        }
        if (value instanceof Date) {
            setKey(key, value.toISOString());
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                if (
                    item === null ||
                    item === undefined ||
                    typeof item === "string" ||
                    typeof item === "number" ||
                    typeof item === "boolean"
                ) {
                    setKey(key, String(item));
                } else if (typeof item === "object") {
                    append(`${key}[${index}]`, item as Record<string, unknown>);
                }
            });
            return;
        }
        if (typeof value === "object") {
            for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
                const normalizedKey = normalizeOpKey(subKey);
                append(`${key}[${normalizedKey}]`, subValue);
            }
            return;
        }
        setKey(key, String(value));
    };

    for (const [key, value] of Object.entries(input)) {
        append(key, value);
    }

    return queryObj;
}

function normalizeOpKey(key: string): string {
    if (key.startsWith("$")) {
        return key;
    }
    const maybeOperator = `$${key}`;
    return OPERATOR_KEYS.has(maybeOperator) ? maybeOperator : key;
}
