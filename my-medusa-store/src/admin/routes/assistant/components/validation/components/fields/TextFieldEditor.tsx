import { Input } from "@medusajs/ui";
import { FieldEditorProps } from "../../types/field.types";

export function TextFieldEditor({
  value,
  onChange,
  metadata,
  disabled,
}: FieldEditorProps) {
  const stringValue =
    value === null || value === undefined ? "" : String(value);

  return (
    <Input
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || metadata.isReadOnly}
      className="text-sm"
      size="small"
      placeholder={`Enter ${metadata.fieldName}...`}
    />
  );
}
