import { useState } from "react";
import { Text } from "@medusajs/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";
import { ChevronDownMini, ChevronUpMini } from "@medusajs/icons";

interface ChatHistoryProps {
    history: ConversationEntry[];
}

const RESPONSE_SEPARATOR = "\n\n---\n\n";

export function ChatHistory({ history }: ChatHistoryProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (history.length === 0) {
        return null;
    }

    return (
        <div className="border-ui-border-base bg-ui-bg-subtle rounded-md border">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-ui-bg-base-hover transition-colors"
            >
                <Text size="small" weight="plus" className="text-ui-fg-base">
                    Chat History ({history.length} messages)
                </Text>
                {isExpanded ? (
                    <ChevronUpMini className="text-ui-fg-muted" />
                ) : (
                    <ChevronDownMini className="text-ui-fg-muted" />
                )}
            </button>

            {isExpanded && (
                <div className="border-t border-ui-border-base px-4 py-3 space-y-4 max-h-96 overflow-y-auto">
                    {history.map((entry, index) => {
                        const displayContent =
                            entry.role === "assistant"
                                ? entry.content.split(RESPONSE_SEPARATOR)[0]
                                : entry.content;

                        return (
                            <div
                                key={index}
                                className={`rounded-md p-3 ${
                                    entry.role === "user"
                                        ? "bg-ui-bg-base border border-ui-border-base"
                                        : "bg-ui-bg-component"
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
                                                        className="list-disc pl-6 my-2 space-y-1"
                                                        {...props}
                                                    />
                                                ),
                                                ol: ({ ...props }) => (
                                                    <ol
                                                        className="list-decimal pl-6 my-2 space-y-1"
                                                        {...props}
                                                    />
                                                ),
                                                li: ({ ...props }) => (
                                                    <li className="mb-1" {...props} />
                                                ),
                                                p: ({ ...props }) => (
                                                    <p className="mb-2 leading-relaxed" {...props} />
                                                ),
                                                pre: ({ ...props }) => (
                                                    <pre
                                                        className="rounded bg-ui-bg-base p-2 overflow-x-auto my-2"
                                                        {...props}
                                                    />
                                                ),
                                                code: ({ className, children, ...props }) => (
                                                    <code
                                                        className={`bg-ui-bg-base rounded px-1 ${className ?? ""}`}
                                                        {...props}
                                                    >
                                                        {children}
                                                    </code>
                                                ),
                                                h1: ({ ...props }) => (
                                                    <h1
                                                        className="text-lg font-semibold mb-2"
                                                        {...props}
                                                    />
                                                ),
                                                h2: ({ ...props }) => (
                                                    <h2
                                                        className="text-base font-semibold mb-2"
                                                        {...props}
                                                    />
                                                ),
                                                h3: ({ ...props }) => (
                                                    <h3
                                                        className="text-sm font-semibold mb-1"
                                                        {...props}
                                                    />
                                                ),
                                            }}
                                        >
                                            {displayContent}
                                        </ReactMarkdown>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
