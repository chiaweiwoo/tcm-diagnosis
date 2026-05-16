/**
 * /api/analyze route contract tests.
 * Mocks DeepSeek and auth — validates request parsing, validation, and response shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MINIMAL_VALID } from "@/lib/forms/fixtures";

// ---------------------------------------------------------------------------
// Hoisted constants (accessible inside vi.mock factories)
// ---------------------------------------------------------------------------

const MOCK_AI_JSON = vi.hoisted(() => ({
  重点结论: ["方向基本合理", "建议调整剂量"],
  当前思路: {
    可取之处: ["用药方向正确"],
    需要复核: ["确认剂量"],
  },
  建议优化: ["增加剂量"],
  可选思路: [] as string[],
  风险与提醒: ["注意禁忌"],
  随访监测: ["一周后复诊"],
  证据状态: ["基于临床经验"],
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/apiAuth", () => ({
  requireApiAuth: vi.fn().mockResolvedValue({
    ok: true,
    doctorEmail: "test@clinic.com",
    isCli: false,
  }),
}));

vi.mock("@/lib/logging", () => ({
  logServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/langfuse", () => ({
  getLangfuse: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/activityLog", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => void) => fn() };
});

vi.mock("@/lib/ai/deepseek", () => ({
  callDeepSeekJson: vi.fn().mockResolvedValue({
    data: MOCK_AI_JSON,
    model: "deepseek-chat",
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    costUsd: 0.001,
    costDetail: { rates: {} },
    repairedJson: false,
  }),
  DeepSeekError: class DeepSeekError extends Error {
    status: number;
    details: unknown;
    constructor(msg: string, status = 500, details?: unknown) {
      super(msg);
      this.status = status;
      this.details = details;
    }
  },
  getDeepSeekFastModel: vi.fn().mockReturnValue("deepseek-chat"),
}));

// ---------------------------------------------------------------------------
// Import route + mocked modules after vi.mock declarations
// ---------------------------------------------------------------------------

import { POST } from "../route";
import { NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/apiAuth";
import { callDeepSeekJson } from "@/lib/ai/deepseek";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function parseResponse(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/analyze", () => {
  beforeEach(() => {
    vi.mocked(requireApiAuth).mockResolvedValue({
      ok: true,
      doctorEmail: "test@clinic.com",
      isCli: false,
    });
    vi.mocked(callDeepSeekJson).mockResolvedValue({
      data: MOCK_AI_JSON,
      model: "deepseek-chat",
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      costUsd: 0.001,
      costDetail: { rates: {} },
      repairedJson: false,
    });
  });

  it("returns 200 with result shape for valid StructuredCaseForm", async () => {
    const response = await POST(makeRequest({ form: MINIMAL_VALID }));
    expect(response.status).toBe(200);

    const body = await parseResponse(response);
    expect(body).toHaveProperty("result");
    expect(body).toHaveProperty("raw");
    expect(body).toHaveProperty("model");
    expect(body).toHaveProperty("promptVersion");
    expect(body).toHaveProperty("repairedJson");
  });

  it("result has 3 groups matching UI columns", async () => {
    const response = await POST(makeRequest({ form: MINIMAL_VALID }));
    const body = await parseResponse(response);

    const result = body.result as {
      groups: Array<{ title: string; sections: unknown[] }>;
      keyPoints: string[];
      cautions: string[];
      evidence: string[];
    };
    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((g) => g.title)).toEqual(["判断", "方案", "随访监测"]);
    expect(Array.isArray(result.keyPoints)).toBe(true);
    expect(Array.isArray(result.cautions)).toBe(true);
    expect(Array.isArray(result.evidence)).toBe(true);
  });

  it("returns 400 with INVALID_INPUT for missing required fields", async () => {
    const response = await POST(makeRequest({ form: { prescriptionType: "方药" } }));
    expect(response.status).toBe(400);

    const body = await parseResponse(response);
    expect(body).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns 400 for blocked content in form", async () => {
    const response = await POST(
      makeRequest({
        form: {
          ...MINIMAL_VALID,
          prescription: "保证此方治愈所有病症，天麻钩藤饮加减15g",
        },
      }),
    );
    expect(response.status).toBe(400);
    const body = await parseResponse(response);
    expect(body).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns 401 when auth fails", async () => {
    vi.mocked(requireApiAuth).mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 }),
    });

    const response = await POST(makeRequest({ form: MINIMAL_VALID }));
    expect(response.status).toBe(401);
  });

  it("returns 500 and logs when DeepSeek throws unexpected error", async () => {
    vi.mocked(callDeepSeekJson).mockRejectedValueOnce(new Error("unexpected internal failure"));

    const response = await POST(makeRequest({ form: MINIMAL_VALID }));
    expect(response.status).toBe(500);

    const body = await parseResponse(response);
    expect(body).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("passes prescriptionType from form to buildAnalysisResult via title", async () => {
    const response = await POST(
      makeRequest({ form: { ...MINIMAL_VALID, prescriptionType: ["针灸"] } }),
    );
    const body = await parseResponse(response);
    const result = body.result as { title: string };
    expect(result.title).toBe("针灸研判");
  });
});
