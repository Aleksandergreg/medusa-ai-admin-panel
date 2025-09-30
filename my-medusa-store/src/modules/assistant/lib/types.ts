export type McpTool = {
  name: string;
  description?: string;
  input_schema?: any;
};

export type HistoryEntry = {
  tool_name: string;
  tool_args: any;
  tool_result: any;
};

export type ConversationEntry = {
  role: "user" | "assistant";
  content: string;
};

export type ChartType = "bar" | "line";

export type ChartSpec = {
  type: "chart";
  chart: ChartType;
  title: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, string | number>>;
};

export type InitialOperation = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
};
