import { MedusaClient } from "../clients/medusa/client";
import { loadOpenApiSpec, OpenAPISpec } from "./spec/loader";
import { OpenApiRegistry } from "./registry/openapi-registry";
import { createSearchTool } from "./tools/search-tool";
import { createSchemaTool } from "./tools/schema-tool";
import { createExecuteTool } from "./tools/execute-tool";
import { createAuthTool } from "./tools/auth-tool";
import { createAgentNpsSubmitTool } from "../tools/agent-nps-tool";

export default class OpenApiToolsService {
    private readonly medusa: MedusaClient;
    private readonly spec: OpenAPISpec;
    private readonly registry: OpenApiRegistry;

    constructor(options?: {
        medusa?: MedusaClient;
        spec?: OpenAPISpec;
        registry?: OpenApiRegistry;
    }) {
        this.spec = options?.spec ?? loadOpenApiSpec();
        this.medusa = options?.medusa ?? new MedusaClient();
        this.registry = options?.registry ?? new OpenApiRegistry(this.spec);
    }

    async init(): Promise<void> {
        try {
            await this.medusa.loginFromEnv();
        } catch {
            this.medusa.setAuthToken(null);
        }
    }

    defineTools() {
        return [
            createSearchTool(this.registry),
            createSchemaTool(this.spec, this.registry),
            createExecuteTool(this.registry, this.medusa),
            createAuthTool(this.medusa),
            createAgentNpsSubmitTool(this.medusa)
        ];
    }
}
