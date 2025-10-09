import { Badge, Switch, Input, Textarea, DatePicker } from "@medusajs/ui";
import { useValidationContext } from "../context/ValidationContext";
import { useFieldMetadata } from "../hooks/useFieldMetadata";
import { FieldValue, FieldPath } from "../types/field.types";
import { TextFieldEditor } from "./fields/TextFieldEditor";
import { NumberFieldEditor } from "./fields/NumberFieldEditor";
import { SelectFieldEditor } from "./fields/SelectFieldEditor";
import { CollapsibleComplexData } from "./CollapsibleComplexData";
import { formatValueDisplay, isLongText } from "../utils/fieldFormatters";
import { isObject } from "../utils/typeCheckers";

interface EditableFieldProps {
  value: FieldValue;
  path: FieldPath;
}

export function EditableField({
  value,
  path,
}: EditableFieldProps): React.ReactNode {
  const { isEditing, onChange } = useValidationContext();
  const metadata = useFieldMetadata(path, value);

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (isEditing && onChange) {
      return (
        <Input
          placeholder="Not set"
          value=""
          onChange={(e) => onChange(path, e.target.value)}
          className="text-sm"
          size="small"
        />
      );
    }
    return <span className="text-ui-fg-subtle italic">Not set</span>;
  }

  // Handle boolean
  if (typeof value === "boolean") {
    if (isEditing && onChange) {
      return (
        <Switch
          checked={value}
          onCheckedChange={(checked) => onChange(path, checked)}
        />
      );
    }
    return (
      <Badge color={value ? "green" : "grey"}>{value ? "Yes" : "No"}</Badge>
    );
  }

  // Handle number
  if (typeof value === "number") {
    if (isEditing && onChange) {
      return (
        <NumberFieldEditor
          value={value}
          onChange={(newValue) => onChange(path, newValue)}
          metadata={metadata}
        />
      );
    }
    return (
      <span className="font-medium text-ui-fg-base">
        {value.toLocaleString()}
      </span>
    );
  }

  // Handle string
  if (typeof value === "string") {
    if (isEditing && onChange) {
      // Check if read-only
      if (metadata.isReadOnly) {
        return (
          <div className="flex items-center gap-2">
            <Input
              value={value}
              disabled
              className="text-sm opacity-60"
              size="small"
            />
            <Badge size="2xsmall" color="grey">
              🔒 Read-only
            </Badge>
          </div>
        );
      }

      // Date picker for date strings
      if (metadata.type === "date") {
        return (
          <DatePicker
            value={new Date(value)}
            onChange={(date) => onChange(path, date?.toISOString() || "")}
          />
        );
      }

      // Enum/Select dropdown
      if (metadata.type === "enum" && metadata.enumOptions) {
        return (
          <SelectFieldEditor
            value={value}
            onChange={(newValue) => onChange(path, newValue)}
            metadata={metadata}
          />
        );
      }

      // Long text - use textarea
      if (isLongText(value)) {
        return (
          <Textarea
            value={value}
            onChange={(e) => onChange(path, e.target.value)}
            className="text-sm"
            rows={3}
            placeholder="Enter text..."
          />
        );
      }

      // Short text - use input
      return (
        <TextFieldEditor
          value={value}
          onChange={(newValue) => onChange(path, newValue)}
          metadata={metadata}
        />
      );
    }

    // Display mode for strings
    return (
      <span className="font-medium text-ui-fg-base">
        {formatValueDisplay(value)}
      </span>
    );
  }

  // Handle arrays and objects (complex data)
  if (Array.isArray(value) || isObject(value)) {
    return <CollapsibleComplexData data={value} nestLevel={0} path={path} />;
  }

  // Fallback
  return <span className="text-ui-fg-base">{String(value)}</span>;
}
