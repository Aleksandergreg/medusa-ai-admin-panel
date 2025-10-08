import { createContext, useContext, ReactNode } from "react";
import { ValidationContext } from "../types/validation.types";

const ValidationContextInstance = createContext<ValidationContext | undefined>(
  undefined
);

export interface ValidationProviderProps {
  children: ReactNode;
  value: ValidationContext;
}

export function ValidationProvider({
  children,
  value,
}: ValidationProviderProps) {
  return (
    <ValidationContextInstance.Provider value={value}>
      {children}
    </ValidationContextInstance.Provider>
  );
}

export function useValidationContext(): ValidationContext {
  const context = useContext(ValidationContextInstance);
  if (!context) {
    throw new Error(
      "useValidationContext must be used within a ValidationProvider"
    );
  }
  return context;
}
