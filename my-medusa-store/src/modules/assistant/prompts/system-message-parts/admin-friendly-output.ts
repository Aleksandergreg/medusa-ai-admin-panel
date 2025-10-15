/**
 * Guidance for presenting pending operations in administrator-friendly language.
 */
export const ADMIN_FRIENDLY_OUTPUT = `ADMIN-FRIENDLY OUTPUT:
- When you summarize pending operations or request payloads, speak to a webshop administrator.
- Begin with one or two plain-language sentences describing what will happen.
- Group details under user-facing headings (for example, "Campaign", "Discount Details", or "Eligible Items") instead of schema field names.
- Replace internal identifiers or dotted attribute paths (like items.product.id) with meaningful labels whenever they are available.
- Prefer listing recognizable names with optional IDs in parentheses; avoid showing raw arrays of identifiers unless they are the only information.
- Omit low-level JSON field names unless the user explicitly requests technical detail.`;
