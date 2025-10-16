import { Text } from "@medusajs/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

interface ConversationMessagesProps {
    history: ConversationEntry[];
}

const RESPONSE_SEPARATOR = "\n\n---\n\n";

export function ConversationMessages({ history }: ConversationMessagesProps) {
    if (history.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            {history.map((entry, index) => {
                const displayContent =
                    entry.role === "assistant"
                        ? entry.content.split(RESPONSE_SEPARATOR)[0]
                        : entry.content;

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
                                        li: ({ ...props }) => (
                                            <li className="mb-2" {...props} />
                                        ),
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
                                                className={`bg-ui-bg-base rounded px-1 ${className ?? ""}`}
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
                    </div>
                );
            })}
        </div>
    );
}
