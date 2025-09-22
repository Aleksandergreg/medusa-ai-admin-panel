import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// 1. Remove the MedusaStoreService import
// import MedusaStoreService from "./services/medusa-store"; 
import OpenApiToolsService from "./openapi/tools";

async function main(): Promise<void> {
    // 2. Update the startup message for clarity
    console.error("Starting Medusa OpenAPI MCP Server...");

    // 3. Remove the store service and related logic
    const openApiTools = new OpenApiToolsService();
    let tools = [] as ReturnType<typeof openApiTools.defineTools>;
    try {
        await openApiTools.init();
        // Register only a small set of generic OpenAPI tools
        tools = openApiTools.defineTools();
    } catch (error) {
        // 5. Error handling for tool initialization
        console.error("Fatal Error: Could not initialize OpenAPI tools:", error);
        process.exit(1);
    }

    const server = new McpServer(
        {
            // 6. Server name reflects generic OpenAPI capability
            name: "Medusa OpenAPI MCP Server",
            version: "1.0.0"
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    tools.forEach((tool) => {
        server.tool(
            tool.name,
            tool.description,
            tool.inputSchema,
            tool.handler
        );
    });

    const transport = new StdioServerTransport();
    console.error("Connecting server to transport...");
    await server.connect(transport);

    console.error("Medusajs MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
