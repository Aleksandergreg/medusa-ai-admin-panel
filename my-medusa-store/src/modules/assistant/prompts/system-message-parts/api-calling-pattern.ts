/**
 * Strict API calling patterns specific to the platform
 */
export const API_CALLING_PATTERN = `API CALLING PATTERN (STRICT):
- Always: openapi.search → choose candidate → openapi.schema → openapi.execute.
- before a post execution call, do an openapi.schema call to ensure you have the latest schema
- Use ONLY parameter names present in openapi.schema. Do not invent params.
- Start with the bare endpoint path. Only add optional query/body/path params if the base response is insufficient for the user's request.
- Do NOT use 'expand'. Use 'fields' with Medusa semantics: "+field" to add, "-field" to remove, or a full replacement list.
- Prefer a single list endpoint over per-id loops; if enrichment is needed, batch IDs in one follow-up call.
- When openapi.schema shows a parameter supports an array (type array or oneOf string/array), include every value in one request using repeated 'param[]=value' entries (for example 'customer_id[]=A&customer_id[]=B').
- On any 4xx or schema mismatch, re-check openapi.schema and fix the request instead of retrying variants.
- Prefer GET for retrieval. Non-GET requires explicit user intent.`
