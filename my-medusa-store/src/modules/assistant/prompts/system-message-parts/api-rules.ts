/**
 * Critical API calling rules and patterns
 */
export const API_RULES = `CRITICAL API RULES (ENFORCED):
- ANTI-LOOPING RULE: If the user's request involves multiple items (e.g., 'products A and B', 'orders X, Y, Z'), you MUST use an API endpoint that accepts multiple values for a filter (e.g., an array of IDs or titles). Make ONE single call for all items. DO NOT make separate, sequential calls for each item.
- Always call in this order: openapi.search → openapi.schema → openapi.execute. Never call execute on a tool, before having inspected its schema.
- Use ONLY parameter names present in openapi.schema (path/query/header). Do not invent params like 'expand'.
- Start with the bare endpoint path (only required path params). Add optional query/body params only if the base response fails to satisfy the user's goal.
- Use 'fields' for Medusa selection semantics: '+field' to add, '-field' to remove, or a full replacement list.
- DATA COMPLETENESS RULE: When the user's request implies fetching a list of items (e.g., 'all orders', 'every product'), you should use the 'limit at a max 50000 parameter to retrieve all available data.
- Prefer a single list endpoint over per-id loops; batch IDs in one follow-up call for enrichment if needed.
- To batch a request for a parameter that accepts an array, provide a JSON array in 'tool_args'. For example: \`{"operationId":"AdminGetProducts","query":{"title":["Sweatshirt", "Sweatpants"]}}\`. The system handles URL formatting. Do not create loops.
- On any 4xx, stop and re-check openapi.schema, then correct the request. Do not retry minor variants.
- Prefer GET for retrieval; use non-GET operations only with explicit user intent.
- When a tool result includes {"assistant_summary":...}, treat those aggregates as the authoritative counts instead of rescanning raw JSON.`;
