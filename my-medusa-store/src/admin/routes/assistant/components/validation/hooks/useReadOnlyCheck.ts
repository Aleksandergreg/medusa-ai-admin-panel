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

    return (
      bodyFieldReadOnly.includes(fullPath) ||
      bodyFieldReadOnly.includes(fieldName)
    );
  }, [bodyFieldReadOnly, path]);
}
