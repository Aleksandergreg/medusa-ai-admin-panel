import { Heading, Text } from "@medusajs/ui";
import { Sparkles } from "@medusajs/icons";

export function MetricsHeader() {
  return (
    <div className="px-6 py-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 shadow-sm">
          <Sparkles className="text-white" />
        </div>
        <div className="flex-1">
          <Heading level="h1" className="text-2xl mb-1">
            AI Assistant Metrics
          </Heading>
          <Text className="text-ui-fg-subtle">
            Monitor performance, track feedback, and analyze AI assistant
            operations
          </Text>
        </div>
      </div>
    </div>
  );
}
