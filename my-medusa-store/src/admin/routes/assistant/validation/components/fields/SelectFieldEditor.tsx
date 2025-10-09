import { Select, Badge } from "@medusajs/ui";
import { FieldEditorProps } from "../../types/field.types";

export function SelectFieldEditor({
  value,
  onChange,
  metadata,
  disabled,
}: FieldEditorProps) {
  const { enumOptions } = metadata;

  if (!enumOptions || enumOptions.length === 0) {
    return (
      <span className="text-ui-fg-subtle text-sm">No options available</span>
    );
  }

  const stringValue = String(value);
  const valueInOptions = enumOptions.includes(stringValue);
  const selectValue = valueInOptions ? stringValue : enumOptions[0] || "";

  if (disabled || metadata.isReadOnly) {
    return (
      <div className="flex items-center gap-2">
        <Select value={selectValue} disabled>
          <Select.Trigger className="w-full opacity-60">
            <Select.Value />
          </Select.Trigger>
        </Select>
        <Badge size="2xsmall" color="grey">
          🔒 Read-only
        </Badge>
      </div>
    );
  }

  return (
    <Select value={selectValue} onValueChange={(val) => onChange(val)}>
      <Select.Trigger className="w-full">
        <Select.Value placeholder="Choose an option..." />
      </Select.Trigger>
      <Select.Content>
        {enumOptions.map((option) => (
          <Select.Item key={option} value={option}>
            {option}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
}
