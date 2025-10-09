import { Badge, Text } from "@medusajs/ui";
import { ChevronDownMini, ChevronUpMini } from "@medusajs/icons";
import { useState, useMemo } from "react";
import { useValidationContext } from "../context/ValidationContext";
import { EditableField } from "./EditableField";
import { formatValueDisplay } from "../utils/fieldFormatters";
import { isSimpleObject } from "../utils/typeCheckers";
import { FieldPath } from "../types/field.types";

interface CollapsibleComplexDataProps {
  data: unknown;
  nestLevel?: number;
  path?: FieldPath;
}

export function CollapsibleComplexData({
  data,
  nestLevel = 0,
  path = [],
}: CollapsibleComplexDataProps) {
  const [isExpanded, setIsExpanded] = useState(nestLevel === 0);
  const { isEditing, onChange } = useValidationContext();

  // Handle non-object values
  if (typeof data !== "object" || data === null) {
    return <>{formatValueDisplay(data)}</>;
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
                      path={[...path, String(idx)]}
                    />
                  ) : (
                    <>{formatValueDisplay(item)}</>
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

  const dataAsObject = data as Record<string, unknown>;
  const isSimple = useMemo(() => isSimpleObject(dataAsObject), [dataAsObject]);

  // Editable simple object
  if (isSimple && isEditing && onChange) {
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
              ✏️ Edit details ({entries.length}{" "}
              {entries.length === 1 ? "property" : "properties"})
            </span>
          </div>
          <Badge size="2xsmall" className="ml-2">
            {entries.length}
          </Badge>
        </button>
        {isExpanded && (
          <div className="px-4 py-3 border-t border-ui-border-base bg-ui-bg-field space-y-3">
            {entries.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Text size="small" className="text-ui-fg-base font-medium">
                  {key}
                </Text>
                <div className="ml-1">
                  <EditableField value={value} path={[...path, key]} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Complex object or read-only mode
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
                    path={[...path, key]}
                  />
                ) : (
                  <>{formatValueDisplay(value)}</>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
