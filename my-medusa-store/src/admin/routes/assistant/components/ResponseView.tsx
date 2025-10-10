import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ResponseView({ answer }: { answer: string | null }) {
  // Split the answer by the separator and take only the first part for the UI.
  const displayAnswer = answer ? answer.split("\n\n---\n\n")[0] : null;

  return (
    <>
      {displayAnswer && (
        <div className="border-ui-border-base bg-ui-bg-subtle rounded-md border p-3">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              ul: ({ ...props }) => (
                <ul className="list-disc pl-6 my-2 space-y-2" {...props} />
              ),
              ol: ({ ...props }) => (
                <ol className="list-decimal pl-6 my-2 space-y-2" {...props} />
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
                  className={`bg-ui-bg-base rounded px-1 ${className ?? ""}`}
                  {...props}
                >
                  {children}
                </code>
              ),
            }}
          >
            {displayAnswer}
          </ReactMarkdown>
        </div>
      )}
    </>
  );
}
