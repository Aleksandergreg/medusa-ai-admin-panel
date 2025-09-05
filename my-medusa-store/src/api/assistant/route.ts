import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";
import { metricsStore, withToolLogging } from "../../lib/metrics/store";

/* ---------------- Types ---------------- */

type McpTool = {
  name: string;
  description?: string;
  input_schema?: any;
};

type HistoryEntry = {
  tool_name: string;
  tool_args: any;
  tool_result: any;
};

type ChartType = "bar" | "line";

type ChartSpec = {
  type: "chart";
  chart: ChartType;
  title: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, string | number>>;
};

/* ---------------- Utils ---------------- */

function env(key: string): string | undefined {
  return (process.env as any)?.[key];
}

function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text?.match?.(fence);
  return m ? m[1] : text;
}

function safeParseJSON(maybeJson: unknown): any | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return undefined;
  try {
    return JSON.parse(stripped.slice(first, last + 1));
  } catch {
    return undefined;
  }
}

// MCP result: { content: [{ type:"text", text: "...json..." }], isError? }
function extractToolJsonPayload(toolResult: any): any | undefined {
  try {
    const textItem = toolResult?.content?.find?.((c: any) => c?.type === "text");
    if (textItem?.text) return safeParseJSON(textItem.text);
  } catch {}
  return undefined;
}

// Normalize LLM tool args to match Medusa Admin expectations
function normalizeToolArgs(input: any): any {
  const needsDollar = new Set([
    "gt","gte","lt","lte","eq","ne","in","nin","not","like","ilike","re","fulltext",
    "overlap","contains","contained","exists","and","or",
  ]);

  const toNumberIfNumericString = (v: unknown) =>
    typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;

  const walk = (val: any, keyPath: string[] = []): any => {
    if (Array.isArray(val)) {
      const lastKey = keyPath[keyPath.length - 1];
      if (lastKey === "fields") return val.map(String).join(",");
      return val.map((v) => walk(v, keyPath));
    }
    if (val && typeof val === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const bare = k.replace(/^\$/g, "");
        const newKey = needsDollar.has(bare) ? `$${bare}` : k;
        out[newKey] = walk(v, [...keyPath, newKey]);
      }
      return out;
    }
    const last = keyPath[keyPath.length - 1];
    if (last === "limit" || last === "offset") return toNumberIfNumericString(val);
    return val;
  };

  return walk(input);
}

/* ---------------- Chart building (generic only + child-objects) ---------------- */

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const X_PRIORITIES = ["month","label","date","day","bucket","name","email","id","year"];
const Y_PRIORITIES = ["count","total","amount","revenue","value","quantity","orders","customers","items","sum","avg","median","min","max"];

const isObj = (v: any): v is Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v);

// Depth-first: first array of objects we can chart
function findArrayOfObjects(node: any, depth = 0): any[] | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(node) && node.length && isObj(node[0])) return node;
  if (!isObj(node)) return undefined;
  for (const v of Object.values(node)) {
    const found = findArrayOfObjects(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function monthify(key: string, v: any): any {
  if (key === "month" && typeof v === "number" && v >= 1 && v <= 12) {
    return MONTHS_SHORT[(v - 1 + 12) % 12];
  }
  return v;
}

function pickXY(row: Record<string, any>) {
  let xKey = X_PRIORITIES.find((k) => k in row && (typeof row[k] === "string" || typeof row[k] === "number"));
  let yKey = Y_PRIORITIES.find((k) => k in row && typeof row[k] === "number");
  if (!xKey) xKey = Object.keys(row).find((k) => typeof row[k] === "string" || typeof row[k] === "number");
  if (!yKey) yKey = Object.keys(row).find((k) => typeof row[k] === "number" && k !== xKey);
  return { xKey, yKey };
}

/** If a tool already returns a chart spec, honor it. */
function coerceChartSpec(payload: any): ChartSpec | undefined {
  if (payload?.type === "chart" && Array.isArray(payload?.data)) {
    const s = payload as ChartSpec;
    if (s.chart === "bar" || s.chart === "line") return s;
  }
  return undefined;
}

/** If a tool returns a neutral series, use it. */
function chartFromSeries(payload: any, chartType: ChartType, title?: string): ChartSpec | undefined {
  const series = Array.isArray(payload?.series) ? payload.series : undefined;
  if (!series || !series.length || !isObj(series[0])) return undefined;

  const sample = series[0] as Record<string, any>;
  const xKey = typeof payload?.xKey === "string"
    ? payload.xKey
    : ("label" in sample ? "label" : "x" in sample ? "x" : undefined);
  const yKey = typeof payload?.yKey === "string"
    ? payload.yKey
    : ("count" in sample ? "count" : "y" in sample ? "y" : undefined);
  if (!xKey || !yKey) return undefined;

  const rows = series.slice(0, 100).map((r: any) => ({
    [xKey]: monthify(xKey, r[xKey]),
    [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
  }));

  return {
    type: "chart",
    chart: chartType,
    title: payload?.title || title || "Results",
    xKey,
    yKey,
    data: rows,
  };
}

/** NEW: generic-from-child-objects. */
function chartFromChildObjects(payload: any, chartType: ChartType, title?: string): ChartSpec | undefined {
  if (!isObj(payload)) return undefined;

  const entries = Object.entries(payload)
    .filter(([_, v]) => isObj(v)) as [string, Record<string, any>][];
  if (entries.length < 2 || entries.length > 24) return undefined;

  let chosenY: string | undefined;
  for (const y of Y_PRIORITIES) {
    const hits = entries.filter(([_, obj]) => typeof obj[y] === "number").length;
    if (hits >= Math.max(2, Math.ceil(entries.length / 2))) {
      chosenY = y;
      break;
    }
  }
  if (!chosenY) return undefined;

  const rows = entries.map(([key, obj]) => {
    let label: string | number | undefined =
      obj.label ?? obj.name ?? (obj.month != null ? monthify("month", obj.month) : undefined) ?? obj.year;
    if (label == null) label = key;
    const yVal = typeof obj[chosenY!] === "number" ? obj[chosenY!] : Number(obj[chosenY!]) || 0;
    return { label, [chosenY!]: yVal };
  });

  if (!rows.length) return undefined;

  return {
    type: "chart",
    chart: chartType,
    title: title ?? "Results",
    xKey: "label",
    yKey: chosenY,
    data: rows,
  };
}

/** Generic fallback: root count OR any array of objects. */
function genericChartFromPayload(payload: any, chartType: ChartType, title?: string): ChartSpec | undefined {
  if (typeof payload?.count === "number") {
    return {
      type: "chart",
      chart: chartType,
      title: title ?? "Total",
      xKey: "label",
      yKey: "count",
      data: [{ label: "Total", count: payload.count }],
    };
  }

  const fromChildren = chartFromChildObjects(payload, chartType, title);
  if (fromChildren) return fromChildren;

  const arr = findArrayOfObjects(payload);
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0] as Record<string, any>;
    const { xKey, yKey } = pickXY(first);
    if (!xKey || !yKey) return undefined;

    const rows = arr.slice(0, 24).map((r) => ({
      [xKey]: monthify(xKey, r[xKey]),
      [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
    }));

    return {
      type: "chart",
      chart: chartType,
      title: title ?? "Results",
      xKey,
      yKey,
      data: rows,
    };
  }

  return undefined;
}

/** Build chart from the most recent tool payload. */
function buildChartFromLatestTool(
  history: HistoryEntry[],
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  if (!history.length) return undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const payload = extractToolJsonPayload(history[i]?.tool_result);
    if (!payload) continue;

    const explicit = coerceChartSpec(payload);
    if (explicit) return explicit;

    const fromSeries = chartFromSeries(payload, chartType, title);
    if (fromSeries) return fromSeries;

    const generic = genericChartFromPayload(payload, chartType, title);
    if (generic) return generic;
  }
  return undefined;
}

/* ---------------- Assistant validation helpers ---------------- */

/** Pull a few commonly-used numeric fields from a payload as ground truth. */
function collectGroundTruthNumbers(payload: any): Record<string, number> | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const keys = [
    "available",
    "available_quantity",
    "inventory_quantity",
    "stocked_quantity",
    "reserved_quantity",
    "count",
    "total",
    "orders",
    "items",
  ];

  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = (payload as any)[k];
    if (typeof v === "number") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ---------------- Planner ---------------- */

async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: any; tool_result: any }[],
  modelName = "gemini-2.5-flash",
  wantsChart: boolean = false,
  category?: string
): Promise<{
  action: "call_tool" | "final_answer";
  tool_name?: string;
  tool_args?: any;
  answer?: string;
}> {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const { GoogleGenAI } = await import("@google/genai");

  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.input_schema ?? undefined,
  }));

  const chartDirective = wantsChart
    ? "The UI will render charts. Do NOT produce chart JSON—call tools to fetch accurate data and summarize."
    : "Do NOT include any chart/graph JSON. Provide concise text only. If data is needed, call the right tool.";

  // Category-specific instructions
  const getCategoryInstruction = (category?: string): string => {
    const baseInstruction = `You are a reasoning agent for an e-commerce backend. Decide the next step based on the user's goal and the tool-call history.\n` +
      `Actions: 'call_tool' or 'final_answer'.\n\n` +
      `1) If you need information or must perform an action, choose 'call_tool'.\n` +
      `2) If you have enough information, choose 'final_answer' and summarize succinctly.\n\n`;

    const categoryContext = {
      customers: `CUSTOMER FOCUS: You specialize in customer analytics and management. Prioritize customer-related data, demographics, behavior patterns, segmentation, and customer lifecycle metrics. When analyzing data, focus on customer acquisition, retention, lifetime value, and satisfaction metrics.`,
      orders: `ORDER FOCUS: You specialize in order analytics and management. Prioritize order-related data, sales performance, order fulfillment, processing times, and revenue metrics. When analyzing data, focus on order volumes, trends, conversion rates, and operational efficiency.`,
      products: `PRODUCT FOCUS: You specialize in product analytics and inventory management. Prioritize product-related data, inventory levels, product performance, categories, and merchandising metrics. When analyzing data, focus on best sellers, stock management, product profitability, and catalog optimization.`,
      promotions: `PROMOTION FOCUS: You specialize in promotion and discount analytics. Prioritize promotion-related data, discount effectiveness, campaign performance, and marketing metrics. When analyzing data, focus on promotion ROI, usage rates, customer response, and campaign optimization.`
    };

    const categorySpecific = category && categoryContext[category as keyof typeof categoryContext] 
      ? `\n\n${categoryContext[category as keyof typeof categoryContext]}\n\n`
      : '\n\n';

    return baseInstruction + categorySpecific;
  };

  const instruction = getCategoryInstruction(category) +
    `${chartDirective}\n\n` +
    `Always retrieve real data via the most relevant tool (Admin* list endpoints or custom tools).\n` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON to call a tool: {"action":"call_tool","tool_name":"string","tool_args":object}\n` +
    `JSON for the final answer: {"action":"final_answer","answer":"string"}`;

  const ai = new (GoogleGenAI as any)({ apiKey });

  const promptText = [
    instruction,
    `Tool Catalog (JSON):\n${JSON.stringify(toolCatalog, null, 2)}`,
    `History of previous steps:\n${JSON.stringify(history, null, 2)}`,
    `User's ultimate goal: ${userPrompt}`,
    `Respond with ONLY the JSON object for the next action.`,
  ].join("\n\n");

  const result = await ai.models.generateContent({
    model: modelName,
    contents: promptText,
  });

  const text = (result as any).text;
  if (!text) throw new Error("LLM returned empty response");
  try {
    return JSON.parse(stripJsonFences(text).trim());
  } catch {
    throw new Error("Failed to parse LLM JSON response for the next action");
  }
}

/* ---------------- HTTP handler ---------------- */

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as {
      prompt?: string;
      wantsChart?: boolean;
      chartType?: ChartType;
      chartTitle?: string;
      category?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const wantsChart = Boolean(body.wantsChart);
    const chartType: ChartType = body.chartType === "line" ? "line" : "bar";
    const chartTitle = typeof body.chartTitle === "string" ? body.chartTitle : undefined;
    const category = typeof body.category === "string" ? body.category : undefined;

    const mcp = await getMcp();
    const tools = await mcp.listTools();
    const availableTools: McpTool[] = (tools.tools ?? []) as any;

    const history: HistoryEntry[] = [];
    const maxSteps = 11;

    // 🔸 START assistant turn
    const turnId = metricsStore.startAssistantTurn({ user: prompt });

    for (let step = 0; step < maxSteps; step++) {
      console.log(`\n--- 🔄 AGENT LOOP: STEP ${step + 1} ---`);

      const plan = await planNextStepWithGemini(
        prompt,
        availableTools,
        history,
        "gemini-2.5-flash",
        wantsChart,
        category
      );

      if (plan.action === "final_answer") {
        console.log("✅ AI decided to provide the final answer.");

        // 🔸 END turn with final message
        metricsStore.endAssistantTurn(turnId, plan.answer ?? "");

        // 🔸 Auto-validate the answer using any grounded numbers we collected
        const t = metricsStore.getLastTurn?.();
        const grounded = t?.groundedNumbers ?? {};
        for (const [label, value] of Object.entries(grounded)) {
          if (typeof value === "number") {
            metricsStore.autoValidateFromAnswer(turnId, label, value, 0);
          }
        }

        const latestPayload = extractToolJsonPayload(history[history.length - 1]?.tool_result);
        const chart = wantsChart
          ? buildChartFromLatestTool(history, chartType, chartTitle) ?? null
          : null;

        return res.json({
          answer: plan.answer,
          chart,
          data: latestPayload ?? null,
          history,
        });
      }

      if (plan.action === "call_tool" && plan.tool_name && plan.tool_args) {
        console.log(`🧠 AI wants to call tool: ${plan.tool_name}`);
        console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

        metricsStore.noteToolUsed(turnId, plan.tool_name);

        const normalizedArgs = normalizeToolArgs(plan.tool_args);
        if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
          console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
        }

        const result = await withToolLogging(plan.tool_name, normalizedArgs, async () => {
          return mcp.callTool(plan.tool_name!, normalizedArgs);
        });

        console.log(`   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`);

        const payload = extractToolJsonPayload(result);
        const truth = collectGroundTruthNumbers(payload);
        if (truth) {
          metricsStore.provideGroundTruth(turnId, truth);
        }

        history.push({
          tool_name: plan.tool_name,
          tool_args: normalizedArgs,
          tool_result: result,
        });
      } else {
        throw new Error("AI returned an invalid plan. Cannot proceed.");
      }
    }

    // If we got here, we exceeded max steps
    metricsStore.endAssistantTurn(turnId, "[aborted: max steps exceeded]");
    return res.status(500).json({
      error: "The agent could not complete the request within the maximum number of steps.",
      history,
    });
  } catch (e: any) {
    console.error("\n--- 💥 UNCAUGHT EXCEPTION ---");
    console.error(e);
    console.error("--------------------------\n");
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
