// Components
export { EditableField } from "./components/EditableField";
export { CollapsibleComplexData } from "./components/CollapsibleComplexData";
export { DetailsSection } from "./components/DetailsSection";

// Field editors
export { TextFieldEditor } from "./components/fields/TextFieldEditor";
export { NumberFieldEditor } from "./components/fields/NumberFieldEditor";
export { SelectFieldEditor } from "./components/fields/SelectFieldEditor";

// Context
export {
  ValidationProvider,
  useValidationContext,
} from "./context/ValidationContext";

// Hooks
export { useReadOnlyCheck } from "./hooks/useReadOnlyCheck";
export { useFieldMetadata } from "./hooks/useFieldMetadata";

// Types
export type {
  FieldValue,
  FieldPath,
  FieldType,
  FieldMetadata,
  FieldEditorProps,
  FieldDisplayProps,
} from "./types/field.types";
export type {
  ValidationContext,
  ValidationRequestData,
  ValidationState,
} from "./types/validation.types";

// Utilities
export {
  getFieldType,
  isDateString,
  isPrimitive,
  isSimpleObject,
  isObject,
  isArray,
  isString,
  isNumber,
  isBoolean,
} from "./utils/typeCheckers";
export {
  formatValueDisplay,
  formatFieldName,
  truncateText,
  isLongText,
} from "./utils/fieldFormatters";
export {
  validateRequired,
  validateNumber,
  validateNumberRange,
  validateEmail,
  validateUrl,
  validatePattern,
  validateEnum,
} from "./utils/fieldValidators";

// Helpers
export {
  deepClone,
  formatOperationTitle,
  setNestedValue,
} from "./lib/helpers";
