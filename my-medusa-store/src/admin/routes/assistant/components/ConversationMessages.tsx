import { Text } from "@medusajs/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";
import type { ValidationRequest } from "../types";

interface ConversationMessagesProps {
  history: ConversationEntry[];
  validationRequest?: ValidationRequest | null;
  loading?: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

const RESPONSE_SEPARATOR = "\n\n---\n\n";

export function ConversationMessages({
  history,
  validationRequest,
  loading,
  onApprove,
  onReject,
}: ConversationMessagesProps) {
  if (history.length === 0) {
    return null;
  }

  // Check if we should show validation buttons on the last assistant message
  const lastAssistantIndex =
    history.length > 0
      ? history
          .map((e, i) => ({ ...e, index: i }))
          .reverse()
          .find((e) => e.role === "assistant")?.index ?? -1
      : -1;
  const shouldShowValidation = validationRequest && lastAssistantIndex >= 0;

  return (
    <div className="space-y-4">
      {history.map((entry, index) => {
        const displayContent =
          entry.role === "assistant"
            ? entry.content.split(RESPONSE_SEPARATOR)[0]
            : entry.content;

        const isLastAssistantMessage =
          entry.role === "assistant" && index === lastAssistantIndex;
        const showValidationButtons =
          shouldShowValidation && isLastAssistantMessage;

        return (
          <div
            key={index}
            className={`rounded-md p-4 ${
              entry.role === "user"
                ? "bg-ui-bg-base border border-ui-border-base"
                : "bg-ui-bg-subtle"
            }`}
          >
            <Text
              size="xsmall"
              weight="plus"
              className={`mb-2 uppercase ${
                entry.role === "user"
                  ? "text-ui-fg-interactive"
                  : "text-ui-fg-subtle"
              }`}
            >
              {entry.role === "user" ? "You" : "Assistant"}
            </Text>
            <div className="text-sm text-ui-fg-base">
              {entry.role === "user" ? (
                <p className="whitespace-pre-wrap">{displayContent}</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    ul: ({ ...props }) => (
                      <ul
                        className="list-disc pl-6 my-2 space-y-2"
                        {...props}
                      />
                    ),
                    ol: ({ ...props }) => (
                      <ol
                        className="list-decimal pl-6 my-2 space-y-2"
                        {...props}
                      />
                    ),
                    li: ({ ...props }) => <li className="mb-2" {...props} />,
                    p: ({ ...props }) => (
                      <p className="mb-2 leading-relaxed" {...props} />
                    ),
                    pre: ({ ...props }) => (
                      <pre
                        className="rounded bg-ui-bg-base p-3 overflow-x-auto my-3"
                        {...props}
                      />
                    ),
                    code: ({ className, children, ...props }) => (
                      <code
                        className={`bg-ui-bg-base rounded px-1 ${
                          className ?? ""
                        }`}
                        {...props}
                      >
                        {children}
                      </code>
                    ),
                    h1: ({ ...props }) => (
                      <h1
                        className="text-xl font-semibold mb-3 mt-4"
                        {...props}
                      />
                    ),
                    h2: ({ ...props }) => (
                      <h2
                        className="text-lg font-semibold mb-2 mt-3"
                        {...props}
                      />
                    ),
                    h3: ({ ...props }) => (
                      <h3
                        className="text-base font-semibold mb-2 mt-2"
                        {...props}
                      />
                    ),
                    table: ({ ...props }) => (
                      <div className="overflow-x-auto my-4">
                        <table
                          className="min-w-full border-collapse"
                          {...props}
                        />
                      </div>
                    ),
                    th: ({ ...props }) => (
                      <th
                        className="border border-ui-border-base bg-ui-bg-base px-3 py-2 text-left font-semibold"
                        {...props}
                      />
                    ),
                    td: ({ ...props }) => (
                      <td
                        className="border border-ui-border-base px-3 py-2"
                        {...props}
                      />
                    ),
                  }}
                >
                  {displayContent}
                </ReactMarkdown>
              )}
            </div>

            {showValidationButtons && validationRequest && (
              <div className="mt-4 pt-4 border-t border-ui-border-base space-y-3">
                <Text size="small" className="text-ui-fg-subtle">
                  Review the response above and confirm to execute this action.
                  Nothing happens until you click confirm.
                </Text>
                {loading ? (
                  <div
                    className="flex items-center gap-2 text-ui-fg-subtle text-sm"
                    role="status"
                    aria-live="polite"
                  >
                    <span
                      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ui-border-subtle border-t-ui-bg-interactive"
                      aria-hidden="true"
                    />
                    <span>The assistant is preparing the next step...</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onApprove?.(validationRequest.id)}
                      disabled={loading}
                      className={`rounded-md px-3 py-1.5 text-white ${
                        loading
                          ? "bg-ui-border-disabled cursor-not-allowed"
                          : "bg-ui-bg-interactive"
                      }`}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => onReject?.(validationRequest.id)}
                      className="rounded-md px-3 py-1.5 border bg-ui-bg-base text-ui-fg-base"
                      disabled={loading}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
