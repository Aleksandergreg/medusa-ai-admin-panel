"use client";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "./hooks/useAssistant";
import { PromptInput } from "./components/PromptInput";
import { ConversationMessages } from "./components/ConversationMessages";
import { ConversationList } from "./components/ConversationList";
import { CreateModal } from "./components/ConversationModals";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, IconButton } from "@medusajs/ui";
import { AiAssistent, Plus } from "@medusajs/icons";

const AssistantPage = () => {
  const {
    prompt,
    setPrompt,
    history,
    conversations,
    conversationsLoading,
    currentSessionId,
    loading,
    isMutating,
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

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [displayedConversationTitle, setDisplayedConversationTitle] = useState<
    string | null
  >(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [history, loading]);

  const handleCreateConversation = (title: string) => {
    createConversation(title);
  };

  const currentConversation = conversations.find(
    (c) => c.id === currentSessionId
  );

  // Keep the displayed title in sync, but don't clear it immediately
  useEffect(() => {
    if (currentConversation?.title) {
      setDisplayedConversationTitle(currentConversation.title);
    }
  }, [currentConversation?.title]);

  return (
    <Container className="divide-y p-0">
      <div className="sticky top-0 z-10 bg-ui-bg-base flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
        <Heading level="h1">Assistant</Heading>

        {currentSessionId && displayedConversationTitle && (
          <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
            <Text size="small" className="text-ui-fg-muted">
              Current Conversation:
            </Text>
            <Text size="base" weight="plus" className="text-ui-fg-base italic">
              {displayedConversationTitle}
            </Text>
          </div>
        )}

        <IconButton
          size="small"
          onClick={() => setCreateModalOpen(true)}
          disabled={conversationsLoading}
          className="text-ui-fg-subtle hover:text-ui-fg-base"
        >
          <Plus />
        </IconButton>
      </div>

      <div className="px-6 py-4 grid gap-3">
        <ConversationList
          conversations={conversations}
          currentSessionId={currentSessionId}
          onSelectConversation={switchConversation}
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
            isMutating={isMutating}
            onApprove={approveValidation}
            onReject={rejectValidation}
          />
        </div>

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
                className="rounded-md px-4 py-2 border border-ui-border-error text-ui-fg-error hover:bg-ui-bg-error-hover"
                disabled={!loading}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <CreateModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onConfirm={handleCreateConversation}
      />
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "AI Assistant",
  icon: AiAssistent,
});
export default AssistantPage;
