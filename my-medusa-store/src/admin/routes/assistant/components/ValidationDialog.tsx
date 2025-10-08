import { Button, Heading, Text, Badge, Container } from "@medusajs/ui";
import { useState, useEffect } from "react";
import {
  deepClone,
  formatOperationTitle,
  setNestedValue,
} from "./validation/helpers";
import { DetailsSection } from "./validation/DetailsSection";

type ValidationDialogProps = {
  validationRequest: {
    id: string;
    operationId: string;
    method: string;
    path: string;
    args: Record<string, unknown>;
    bodyFieldEnums?: Record<string, string[]>;
    bodyFieldReadOnly?: string[];
  };
  onApprove: (
    id: string,
    editedData?: Record<string, unknown>
  ) => Promise<void>;
  onReject: (id: string) => void;
};

export function ValidationDialog({
  validationRequest,
  onApprove,
  onReject,
}: ValidationDialogProps) {
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

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
    setHasChanges(false);

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

  const handleRevert = () => {
    setEditedData(deepClone(originalData));
    setHasChanges(false);
    setIsEditing(false);
  };

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

  const displayData = hasChanges ? editedData : originalData;

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
                {isEditing
                  ? "📝 Editing Mode"
                  : hasChanges
                  ? "🔍 Reviewing Changes"
                  : "👁️ Review Mode"}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                {isEditing
                  ? "You can modify the values below"
                  : hasChanges
                  ? "Review your changes before approving"
                  : "Enable editing to modify the AI's suggestions"}
              </Text>
            </div>
            <div className="flex items-center gap-2">
              {hasChanges && !isEditing && (
                <Button onClick={handleRevert} variant="danger" size="small">
                  Discard
                </Button>
              )}
              <Button
                onClick={() => setIsEditing(!isEditing)}
                variant={isEditing ? "primary" : "secondary"}
                size="small"
              >
                {isEditing ? "✓ Done Editing" : "✏️ Edit Values"}
              </Button>
            </div>
          </div>
        )}

        {/* Details */}
        <div className="space-y-4">
          <DetailsSection
            title="Details"
            data={displayData as Record<string, unknown>}
            isEditing={isEditing && isPost}
            onChange={(path, value) => {
              setHasChanges(true);
              setEditedData((prevData) => {
                const newData = deepClone(prevData);
                setNestedValue(newData, path, value);
                return newData;
              });
            }}
            bodyFieldEnums={validationRequest.bodyFieldEnums}
            bodyFieldReadOnly={validationRequest.bodyFieldReadOnly}
          />
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
              : hasChanges
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
