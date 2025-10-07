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

function formatFieldName(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
            <Select.Trigger>
              <Select.Value placeholder="Select an option..." />
            </Select.Trigger>
            <Select.Content>
              {enumOptions.map((option) => (
                <Select.Item key={option} value={option}>
                  {formatFieldName(option)}
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
            className="text-sm font-mono"
            rows={3}
          />
        );
      }
      return (
        <Input
          value={value}
          onChange={(e) => onChange(path, e.target.value)}
          className="text-sm"
          size="small"
        />
      );
    }
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return new Date(value).toLocaleString();
    }
    return <span className="font-medium">{value}</span>;
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
      return <span className="text-ui-fg-subtle italic">None</span>;
    }
    if (typeof value[0] === "string" || typeof value[0] === "number") {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((item, idx) => (
            <Badge key={idx} size="small">
              {String(item)}
            </Badge>
          ))}
        </div>
      );
    }
  }

  if (typeof value === "object") {
    return <span className="text-ui-fg-subtle italic">Complex data</span>;
  }

  return <span>{String(value)}</span>;
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
      if (!enumPath.includes('.') && !enumPath.includes('[')) {
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
    <div className="space-y-2">
      <Text size="small" className="font-semibold text-ui-fg-base">
        {title}
      </Text>
      <div className="bg-ui-bg-base rounded-lg border p-3 space-y-3">
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
                className="space-y-2 pb-2 border-b last:border-b-0 last:pb-0"
              >
                <Text size="xsmall" className="text-ui-fg-subtle font-semibold">
                  {formatFieldName(key)}:
                </Text>
                <div className="ml-4 space-y-2">
                  {Object.entries(value as Record<string, unknown>).map(
                    ([subKey, subValue]) => (
                      <div
                        key={subKey}
                        className="flex justify-between items-center gap-4"
                      >
                        <Text
                          size="xsmall"
                          className="text-ui-fg-muted min-w-[140px]"
                        >
                          {formatFieldName(subKey)}:
                        </Text>
                        <div className="flex-1">
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
            <div key={key} className="flex justify-between items-center gap-4">
              <Text size="xsmall" className="text-ui-fg-muted min-w-[140px]">
                {formatFieldName(key)}:
              </Text>
              <div className="flex-1">
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
