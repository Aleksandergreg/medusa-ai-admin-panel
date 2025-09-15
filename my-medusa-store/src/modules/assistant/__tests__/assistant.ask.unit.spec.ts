describe("AssistantModuleService.ask", () => {
  // Build a lightweight fake MCP client
  const buildFakeMcp = (tools: any[], callImpl?: (name: string, args: any) => any) => ({
    listTools: async () => ({ tools }),
    callTool: async (name: string, args: any) =>
      callImpl ? callImpl(name, args) : { content: [{ type: "text", text: "{}" }] },
  });

  beforeEach(() => {
    jest.resetModules();
  });

  it("returns final answer when planner decides to finish immediately", async () => {
    const path = require("node:path");
    const plannerPath = path.resolve(__dirname, "../planner");
    const managerPath = path.resolve(__dirname, "../../../lib/mcp/manager");

    // Register mocks before importing the service
    jest.doMock(plannerPath, () => ({
      __esModule: true,
      planNextStepWithGemini: jest.fn(),
    }));
    jest.doMock(managerPath, () => ({
      __esModule: true,
      getMcp: jest.fn(),
    }));

    const { planNextStepWithGemini } = require(plannerPath) as { planNextStepWithGemini: jest.Mock };
    const { getMcp } = require(managerPath) as { getMcp: jest.Mock };

    getMcp.mockResolvedValue(buildFakeMcp([]));
    planNextStepWithGemini.mockResolvedValueOnce({ action: "final_answer", answer: "Hello world" });

    const AssistantModuleService = (await import("../service")).default as any;
    const svc = new AssistantModuleService({}, {});

    const res = await svc.ask({ prompt: "Say hi" });

    expect(res.history).toEqual([]);
    expect(res.data).toBeNull();
    expect(res.chart).toBeNull();
    expect(res.answer).toContain("Hello world");
  });

  it("executes a tool then produces a final answer", async () => {
    const path = require("node:path");
    const plannerPath = path.resolve(__dirname, "../planner");
    const managerPath = path.resolve(__dirname, "../../../lib/mcp/manager");

    jest.doMock(plannerPath, () => ({
      __esModule: true,
      planNextStepWithGemini: jest.fn(),
    }));
    jest.doMock(managerPath, () => ({
      __esModule: true,
      getMcp: jest.fn(),
    }));

    const { planNextStepWithGemini } = require(plannerPath) as { planNextStepWithGemini: jest.Mock };
    const { getMcp } = require(managerPath) as { getMcp: jest.Mock };

    const tools = [
      { name: "orders_count", description: "Counts orders", input_schema: { type: "object", properties: {} } },
    ];
    getMcp.mockResolvedValue(
      buildFakeMcp(tools, (name, args) => {
        expect(name).toBe("orders_count");
        expect(args).toEqual({});
        return { content: [{ type: "text", text: JSON.stringify({ orders: 42 }) }] };
      })
    );

    planNextStepWithGemini
      .mockResolvedValueOnce({ action: "call_tool", tool_name: "orders_count", tool_args: {} })
      .mockResolvedValueOnce({ action: "final_answer", answer: "There are 42 orders" });

    const AssistantModuleService = (await import("../service")).default as any;
    const svc = new AssistantModuleService({}, {});

    const res = await svc.ask({ prompt: "How many orders do we have?" });

    expect(res.history).toHaveLength(1);
    expect(res.history[0].tool_name).toBe("orders_count");
    expect(res.data).toEqual({ orders: 42 });
    expect(res.answer).toContain("42");
  });
});
