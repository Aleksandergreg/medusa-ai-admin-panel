import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { POST } from "../route";

describe("admin/assistant POST route", () => {
  function buildRes() {
    const res: Partial<MedusaResponse> & { body?: any; code?: number } = {};
    res.status = ((code: number) => {
      res.code = code;
      return res as any;
    }) as any;
    res.json = ((body: any) => {
      res.body = body;
      return res as any;
    }) as any;
    return res as MedusaResponse & { body?: any; code?: number };
  }

  it("400 when prompt is missing", async () => {
    const req = { body: {}, scope: { resolve: jest.fn() } } as unknown as AuthenticatedMedusaRequest;
    const res = buildRes();
    await POST(req, res);
    expect(res.code).toBe(400);
    expect(res.body).toEqual({ error: "Missing prompt" });
  });

  it("calls assistant.ask and returns its result", async () => {
    const fakeAssistant = {
      ask: jest.fn().mockResolvedValue({ answer: "ok", chart: null, data: null, history: [] }),
    };
    const req = {
      body: { prompt: "hi", wantsChart: true, chartType: "line", chartTitle: "T" },
      scope: { resolve: jest.fn().mockReturnValue(fakeAssistant) },
    } as unknown as AuthenticatedMedusaRequest;
    const res = buildRes();

    await POST(req, res);

    expect(req.scope.resolve).toHaveBeenCalled();
    expect(fakeAssistant.ask).toHaveBeenCalledWith({
      prompt: "hi",
      wantsChart: true,
      chartType: "line",
      chartTitle: "T",
    });
    expect(res.body).toEqual({ answer: "ok", chart: null, data: null, history: [] });
  });
});

