import { FieldValue } from "../types/field.types";
import { parseISO, parse, isValid } from "date-fns";

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
    // Check if it's an ISO 8601 datetime string (with T separator)
    if (
      value.match(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.?\d+)?(Z|[+-]\d{2}:\d{2})?$/
      )
    ) {
      try {
        const date = parseISO(value);
        if (isValid(date)) {
          return date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        }
      } catch {
        return value;
      }
    }

    // Check if it's a space-separated datetime string (YYYY-MM-DD HH:MM:SS)
    if (value.match(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/)) {
      try {
        const date = parse(value, "yyyy-MM-dd HH:mm:ss", new Date());
        if (isValid(date)) {
          return date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        }
      } catch {
        return value;
      }
    }

    // Check if it's a date-only string
    if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
      try {
        const date = parse(value, "yyyy-MM-dd", new Date());
        if (isValid(date)) {
          return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        }
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
