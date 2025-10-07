import { Badge, Text, Input, Switch, Textarea, Select } from "@medusajs/ui";
import { ChevronDownMini, ChevronUpMini } from "@medusajs/icons";
import { useState } from "react";

function formatValueDisplay(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-ui-fg-subtle italic">Not set</span>;
  }

  if (typeof value === "boolean") {
    return (
      <Badge color={value ? "green" : "grey"} size="small">
        {value ? "✓ Yes" : "✗ No"}
      </Badge>
    );
  }

  if (typeof value === "number") {
    return (
      <span className="font-medium text-ui-fg-base">
        {value.toLocaleString()}
      </span>
    );
  }

  if (typeof value === "string") {
    // Check if it's a date
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return (
        <span className="font-medium text-ui-fg-base">
          {new Date(value).toLocaleString()}
        </span>
      );
    }
    // Check if it's a URL
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return (
        <span className="font-mono text-xs text-ui-fg-subtle break-all">
          {value}
        </span>
      );
    }
    return <span className="font-medium text-ui-fg-base">{value}</span>;
  }

  return <span className="text-ui-fg-base">{String(value)}</span>;
}

// Helper to check if an object is "simple" (only contains primitive values)
function isSimpleObject(obj: Record<string, unknown>): boolean {
  return Object.values(obj).every((value) => {
    return (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  });
}

// Render an editable field for simple values
function renderEditableField(
  _key: string,
  value: unknown,
  path: string[],
  onChange: (path: string[], value: unknown) => void,
  bodyFieldEnums?: Record<string, string[]>
): React.ReactNode {
  if (value === null || value === undefined) {
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

  if (typeof value === "boolean") {
    return (
      <Switch
        checked={value}
        onCheckedChange={(checked) => onChange(path, checked)}
      />
    );
  }

  if (typeof value === "string") {
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

  if (typeof value === "number") {
    return (
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) =>
          onChange(path, Math.max(1, parseFloat(e.target.value) || 1))
        }
        className="text-sm"
        size="small"
      />
    );
  }

  return <span className="font-medium text-ui-fg-base">{String(value)}</span>;
}

export function CollapsibleComplexData({
  data,
  nestLevel = 0,
  isEditing = false,
  onChange,
  path = [],
  bodyFieldEnums,
}: {
  data: unknown;
  nestLevel?: number;
  isEditing?: boolean;
  onChange?: (path: string[], value: unknown) => void;
  path?: string[];
  bodyFieldEnums?: Record<string, string[]>;
}) {
  const [isExpanded, setIsExpanded] = useState(nestLevel === 0);

  if (typeof data !== "object" || data === null) {
    return formatValueDisplay(data);
  }

  // Handle arrays
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-ui-fg-subtle italic">No items</span>;
    }

    return (
      <div className="border border-ui-border-base rounded-lg bg-ui-bg-base overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-ui-bg-subtle transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronUpMini className="text-ui-fg-muted" />
            ) : (
              <ChevronDownMini className="text-ui-fg-muted" />
            )}
            <span className="text-ui-fg-base text-sm font-medium">
              📋 List of {data.length} {data.length === 1 ? "item" : "items"}
            </span>
          </div>
          <Badge size="2xsmall" className="ml-2">
            {data.length}
          </Badge>
        </button>
        {isExpanded && (
          <div className="px-4 py-3 border-t border-ui-border-base bg-ui-bg-subtle space-y-3">
            {data.map((item, idx) => (
              <div
                key={idx}
                className="bg-ui-bg-base rounded-md p-3 border border-ui-border-base"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge size="2xsmall" color="grey">
                    Item #{idx + 1}
                  </Badge>
                </div>
                <div className="ml-1">
                  {typeof item === "object" && item !== null ? (
                    <CollapsibleComplexData
                      data={item}
                      nestLevel={nestLevel + 1}
                      isEditing={isEditing}
                      onChange={onChange}
                      path={[...path, String(idx)]}
                    />
                  ) : (
                    formatValueDisplay(item)
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Handle objects
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="text-ui-fg-subtle italic">No details</span>;
  }

  const dataAsObject = data as Record<string, unknown>;
  const isSimple = isSimpleObject(dataAsObject);

  // If it's a simple object and we're in editing mode, make it editable
  if (isSimple && isEditing && onChange) {
    return (
      <div className="border border-ui-border-base rounded-lg bg-ui-bg-base overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-ui-bg-subtle transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronUpMini className="text-ui-fg-muted" />
            ) : (
              <ChevronDownMini className="text-ui-fg-muted" />
            )}
            <span className="text-ui-fg-base text-sm font-medium">
              ✏️ Edit details ({entries.length}{" "}
              {entries.length === 1 ? "property" : "properties"})
            </span>
          </div>
          <Badge size="2xsmall" className="ml-2">
            {entries.length}
          </Badge>
        </button>
        {isExpanded && (
          <div className="px-4 py-3 border-t border-ui-border-base bg-ui-bg-field space-y-3">
            {entries.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Text size="small" className="text-ui-fg-base font-medium">
                  {key}
                </Text>
                <div className="ml-1">
                  {renderEditableField(
                    key,
                    value,
                    [...path, key],
                    onChange,
                    bodyFieldEnums
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Complex object or read-only mode - keep as collapsible read-only
  return (
    <div className="border border-ui-border-base rounded-lg bg-ui-bg-base overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-ui-bg-subtle transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronUpMini className="text-ui-fg-muted" />
          ) : (
            <ChevronDownMini className="text-ui-fg-muted" />
          )}
          <span className="text-ui-fg-base text-sm font-medium">
            📦 View details ({entries.length}{" "}
            {entries.length === 1 ? "property" : "properties"})
          </span>
        </div>
        <Badge size="2xsmall" className="ml-2">
          {entries.length}
        </Badge>
      </button>
      {isExpanded && (
        <div className="px-4 py-3 border-t border-ui-border-base bg-ui-bg-subtle space-y-2.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Text size="small" className="text-ui-fg-muted font-semibold">
                {key}
              </Text>
              <div className="ml-3 mt-0.5">
                {typeof value === "object" && value !== null ? (
                  <CollapsibleComplexData
                    data={value}
                    nestLevel={nestLevel + 1}
                    isEditing={isEditing}
                    onChange={onChange}
                    path={[...path, key]}
                  />
                ) : (
                  formatValueDisplay(value)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
