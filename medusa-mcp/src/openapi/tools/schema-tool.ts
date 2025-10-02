import { defineTool } from "../../utils/define-tools";
import { summarizeParams } from "./shared";
import { collectBodyMetadata } from "../spec/schema-utils";
import { OpenAPISpec } from "../spec/loader";
import { OpenApiRegistry, Operation } from "../registry/openapi-registry";

type QueryParamHint = {
    name: string;
    operators: string[];
    example?: string;
};

function buildQueryParamHints(operation: Operation): QueryParamHint[] {
    return (operation.parameters ?? [])
        .filter((param) => param.in === "query")
        .map((param) => {
            const schema = param.schema as Record<string, unknown> | undefined;
            const props =
                schema?.type === "object"
                    ? (schema?.properties as
                          | Record<string, unknown>
                          | undefined)
                    : undefined;
            if (!props) {
                return null;
            }
            const keys = Object.keys(props);
            const operators = keys.filter((key) => key.startsWith("$"));
            let example: string | undefined;
            if (operators.includes("$gte") || operators.includes("$lte")) {
                example = `${param.name}[$gte]=2025-01-01T00:00:00Z&${param.name}[$lte]=2025-12-31T23:59:59Z`;
            } else if (operators.includes("$eq")) {
                example = `${param.name}[$eq]=value`;
            }
            return {
                name: param.name,
                operators,
                example
            };
        })
        .filter(Boolean) as QueryParamHint[];
}

export function createSchemaTool(spec: OpenAPISpec, registry: OpenApiRegistry) {
    return defineTool((z) => ({
        name: "openapi.schema",
        description: "Return parameter and body schemas for an operationId.",
        inputSchema: {
            operationId: z.string().min(1)
        },
        handler: async (input) => {
            const id = input.operationId as string;
            const operation = registry.getByOperationId(id);
            if (!operation) {
                throw new Error(`Unknown operationId: ${id}`);
            }
            const schemas = registry.getSchemas(id);
            const examplePath = operation.path.replace(/\{(.*?)\}/g, ":$1");
            const queryParamHints = buildQueryParamHints(operation);

            const bodyMeta = schemas?.requestBodySchema
                ? collectBodyMetadata(spec, schemas.requestBodySchema)
                : { examples: {}, enums: {}, required: [] };

            const exampleUrl = queryParamHints
                .map((hint) => hint.example)
                .filter((value): value is string => Boolean(value))
                .join("&");

            return {
                operationId: operation.operationId,
                method: operation.method,
                path: operation.path,
                examplePath,
                exampleUrl: exampleUrl.length
                    ? `${examplePath}?${exampleUrl}`
                    : undefined,
                summary: operation.summary,
                description: operation.description,
                tags: operation.tags,
                pathParams: summarizeParams(schemas?.pathParams ?? []),
                queryParams: summarizeParams(schemas?.queryParams ?? []),
                headerParams: summarizeParams(schemas?.headerParams ?? []),
                requestBodySchema: schemas?.requestBodySchema,
                queryParamHints,
                bodyFieldExamples: bodyMeta.examples,
                bodyFieldEnums: bodyMeta.enums,
                requiredBodyFields: bodyMeta.required
            };
        }
    }));
}
