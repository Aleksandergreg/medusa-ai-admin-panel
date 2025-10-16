"use client";
import { useEffect, useRef } from "react";
import { useAssistant } from "./hooks/useAssistant";
import { PromptInput } from "./components/PromptInput";
import { AssistantLoading } from "./components/Loading";
import { ConversationMessages } from "./components/ConversationMessages";
import { ConversationList } from "./components/ConversationList";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import { AiAssistent } from "@medusajs/icons";

const AssistantPage = () => {
  const {
    prompt,
    setPrompt,
    history,
    conversations,
    conversationsLoading,
    currentSessionId,
    loading,
    error,
    canSubmit,
    ask,
    clear,
    cancel,
    validationRequest,
    approveValidation,
    rejectValidation,
    createConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
  } = useAssistant();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [history, loading]);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Assistant</Heading>
      </div>

      <div className="px-6 py-4 grid gap-3">
        <ConversationList
          conversations={conversations}
          currentSessionId={currentSessionId}
          onSelectConversation={switchConversation}
          onCreateConversation={createConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          loading={conversationsLoading}
        />

        {history.length === 0 && (
          <div className="w-full">
            <Text size="small" className="text-ui-fg-subtle text-center py-8">
              Ask the assistant for help with products, customers, orders,
              promotions, and more.
            </Text>
          </div>
        )}

        <div className="w-full">
          <ConversationMessages
            history={history}
            validationRequest={validationRequest}
            loading={loading}
            onApprove={approveValidation}
            onReject={rejectValidation}
          />
        </div>

        {loading && !validationRequest && (
          <div className="rounded-md border p-3 bg-ui-bg-base">
            <AssistantLoading />
          </div>
        )}

        {error && <div className="text-ui-fg-error">Error: {error}</div>}

        <div ref={messagesEndRef} />

        <div className="sticky bottom-0 bg-ui-bg-base pt-3 pb-2 space-y-3 border-t border-ui-border-base">
          <PromptInput value={prompt} onChange={setPrompt} onSubmit={ask} />

          <div className="flex gap-2 justify-center">
            <button
              onClick={ask}
              disabled={!canSubmit}
              className={`rounded-md px-4 py-2 text-white ${
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
                className="rounded-md px-4 py-2 border bg-ui-bg-base text-ui-fg-base"
                disabled={!loading}
              >
                Cancel
              </button>
            )}
            <button
              onClick={clear}
              className="rounded-md px-4 py-2 border bg-ui-bg-base text-ui-fg-base"
              disabled={loading}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "AI Assistant",
  icon: AiAssistent,
});
export default AssistantPage;
