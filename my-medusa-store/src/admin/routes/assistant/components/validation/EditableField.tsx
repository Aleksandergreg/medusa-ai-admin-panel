import { Badge, Input, Select, Switch, Textarea } from "@medusajs/ui";
import { CollapsibleComplexData } from "./CollapsibleComplexData";

type EditableFieldProps = {
  value: unknown;
  isEditing: boolean;
  path: string[];
  onChange?: (path: string[], newValue: unknown) => void;
  bodyFieldEnums?: Record<string, string[]>;
};

export function EditableField({
  value,
  isEditing,
  path,
  onChange,
  bodyFieldEnums,
}: EditableFieldProps): React.ReactNode {
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

  if (typeof value === "string") {
    if (isEditing && onChange) {
      // Check if this field has enum options
      const fullPath = path.join(".");
      const fieldName = path[path.length - 1];
      const enumOptions =
        bodyFieldEnums?.[fullPath] || bodyFieldEnums?.[fieldName];

      if (enumOptions && enumOptions.length > 0) {
        const stringValue = String(value);
        const valueInOptions = enumOptions.includes(stringValue);
        const selectValue = valueInOptions ? stringValue : enumOptions[0] || "";

        return (
          <Select
            value={selectValue}
            onValueChange={(val) => onChange(path, val)}
          >
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

      const isLongText = value.length > 50;
      if (isLongText) {
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
      return (
        <Input
          value={value}
          onChange={(e) => onChange(path, e.target.value)}
          className="text-sm"
          size="small"
          placeholder="Enter value..."
        />
      );
    }
    // Display mode
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return (
        <span className="font-medium text-ui-fg-base">
          📅 {new Date(value).toLocaleDateString()} at{" "}
          {new Date(value).toLocaleTimeString()}
        </span>
      );
    }
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-ui-fg-interactive hover:underline break-all"
        >
          🔗 {value}
        </a>
      );
    }
    if (value.length > 100) {
      return (
        <span className="font-medium text-ui-fg-base block text-sm leading-relaxed">
          {value}
        </span>
      );
    }
    return <span className="font-medium text-ui-fg-base">{value}</span>;
  }

  if (typeof value === "number") {
    if (isEditing && onChange) {
      return (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(path, parseFloat(e.target.value) || 0)}
          className="text-sm"
          size="small"
        />
      );
    }
    return <span className="font-medium">{value.toLocaleString()}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-ui-fg-subtle italic">No items</span>;
    }
    if (typeof value[0] === "string" || typeof value[0] === "number") {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, idx) => (
            <Badge key={idx} size="small" color="blue">
              {String(item)}
            </Badge>
          ))}
        </div>
      );
    }
    return <CollapsibleComplexData data={value} nestLevel={0} />;
  }

  if (typeof value === "object") {
    return <CollapsibleComplexData data={value} nestLevel={0} />;
  }

  return <span className="font-medium text-ui-fg-base">{String(value)}</span>;
}
