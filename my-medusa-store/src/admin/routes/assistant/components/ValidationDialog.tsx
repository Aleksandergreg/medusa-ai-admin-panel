import {
  Button,
  Heading,
  Text,
  Badge,
  Container,
  Input,
  Textarea,
  Switch,
  Select,
} from "@medusajs/ui";
import { useState, useEffect } from "react";
import { ChevronDownMini, ChevronUpMini } from "@medusajs/icons";

type ValidationDialogProps = {
  validationRequest: {
    id: string;
    operationId: string;
    method: string;
    path: string;
    args: Record<string, unknown>;
    bodyFieldEnums?: Record<string, string[]>;
  };
  onApprove: (
    id: string,
    editedData?: Record<string, unknown>
  ) => Promise<void>;
  onReject: (id: string) => void;
};

function formatOperationTitle(operationId: string): string {
  // Convert AdminPostPromotions -> Create Promotion
  const withoutPrefix = operationId.replace(
    /^(Admin|Store)(Post|Delete|Put|Patch)/i,
    ""
  );

  // Add spaces before capital letters and handle plural
  const spaced = withoutPrefix.replace(/([A-Z])/g, " $1").trim();

  // Determine action
  const isDelete = /Delete/i.test(operationId);
  const isUpdate = /Put|Patch/i.test(operationId);
  const isCreate = /Post/i.test(operationId);

  let action = "Modify";
  if (isDelete) action = "Delete";
  else if (isCreate) action = "Create";
  else if (isUpdate) action = "Update";

  return `${action} ${spaced}`;
}

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

function CollapsibleComplexData({
  data,
  nestLevel = 0,
}: {
  data: unknown;
  nestLevel?: number;
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

function renderValue(
  value: unknown,
  isEditing: boolean,
  path: string[],
  onChange?: (path: string[], newValue: unknown) => void,
  bodyFieldEnums?: Record<string, string[]>
): React.ReactNode {
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
      // Try both full path (e.g., "application_method.type") and last element (e.g., "type")
      const fullPath = path.join(".");
      const fieldName = path[path.length - 1];
      const enumOptions =
        bodyFieldEnums?.[fullPath] || bodyFieldEnums?.[fieldName];

      if (enumOptions && enumOptions.length > 0) {
        const stringValue = String(value);
        const valueInOptions = enumOptions.includes(stringValue);

        console.log(`🎯 Rendering dropdown for "${fullPath}"`, {
          currentValue: value,
          currentValueType: typeof value,
          stringValue,
          valueInOptions,
          options: enumOptions,
        });

        // If current value is not in options, use the first option or empty string
        const selectValue = valueInOptions ? stringValue : enumOptions[0] || "";

        return (
          <Select
            value={selectValue}
            onValueChange={(val) => {
              console.log(
                `📝 Dropdown changed from "${selectValue}" to "${val}" for ${fullPath}`
              );
              onChange(path, val);
            }}
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
      } else if (bodyFieldEnums) {
        // Debug: show when we're NOT finding an enum for a field
        console.log(
          `ℹ️ No enum found for "${fullPath}" (tried: "${fullPath}", "${fieldName}")`
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
    // Handle array of complex objects
    return <CollapsibleComplexData data={value} nestLevel={0} />;
  }

  if (typeof value === "object") {
    return <CollapsibleComplexData data={value} nestLevel={0} />;
  }

  return <span className="font-medium text-ui-fg-base">{String(value)}</span>;
}

function renderDetailsSection(
  title: string,
  data: Record<string, unknown>,
  isEditing: boolean,
  onChange?: (path: string[], value: unknown) => void,
  bodyFieldEnums?: Record<string, string[]>
) {
  const entries = Object.entries(data).filter(([, value]) => {
    // Filter out operationId and other internal fields
    return value !== undefined && value !== null;
  });

  // Add missing top-level enum fields when editing
  const missingEnumFields: [string, null][] = [];
  if (isEditing && bodyFieldEnums) {
    Object.keys(bodyFieldEnums).forEach((enumPath) => {
      // Only add top-level fields (no dots, no brackets)
      if (!enumPath.includes(".") && !enumPath.includes("[")) {
        // Check if field is missing from data
        if (!(enumPath in data)) {
          missingEnumFields.push([enumPath, null]);
        }
      }
    });
  }

  const allEntries = [...entries, ...missingEnumFields];

  if (allEntries.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Text size="base" className="font-semibold text-ui-fg-base">
          📋 {title}
        </Text>
        <Badge size="2xsmall" color="grey">
          {allEntries.length}
        </Badge>
      </div>
      <div className="bg-ui-bg-base rounded-lg border border-ui-border-base p-4 space-y-4">
        {entries.map(([key, value]) => {
          if (key === "operationId" || key === "body") return null;

          // Handle nested objects
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            return (
              <div
                key={key}
                className="space-y-3 pb-4 border-b border-ui-border-base last:border-b-0 last:pb-0"
              >
                <Text size="small" className="text-ui-fg-base font-semibold">
                  {key}
                </Text>
                <div className="ml-4 space-y-3 pl-3 border-l-2 border-ui-border-strong">
                  {Object.entries(value as Record<string, unknown>).map(
                    ([subKey, subValue]) => (
                      <div
                        key={subKey}
                        className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2"
                      >
                        <Text
                          size="small"
                          className="text-ui-fg-subtle font-medium min-w-[160px]"
                        >
                          {subKey}
                        </Text>
                        <div className="flex-1 min-w-0">
                          {renderValue(
                            subValue,
                            isEditing,
                            [key, subKey],
                            onChange,
                            bodyFieldEnums
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={key}
              className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2"
            >
              <Text
                size="small"
                className="text-ui-fg-subtle font-medium min-w-[160px]"
              >
                {key}
              </Text>
              <div className="flex-1 min-w-0">
                {renderValue(value, isEditing, [key], onChange, bodyFieldEnums)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

export function ValidationDialog({
  validationRequest,
  onApprove,
  onReject,
}: ValidationDialogProps) {
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Extract body or use args directly
  const originalData =
    (validationRequest.args.body as Record<string, unknown>) ||
    validationRequest.args;

  const [editedData, setEditedData] = useState<Record<string, unknown>>(() =>
    deepClone(originalData)
  );

  // Reset edited data when validation request changes
  useEffect(() => {
    const data =
      (validationRequest.args.body as Record<string, unknown>) ||
      validationRequest.args;
    setEditedData(deepClone(data));
    setIsEditing(false);

    // Debug: Log enum fields
    if (validationRequest.bodyFieldEnums) {
      console.log(
        "📋 Enum fields available:",
        validationRequest.bodyFieldEnums
      );
    }
  }, [
    validationRequest.id,
    validationRequest.args,
    validationRequest.bodyFieldEnums,
  ]);

  const handleApprove = async () => {
    setLoading(true);
    try {
      // Always send edited data for POST operations if we have any edits
      if (isPost) {
        console.log("Approving with edited data:", editedData);
        await onApprove(validationRequest.id, editedData);
      } else {
        await onApprove(validationRequest.id);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = () => {
    onReject(validationRequest.id);
  };

  const operationTitle = formatOperationTitle(validationRequest.operationId);
  const isDelete = validationRequest.method === "DELETE";
  const isPost = validationRequest.method === "POST";

  const displayData = isEditing ? editedData : originalData;

  return (
    <Container className="p-0 bg-ui-bg-highlight border-2 border-ui-border-interactive">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{isDelete ? "🗑️" : "✨"}</div>
            <div>
              <Heading level="h2" className="text-ui-fg-base">
                {operationTitle}
              </Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Please review and approve this action
              </Text>
            </div>
          </div>
          <Badge color={isDelete ? "red" : "blue"} size="small">
            {validationRequest.method}
          </Badge>
        </div>

        {/* Warning for delete operations */}
        {isDelete && (
          <div className="bg-ui-bg-subtle-error border border-ui-border-error rounded-lg p-3">
            <Text size="small" className="text-ui-fg-error font-medium">
              ⚠️ Warning: This action cannot be undone
            </Text>
          </div>
        )}

        {/* Edit Mode Toggle for POST operations */}
        {isPost && !loading && (
          <div className="flex items-center justify-between bg-ui-bg-base rounded-lg border p-3">
            <div>
              <Text size="small" className="font-medium">
                {isEditing ? "📝 Editing Mode" : "👁️ Review Mode"}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                {isEditing
                  ? "You can modify the values below"
                  : "Enable editing to modify the AI's suggestions"}
              </Text>
            </div>
            <Button
              onClick={() => setIsEditing(!isEditing)}
              variant={isEditing ? "primary" : "secondary"}
              size="small"
            >
              {isEditing ? "✓ Done Editing" : "✏️ Edit Values"}
            </Button>
          </div>
        )}

        {/* Details */}
        <div className="space-y-4">
          {renderDetailsSection(
            "Details",
            displayData as Record<string, unknown>,
            isEditing && isPost,
            (path, value) => {
              setEditedData((prevData) => {
                const newData = deepClone(prevData);
                setNestedValue(newData, path, value);
                return newData;
              });
            },
            validationRequest.bodyFieldEnums
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t">
          <Button
            onClick={handleApprove}
            disabled={loading}
            variant="primary"
            size="large"
            className="flex-1"
          >
            {loading
              ? "Processing..."
              : isDelete
              ? "⚠️ Confirm Delete"
              : isEditing
              ? "✓ Approve with Changes"
              : "✓ Approve & Execute"}
          </Button>
          <Button
            onClick={handleReject}
            disabled={loading}
            variant="secondary"
            size="large"
            className="flex-1"
          >
            ✕ Cancel
          </Button>
        </div>
      </div>
    </Container>
  );
}
