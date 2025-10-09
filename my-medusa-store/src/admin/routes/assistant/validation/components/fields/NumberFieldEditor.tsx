import { Input } from "@medusajs/ui";
import { FieldEditorProps } from "../../types/field.types";

export function NumberFieldEditor({
  value,
  onChange,
  metadata,
  disabled,
}: FieldEditorProps) {
  const numValue = typeof value === "number" ? value : 1;

  return (
    <Input
      type="number"
      min={1}
      value={numValue}
      onChange={(e) => onChange(Math.max(1, parseFloat(e.target.value) || 1))}
      disabled={disabled || metadata.isReadOnly}
      className="text-sm"
      size="small"
    />
  );
}
