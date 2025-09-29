import { InitialOperation, McpTool } from "../lib/types";
import { extractToolJsonPayload } from "../lib/utils";

/**
 * Preload candidate OpenAPI operations via the `openapi.search` tool when available.
 * Mirrors the logic previously embedded in service.ts without behavior changes.
 */
export async function preloadOpenApiSuggestions(
  prompt: string,
  mcp: any,
  availableTools: McpTool[]
): Promise<InitialOperation[]> {
  let initialOperations: InitialOperation[] = [];
  const hasOpenApiSearch = availableTools.some(
    (tool) => tool.name === "openapi.search"
  );
  if (hasOpenApiSearch) {
    try {
      const rawSuggestions = await mcp.callTool("openapi.search", {
        query: prompt,
        limit: 8,
      });
      const suggestionPayload = extractToolJsonPayload(rawSuggestions);

      if (Array.isArray(suggestionPayload)) {
        initialOperations = suggestionPayload
          .map((item): InitialOperation | null => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const obj = item as Record<string, unknown>;
            const operationId = obj.operationId ?? obj.operation_id ?? obj.id;
            const method = obj.method ?? obj.httpMethod ?? obj.verb;
            const path = obj.path ?? obj.url ?? obj.endpoint;
            if (
              typeof operationId !== "string" ||
              typeof method !== "string" ||
              typeof path !== "string"
            ) {
              return null;
            }
            return {
              operationId,
              method,
              path,
              summary:
                typeof obj.summary === "string" ? obj.summary : undefined,
              tags: Array.isArray(obj.tags)
                ? (obj.tags as unknown[])
                    .filter((tag) => typeof tag === "string")
                    .map((tag) => tag as string)
                : undefined,
            } satisfies InitialOperation;
          })
          .filter((op): op is InitialOperation => Boolean(op));
      }
    } catch (error) {
      console.warn("Failed to pre-load openapi.search suggestions", error);
    }
  }

  return initialOperations;
}
