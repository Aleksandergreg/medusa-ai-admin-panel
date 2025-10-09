import { useMemo } from "react";
import { useValidationContext } from "../context/ValidationContext";
import { FieldPath } from "../types/field.types";

/**
 * Hook to check if a field is marked as read-only
 */
export function useReadOnlyCheck(path: FieldPath): boolean {
  const { bodyFieldReadOnly } = useValidationContext();

  return useMemo(() => {
    if (!bodyFieldReadOnly || bodyFieldReadOnly.length === 0) {
      return false;
    }

    const fullPath = path.join(".");
    const fieldName = path[path.length - 1];

    // Check exact matches
    if (
      bodyFieldReadOnly.includes(fullPath) ||
      bodyFieldReadOnly.includes(fieldName)
    ) {
      return true;
    }

    return bodyFieldReadOnly.some((readOnlyPath) => {
      if (!readOnlyPath.includes("[]")) {
        return false;
      }
      const pattern = readOnlyPath
        .replace(/\./g, "\\.")
        .replace(/\[\]/g, "\\.\\d+");
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(fullPath);
    });
  }, [bodyFieldReadOnly, path]);
}
