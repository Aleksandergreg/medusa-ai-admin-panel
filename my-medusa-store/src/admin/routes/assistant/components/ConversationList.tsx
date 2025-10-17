import { useState } from "react";
import { Text, IconButton } from "@medusajs/ui";
import {
  Plus,
  Trash,
  EllipsisHorizontal,
  PencilSquare,
  ChevronDown,
  ChevronRight,
} from "@medusajs/icons";
import type { ConversationSummary } from "../types";
import { RenameModal, DeleteModal } from "./ConversationModals";

interface ConversationListProps {
  conversations: ConversationSummary[];
  currentSessionId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  loading: boolean;
}

export function ConversationList({
  conversations,
  currentSessionId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  loading,
}: ConversationListProps) {
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationSummary | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-ui-border-base bg-ui-bg-subtle rounded-md border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base">
        <div className="flex items-center gap-2">
          <IconButton
            size="small"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-ui-fg-subtle hover:text-ui-fg-base"
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </IconButton>
          <Text size="small" weight="plus" className="text-ui-fg-base">
            Conversations
          </Text>
        </div>
        <IconButton
          size="small"
          onClick={onCreateConversation}
          disabled={loading}
          className="text-ui-fg-subtle hover:text-ui-fg-base"
        >
          <Plus />
        </IconButton>
      </div>

      {isExpanded && (
        <div className="max-h-80 overflow-y-auto">
          {loading && conversations.length === 0 ? (
            <div className="px-4 py-8 text-center text-ui-fg-subtle text-sm">
              Loading conversations...
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-8 text-center text-ui-fg-subtle text-sm">
              No conversations yet. Create one to get started!
            </div>
          ) : (
            <div className="divide-y divide-ui-border-base">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    conversation.id === currentSessionId
                      ? "bg-ui-bg-base-pressed"
                      : "hover:bg-ui-bg-base-hover"
                  }`}
                  onClick={() => onSelectConversation(conversation.id)}
                >
                  <EllipsisHorizontal className="flex-shrink-0 text-ui-fg-muted" />
                  <div className="flex-1 min-w-0">
                    <Text
                      size="small"
                      weight={
                        conversation.id === currentSessionId
                          ? "plus"
                          : "regular"
                      }
                      className="truncate text-ui-fg-base"
                    >
                      {conversation.title}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {conversation.messageCount} messages •{" "}
                      {new Date(conversation.updatedAt).toLocaleDateString()}
                    </Text>
                  </div>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedConversation(conversation);
                      setRenameModalOpen(true);
                    }}
                    className="flex-shrink-0 text-ui-fg-subtle hover:text-ui-fg-base"
                  >
                    <PencilSquare />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedConversation(conversation);
                      setDeleteModalOpen(true);
                    }}
                    className="flex-shrink-0 text-ui-fg-subtle hover:text-ui-fg-error"
                  >
                    <Trash />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <RenameModal
        isOpen={renameModalOpen}
        currentTitle={selectedConversation?.title || ""}
        onClose={() => {
          setRenameModalOpen(false);
          setSelectedConversation(null);
        }}
        onConfirm={(newTitle) => {
          if (selectedConversation) {
            onRenameConversation(selectedConversation.id, newTitle);
          }
        }}
      />

      <DeleteModal
        isOpen={deleteModalOpen}
        conversationTitle={selectedConversation?.title || ""}
        onClose={() => {
          setDeleteModalOpen(false);
          setSelectedConversation(null);
        }}
        onConfirm={() => {
          if (selectedConversation) {
            onDeleteConversation(selectedConversation.id);
          }
        }}
      />
    </div>
  );
}
