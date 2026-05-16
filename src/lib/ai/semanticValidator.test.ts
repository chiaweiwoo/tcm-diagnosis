import { describe, it, expect, vi } from "vitest";
import { validateCaseSemantics } from "./semanticValidator";
import { MINIMAL_VALID } from "@/lib/forms/fixtures";

vi.mock("@/lib/ai/deepseek", () => ({
  callDeepSeekJson: vi.fn(),
  getDeepSeekFastModel: vi.fn().mockReturnValue("deepseek-chat"),
}));

import { callDeepSeekJson } from "@/lib/ai/deepseek";

function makeResult(data: unknown) {
  return Promise.resolve({ data, model: "deepseek-chat", usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }, costUsd: 0.0001, costDetail: {}, repairedJson: false });
}

describe("validateCaseSemantics", () => {
  it("returns valid=true when AI returns valid", async () => {
    vi.mocked(callDeepSeekJson).mockResolvedValueOnce(makeResult({ valid: true, issues: [] }) as never);
    const result = await validateCaseSemantics(MINIMAL_VALID);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns issues when AI flags chiefComplaint", async () => {
    vi.mocked(callDeepSeekJson).mockResolvedValueOnce(
      makeResult({
        valid: false,
        issues: [{ field: "chiefComplaint", message: "主诉未注明症状持续时长。" }],
      }) as never,
    );
    const result = await validateCaseSemantics(MINIMAL_VALID);
    expect(result.valid).toBe(false);
    expect(result.issues[0].field).toBe("chiefComplaint");
  });

  it("normalises malformed response to valid=true when shape is wrong", async () => {
    vi.mocked(callDeepSeekJson).mockResolvedValueOnce(
      makeResult({ unexpected: "shape" }) as never,
    );
    const result = await validateCaseSemantics(MINIMAL_VALID);
    // valid defaults to true when field is missing
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
