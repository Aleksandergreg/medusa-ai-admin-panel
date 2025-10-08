import { FieldType, FieldValue } from "../types/field.types";

/**
 * Determines the type of a field value
 */
export function getFieldType(value: FieldValue): FieldType {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const type = typeof value;

  if (type === "boolean") return "boolean";
  if (type === "number") return "number";
  if (type === "string") {
    // Check if it's a date string
    if (typeof value === "string" && isDateString(value)) return "date";
    return "string";
  }

  if (Array.isArray(value)) return "array";
  if (type === "object") return "object";

  return "string";
}

/**
 * Checks if a value is a valid date string
 */
export function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * Checks if a value is a simple primitive (not object or array)
 */
export function isPrimitive(value: FieldValue): boolean {
  const type = typeof value;
  return (
    value === null ||
    value === undefined ||
    type === "string" ||
    type === "number" ||
    type === "boolean"
  );
}

/**
 * Checks if an object contains only primitive values
 */
export function isSimpleObject(obj: Record<string, unknown>): boolean {
  return Object.values(obj).every((value) => isPrimitive(value));
}

/**
 * Type guard for non-null objects
 */
export function isObject(value: FieldValue): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard for arrays
 */
export function isArray(value: FieldValue): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard for strings
 */
export function isString(value: FieldValue): value is string {
  return typeof value === "string";
}

/**
 * Type guard for numbers
 */
export function isNumber(value: FieldValue): value is number {
  return typeof value === "number";
}

/**
 * Type guard for booleans
 */
export function isBoolean(value: FieldValue): value is boolean {
  return typeof value === "boolean";
}
