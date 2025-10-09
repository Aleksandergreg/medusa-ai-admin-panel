export type FieldValue = unknown;

export type FieldPath = string[];

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "array"
  | "object"
  | "null"
  | "undefined";

export interface FieldMetadata {
  path: FieldPath;
  fullPath: string;
  fieldName: string;
  type: FieldType;
  isReadOnly: boolean;
  isRequired: boolean;
  enumOptions?: string[];
}

export interface FieldEditorProps {
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  metadata: FieldMetadata;
  disabled?: boolean;
}

export interface FieldDisplayProps {
  value: FieldValue;
  metadata: FieldMetadata;
}
