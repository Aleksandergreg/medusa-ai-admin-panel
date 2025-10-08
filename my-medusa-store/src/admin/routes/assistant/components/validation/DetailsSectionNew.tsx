import { Badge, Text } from "@medusajs/ui";
import { ValidationProvider } from "../validation/context/ValidationContext";
import { EditableFieldNew } from "../validation/components/EditableFieldNew";

type DetailsSectionNewProps = {
  title: string;
  data: Record<string, unknown>;
  isEditing: boolean;
  onChange?: (path: string[], value: unknown) => void;
  bodyFieldEnums?: Record<string, string[]>;
  bodyFieldReadOnly?: string[];
};

export function DetailsSectionNew({
  title,
  data,
  isEditing,
  onChange,
  bodyFieldEnums,
  bodyFieldReadOnly,
}: DetailsSectionNewProps) {
  const entries = Object.entries(data).filter(([, value]) => {
    return value !== undefined && value !== null;
  });

  // Add missing enum fields if in editing mode
  const missingEnumFields: [string, null][] = [];
  if (isEditing && bodyFieldEnums) {
    Object.keys(bodyFieldEnums).forEach((enumPath) => {
      if (!enumPath.includes(".") && !enumPath.includes("[")) {
        if (!(enumPath in data)) {
          missingEnumFields.push([enumPath, null]);
        }
      }
    });
  }

  const allEntries = [...entries, ...missingEnumFields];

  if (allEntries.length === 0) return null;

  return (
    <ValidationProvider
      value={{
        bodyFieldEnums,
        bodyFieldReadOnly,
        isEditing,
        onChange,
      }}
    >
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
          {allEntries.map(([key, value]) => {
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
                            <EditableFieldNew
                              value={subValue}
                              path={[key, subKey]}
                            />
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            }

            // Handle simple fields
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
                  <EditableFieldNew value={value} path={[key]} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ValidationProvider>
  );
}
