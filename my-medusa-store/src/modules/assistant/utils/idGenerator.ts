/**
 * Generates a consistent ID of the form: `${prefix}_${timestamp}_${random}`.
 * Random segment length chosen (13 chars) to match previous longest usage (substring(2,15)).
 * Centralizing this avoids duplication and format drift between service & migrations.
 */
export function generateId(prefix: string): string {
  const randomPart = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now();
  return `${prefix}_${timestamp}_${randomPart}`;
}
