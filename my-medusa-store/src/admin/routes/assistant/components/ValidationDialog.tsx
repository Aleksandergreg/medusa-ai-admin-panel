import { Button, Heading, Text, Badge, Container } from "@medusajs/ui";
import { useState } from "react";

type ValidationDialogProps = {
  validationRequest: {
    id: string;
    operationId: string;
    method: string;
    path: string;
    args: Record<string, unknown>;
  };
  onApprove: (id: string) => Promise<void>;
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

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-ui-fg-subtle italic">Not set</span>;
  }

  if (typeof value === "boolean") {
    return (
      <Badge color={value ? "green" : "grey"}>{value ? "Yes" : "No"}</Badge>
    );
  }

  if (typeof value === "string") {
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      // Format date
      return new Date(value).toLocaleString();
    }
    return <span className="font-medium">{value}</span>;
  }

  if (typeof value === "number") {
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

function renderDetailsSection(title: string, data: Record<string, unknown>) {
  const entries = Object.entries(data).filter(([, value]) => {
    // Filter out operationId and other internal fields
    return value !== undefined && value !== null;
  });

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <Text size="small" className="font-semibold text-ui-fg-base">
        {title}
      </Text>
      <div className="bg-ui-bg-base rounded-lg border p-3 space-y-2">
        {entries.map(([key, value]) => {
          if (key === "operationId" || key === "body") return null;

          // Handle nested objects
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            return (
              <div key={key} className="space-y-1">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {formatFieldName(key)}:
                </Text>
                <div className="ml-4 space-y-1">
                  {Object.entries(value as Record<string, unknown>).map(
                    ([subKey, subValue]) => (
                      <div
                        key={subKey}
                        className="flex justify-between items-start gap-4"
                      >
                        <Text
                          size="xsmall"
                          className="text-ui-fg-muted min-w-[120px]"
                        >
                          {formatFieldName(subKey)}:
                        </Text>
                        <div className="flex-1 text-right">
                          {renderValue(subValue)}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={key} className="flex justify-between items-start gap-4">
              <Text size="xsmall" className="text-ui-fg-muted min-w-[120px]">
                {formatFieldName(key)}:
              </Text>
              <div className="flex-1 text-right">{renderValue(value)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ValidationDialog({
  validationRequest,
  onApprove,
  onReject,
}: ValidationDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(validationRequest.id);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = () => {
    onReject(validationRequest.id);
  };

  const operationTitle = formatOperationTitle(validationRequest.operationId);
  const isDelete = validationRequest.method === "DELETE";

  // Extract body or use args directly
  const data =
    (validationRequest.args.body as Record<string, unknown>) ||
    validationRequest.args;

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

        {/* Details */}
        <div className="space-y-4">
          {renderDetailsSection("Details", data as Record<string, unknown>)}
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
