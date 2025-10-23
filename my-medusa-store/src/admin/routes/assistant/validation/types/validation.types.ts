export interface ValidationContext {
  bodyFieldEnums?: Record<string, string[]>;
  isEditing: boolean;
  onChange?: (path: string[], value: unknown) => void;
}

export interface ValidationRequestData {
  id: string;
  operationId: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
  bodyFieldEnums?: Record<string, string[]>;
}

export type ValidationState = {
  editedData: Record<string, unknown>;
  hasChanges: boolean;
  validationErrors: Record<string, string>;
};
