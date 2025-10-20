function getPlaceholder() {
  return 'Ask the assistant (e.g. "How many orders do I have in 2025, grouped by month?" or "Show me products with low inventory")';
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="max-w-7xl mx-auto w-full">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={getPlaceholder()}
        rows={6}
        className="w-full border-ui-border-base bg-ui-bg-base text-ui-fg-base rounded-md border p-3 resize-none focus:outline-none focus:ring-2 focus:ring-ui-fg-interactive"
      />
    </div>
  );
}
