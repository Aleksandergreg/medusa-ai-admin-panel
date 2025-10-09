import { FieldValue } from "../types/field.types";

/**
 * Validates that a required field has a value
 */
export function validateRequired(value: FieldValue): string | null {
  if (value === null || value === undefined || value === "") {
    return "This field is required";
  }
  return null;
}

/**
 * Validates that a value is a valid number
 */
export function validateNumber(value: FieldValue): string | null {
  if (typeof value === "number" && !isNaN(value)) {
    return null;
  }
  if (typeof value === "string") {
    const num = parseFloat(value);
    if (!isNaN(num)) return null;
  }
  return "Must be a valid number";
}

/**
 * Validates that a number is within a range
 */
export function validateNumberRange(
  value: FieldValue,
  min?: number,
  max?: number
): string | null {
  const num = typeof value === "number" ? value : parseFloat(String(value));

  if (isNaN(num)) return "Must be a valid number";

  if (min !== undefined && num < min) {
    return `Must be at least ${min}`;
  }

  if (max !== undefined && num > max) {
    return `Must be at most ${max}`;
  }

  return null;
}

/**
 * Validates that a value is a valid email
 */
export function validateEmail(value: FieldValue): string | null {
  if (typeof value !== "string") return "Must be a string";

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return "Must be a valid email address";
  }

  return null;
}

/**
 * Validates that a value is a valid URL
 */
export function validateUrl(value: FieldValue): string | null {
  if (typeof value !== "string") return "Must be a string";

  try {
    new URL(value);
    return null;
  } catch {
    return "Must be a valid URL";
  }
}

/**
 * Validates that a string matches a pattern
 */
export function validatePattern(
  value: FieldValue,
  pattern: RegExp
): string | null {
  if (typeof value !== "string") return "Must be a string";

  if (!pattern.test(value)) {
    return "Invalid format";
  }

  return null;
}

/**
 * Validates that a value is one of the allowed enum options
 */
export function validateEnum(
  value: FieldValue,
  options: string[]
): string | null {
  if (!options.includes(String(value))) {
    return `Must be one of: ${options.join(", ")}`;
  }
  return null;
}
