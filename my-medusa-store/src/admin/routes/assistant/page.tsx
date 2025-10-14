"use client";
import { useAssistant } from "./hooks/useAssistant";
import { PromptInput } from "./components/PromptInput";
import { ResponseView } from "./components/ResponseView";
import { AssistantLoading } from "./components/Loading";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import { AiAssistent } from "@medusajs/icons";

const AssistantPage = () => {
  const {
    prompt,
    setPrompt,
    answer,
    loading,
    error,
    canSubmit,
    ask,
    clear,
    cancel,
    validationRequest,
    approveValidation,
    rejectValidation,
  } = useAssistant();

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Assistant</Heading>
      </div>

      <div className="px-6 py-4 grid gap-3">
        <Text size="small">
          Ask the assistant for help with products, customers, orders,
          promotions, and more.
        </Text>

        <PromptInput value={prompt} onChange={setPrompt} onSubmit={ask} />

        <div className="flex gap-2">
          <button
            onClick={ask}
            disabled={!canSubmit}
            className={`rounded-md px-3 py-1.5 text-white ${
              canSubmit
                ? "bg-ui-bg-interactive"
                : "bg-ui-border-disabled cursor-not-allowed"
            }`}
          >
            {loading ? "Asking…" : "Ask"}
          </button>
          {loading && (
            <button
              onClick={cancel}
              className="rounded-md px-3 py-1.5 border bg-ui-bg-base text-ui-fg-base"
              disabled={!loading}
            >
              Cancel
            </button>
          )}
          <button
            onClick={clear}
            className="rounded-md px-3 py-1.5 border bg-ui-bg-base text-ui-fg-base"
            disabled={loading}
          >
            Clear
          </button>
        </div>

        {error && <div className="text-ui-fg-error">Error: {error}</div>}
        {loading && !validationRequest && (
          <div className="rounded-md border p-3 bg-ui-bg-base">
            <AssistantLoading />
          </div>
        )}

        <ResponseView answer={answer} />

        {validationRequest && (
          <div className="rounded-md border p-3 bg-ui-bg-base space-y-3">
            <Text size="small">
              Review the assistant&apos;s response above and confirm to execute
              this action. Nothing happens until you click confirm.
            </Text>
            <div className="flex gap-2">
              <button
                onClick={() => approveValidation(validationRequest.id)}
                disabled={loading}
                className={`rounded-md px-3 py-1.5 text-white ${
                  loading
                    ? "bg-ui-border-disabled cursor-not-allowed"
                    : "bg-ui-bg-interactive"
                }`}
              >
                {loading ? "Processing…" : "Confirm"}
              </button>
              <button
                onClick={() => rejectValidation(validationRequest.id)}
                className="rounded-md px-3 py-1.5 border bg-ui-bg-base text-ui-fg-base"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "AI Assistant",
  icon: AiAssistent,
});
export default AssistantPage;
