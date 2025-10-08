import { FieldValue } from "../types/field.types";

/**
 * Formats a value for display purposes
 */
export function formatValueDisplay(value: FieldValue): string {
  if (value === null || value === undefined) {
    return "Not set";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return value.toLocaleString();
  }

  if (typeof value === "string") {
    // Check if it's a date
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      try {
        return new Date(value).toLocaleString();
      } catch {
        return value;
      }
    }
    return value;
  }

  return String(value);
}

/**
 * Formats a field name to a human-readable label
 */
export function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Truncates text to a maximum length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/**
 * Checks if text is "long" (for textarea vs input decision)
 */
export function isLongText(text: string, threshold: number = 50): boolean {
  return text.length > threshold;
}
