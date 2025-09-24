import oas from "../../oas/oas.json";

export type OpenAPISpec = {
    openapi: string;
    info?: { title?: string; version?: string };
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
    components?: { schemas?: Record<string, unknown> };
    paths: Record<string, unknown>;
};

export function loadOpenApiSpec(): OpenAPISpec {
    // Currently loads the local bundled OAS. Can be extended to load from env.
    return oas as unknown as OpenAPISpec;
}
