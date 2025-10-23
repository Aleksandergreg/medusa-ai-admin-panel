import { useMemo } from "react";
import { useValidationContext } from "../context/ValidationContext";
import { FieldMetadata, FieldPath, FieldValue } from "../types/field.types";
import { getFieldType } from "../utils/typeCheckers";

/**
 * Hook to get metadata about a field
 */
export function useFieldMetadata(
  path: FieldPath,
  value: FieldValue
): FieldMetadata {
  const { bodyFieldEnums } = useValidationContext();

  return useMemo(() => {
    const fullPath = path.join(".");
    const fieldName = path[path.length - 1];
    const type = getFieldType(value);

    // Check if this field has enum options
    const enumOptions =
      bodyFieldEnums?.[fullPath] || bodyFieldEnums?.[fieldName];

    return {
      path,
      fullPath,
      fieldName,
      type: enumOptions && enumOptions.length > 0 ? "enum" : type,
      isReadOnly: false,
      isRequired: false, // Could be enhanced to check required fields
      enumOptions,
    };
  }, [path, value, bodyFieldEnums]);
}
