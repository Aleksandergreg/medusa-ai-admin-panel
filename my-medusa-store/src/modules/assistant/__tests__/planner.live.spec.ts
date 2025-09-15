/**
 * Live Gemini planner smoke test.
 * Only runs when GEMINI_API_KEY is set (CI 'live-llm' job).
 */
import { planNextStepWithGemini } from "../planner";

const hasKey = !!process.env.GEMINI_API_KEY;

(hasKey ? test : test.skip)("planner returns a valid action with live Gemini", async () => {
  const result = await planNextStepWithGemini(
    "Just say hello",
    [],
    [],
    "gemini-2.5-flash",
    false,
    "bar"
  );
  expect(result).toBeTruthy();
  expect(["final_answer", "call_tool"]).toContain(result.action);
  if (result.action === "final_answer") {
    expect(typeof result.answer).toBe("string");
  }
});

