import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type FeedbackMarkdownTextProps = {
  content: string;
  className?: string;
};

export function FeedbackMarkdownText({
  content,
  className,
}: FeedbackMarkdownTextProps) {
  if (!content) {
    return null;
  }

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          root: ({ children }) => <>{children}</>,
          p: ({ className: providedClassName, ...props }) => (
            <p
              {...props}
              className={`m-0 leading-relaxed ${
                providedClassName ?? ""
              }`.trim()}
            />
          ),
          strong: ({ className: providedClassName, ...props }) => (
            <strong
              {...props}
              className={`font-semibold ${providedClassName ?? ""}`.trim()}
            />
          ),
          em: ({ className: providedClassName, ...props }) => (
            <em
              {...props}
              className={`italic ${providedClassName ?? ""}`.trim()}
            />
          ),
          code: ({ className: codeClassName, ...props }) => (
            <code
              {...props}
              className={`rounded bg-ui-bg-base px-1 py-0.5 text-xs font-mono ${
                codeClassName ?? ""
              }`.trim()}
            />
          ),
          a: ({ className: providedClassName, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-ui-fg-interactive underline ${
                providedClassName ?? ""
              }`.trim()}
            />
          ),
          br: () => <br />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
