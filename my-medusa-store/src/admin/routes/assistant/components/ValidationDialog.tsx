import { Button, Heading, Text, Badge, Container } from "@medusajs/ui";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  deepClone,
  formatOperationTitle,
  setNestedValue,
} from "./validation/helpers";
import { DetailsSectionNew } from "./validation";
import type { ValidationRequest } from "../types";

type ValidationDialogProps = {
  validationRequest: ValidationRequest;
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
  const originalData = useMemo(
    () =>
      (validationRequest.args.body as Record<string, unknown>) ||
      validationRequest.args,
    [validationRequest.args]
  );

  const [editedData, setEditedData] = useState<Record<string, unknown>>(() =>
    deepClone(originalData)
  );

  // Memoize operation metadata
  const operationMetadata = useMemo(
    () => ({
      title: formatOperationTitle(validationRequest.operationId),
      isDelete: validationRequest.method === "DELETE",
      isPost: validationRequest.method === "POST",
      method: validationRequest.method,
    }),
    [validationRequest.operationId, validationRequest.method]
  );

  // Reset edited data when validation request changes
  useEffect(() => {
    const data =
      (validationRequest.args.body as Record<string, unknown>) ||
      validationRequest.args;
    setEditedData(deepClone(data));
    setIsEditing(false);
    setHasChanges(false);

  }, [
    validationRequest.id,
    validationRequest.args,
    validationRequest.bodyFieldEnums,
    validationRequest.bodyFieldReadOnly,
  ]);

  // Memoized handlers
  const handleRevert = useCallback(() => {
    setEditedData(deepClone(originalData));
    setHasChanges(false);
    setIsEditing(false);
  }, [originalData]);

  const handleApprove = useCallback(async () => {
    setLoading(true);
    try {
      // Always send edited data for POST operations if we have any edits
      if (operationMetadata.isPost) {
        await onApprove(validationRequest.id, editedData);
      } else {
        await onApprove(validationRequest.id);
      }
    } finally {
      setLoading(false);
    }
  }, [operationMetadata.isPost, editedData, onApprove, validationRequest.id]);

  const handleReject = useCallback(() => {
    onReject(validationRequest.id);
  }, [onReject, validationRequest.id]);

  const handleFieldChange = useCallback((path: string[], value: unknown) => {
    setHasChanges(true);
    setEditedData((prevData) => {
      const newData = deepClone(prevData);
      setNestedValue(newData, path, value);
      return newData;
    });
  }, []);

  const handleToggleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  const displayData = hasChanges ? editedData : originalData;

  return (
    <Container className="p-0 bg-ui-bg-highlight border-2 border-ui-border-interactive">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl">
              {operationMetadata.isDelete ? "🗑️" : "✨"}
            </div>
            <div>
              <Heading level="h2" className="text-ui-fg-base">
                {operationMetadata.title}
              </Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Please review and approve this action
              </Text>
            </div>
          </div>
          <Badge
            color={operationMetadata.isDelete ? "red" : "blue"}
            size="small"
          >
            {operationMetadata.method}
          </Badge>
        </div>

        {/* Warning for delete operations */}
        {operationMetadata.isDelete && (
          <div className="bg-ui-bg-subtle-error border border-ui-border-error rounded-lg p-3">
            <Text size="small" className="text-ui-fg-error font-medium">
              ⚠️ Warning: This action cannot be undone
            </Text>
          </div>
        )}

        {/* Edit Mode Toggle for POST operations */}
        {operationMetadata.isPost && !loading && (
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
                onClick={handleToggleEdit}
                variant={isEditing ? "primary" : "secondary"}
                size="small"
              >
                {isEditing ? "✓ Done Editing" : "✏️ Edit Values"}
              </Button>
            </div>
          </div>
        )}

        {/* Details - Using new refactored component */}
        <div className="space-y-4">
          <DetailsSectionNew
            title="Details"
            data={displayData as Record<string, unknown>}
            isEditing={isEditing && operationMetadata.isPost}
            onChange={handleFieldChange}
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
              : operationMetadata.isDelete
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
