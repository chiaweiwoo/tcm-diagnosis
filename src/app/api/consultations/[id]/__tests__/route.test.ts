import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MINIMAL_VALID } from "@/lib/forms/fixtures";

const mockGetConsultation = vi.hoisted(() => vi.fn());
const mockUpdateConsultation = vi.hoisted(() => vi.fn());

vi.mock("@/lib/currentDoctor", () => ({
  getCurrentDoctor: vi.fn().mockResolvedValue({
    id: "doctor-1",
    email: "doctor@example.com",
    isDevBypass: false,
  }),
}));

vi.mock("@/lib/consultations", () => ({
  getConsultation: mockGetConsultation,
  updateConsultation: mockUpdateConsultation,
  deleteConsultation: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({}),
  getServiceRoleClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logging", () => ({
  logServerEvent: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "../route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/consultations/abc", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PATCH /api/consultations/[id]", () => {
  beforeEach(() => {
    mockGetConsultation.mockReset();
    mockUpdateConsultation.mockReset();

    mockGetConsultation.mockResolvedValue({
      id: "abc",
      doctor_id: "doctor-1",
      doctor_email: "doctor@example.com",
      consultation_name: null,
      case_id: "0001",
      case_id_updated_at: null,
      related_case_id: "0000",
      related_case_id_updated_at: null,
      ai_feedback: "note",
      ai_feedback_updated_at: null,
      form_data: MINIMAL_VALID,
      analysis_result: { ok: true },
      analysis_raw: { raw: true },
      model_meta: { model: "deepseek-flash" },
      analysis_status: "analyzed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      analyzed_at: new Date().toISOString(),
    });
    mockUpdateConsultation.mockResolvedValue({
      id: "abc",
      doctor_id: "doctor-1",
      doctor_email: "doctor@example.com",
      consultation_name: null,
      case_id: "0001",
      case_id_updated_at: null,
      related_case_id: "0000",
      related_case_id_updated_at: null,
      ai_feedback: "note",
      ai_feedback_updated_at: null,
      form_data: MINIMAL_VALID,
      analysis_result: { ok: true },
      analysis_raw: { raw: true },
      model_meta: { model: "deepseek-flash" },
      analysis_status: "analyzed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      analyzed_at: new Date().toISOString(),
    });
  });

  it("preserves existing analysis fields when analyzed records save formData only", async () => {
    const response = await PATCH(makeRequest({
      formData: {
        ...MINIMAL_VALID,
        chiefComplaint: "\u590d\u8bca\u540e\u5934\u75db\u52a0\u91cd",
      },
    }), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(200);
    expect(mockUpdateConsultation).toHaveBeenCalledTimes(1);
    const [, , patch] = mockUpdateConsultation.mock.calls[0];
    expect(patch.form_data).toMatchObject({ chiefComplaint: "\u590d\u8bca\u540e\u5934\u75db\u52a0\u91cd" });
    expect(patch.analysis_stale).toBe(true);
    expect(patch).not.toHaveProperty("analysis_result");
    expect(patch).not.toHaveProperty("analysis_raw");
    expect(patch).not.toHaveProperty("model_meta");
    expect(patch).not.toHaveProperty("analysis_status");
    expect(patch).not.toHaveProperty("analyzed_at");
  });

  it("rejects incomplete direct analysis payload updates", async () => {
    const response = await PATCH(makeRequest({
      analysisResult: { ok: true },
    }), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    const body = await response.json() as { code: string };
    expect(body.code).toBe("INVALID_INPUT");
    expect(mockUpdateConsultation).not.toHaveBeenCalled();
  });
});
