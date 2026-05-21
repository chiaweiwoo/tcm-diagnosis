/**
 * Workbench component tests.
 * Tests form validation, field interactions, and result rendering.
 * All network calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Workbench from "../workbench";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

function makeOkJson(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function makeErrJson(status: number, error: string) {
  return Promise.resolve(
    new Response(JSON.stringify({ error }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const MOCK_RESULT = {
  title: "方药研判",
  keyPoints: ["处方方向基本合理", "建议调整剂量"],
  groups: [
    {
      title: "判断",
      sections: [
        { title: "可取之处", items: ["方向正确"] },
        { title: "需要复核", items: ["剂量偏轻"] },
      ],
    },
    {
      title: "方案",
      sections: [
        { title: "建议优化", items: ["增加黄芪用量"] },
        { title: "可选思路", items: [] },
      ],
    },
    {
      title: "随访监测",
      sections: [{ title: "随访监测", items: ["一周后复诊"] }],
    },
  ],
  cautions: ["注意肝功能"],
  evidence: ["基于临床经验"],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/consultations" && method === "GET") {
        return makeOkJson({ records: [] });
      }
      if (url === "/api/analyze") {
        return makeOkJson({
          result: MOCK_RESULT,
          raw: {},
          model: "deepseek-flash",
          promptVersion: "tcm-analysis-v0.8",
          repairedJson: false,
        });
      }
      if (String(url).includes("/api/consultations/") && !String(url).endsWith("/consultations/")) {
        return makeOkJson({ record: { id: "abc", form_data: null, analysis_result: null, model_meta: null, analysis_status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), analyzed_at: null, consultation_name: null, case_id: null, case_id_updated_at: null, related_case_id: null, related_case_id_updated_at: null, ai_feedback: null, ai_feedback_updated_at: null } });
      }
      if (url === "/api/consultations" || String(url).startsWith("/api/consultations")) {
        const body = init?.body ? JSON.parse(String(init.body)) as { caseId?: string | null; relatedCaseId?: string | null; aiFeedback?: string | null } : {};
        return makeOkJson({ record: { id: "new-123", form_data: null, analysis_result: null, model_meta: null, analysis_status: "analyzed", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), analyzed_at: new Date().toISOString(), consultation_name: null, case_id: body.caseId ?? null, case_id_updated_at: body.caseId ? new Date().toISOString() : null, related_case_id: body.relatedCaseId ?? null, related_case_id_updated_at: body.relatedCaseId ? new Date().toISOString() : null, ai_feedback: body.aiFeedback ?? null, ai_feedback_updated_at: body.aiFeedback ? new Date().toISOString() : null } });
      }
      return makeErrJson(404, "not found");
    }),
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/头痛眩晕反复发作/), "头痛眩晕反复发作");
  await user.type(
    screen.getByPlaceholderText(/头痛3个月余/),
    "头痛3个月余，伴轻度眩晕，无发热，劳累后加重。",
  );
  await user.type(screen.getByPlaceholderText(/舌脉、查体重点/), "舌淡红苔薄白，脉弦细");
  await user.type(screen.getByPlaceholderText(/头痛 \/ 眩晕/), "头痛");
  await user.type(screen.getByPlaceholderText(/肝阳上亢/), "肝阳上亢");
  await user.type(
    screen.getByPlaceholderText(/天麻钩藤饮|百会、太冲|穴位 \+ 方药/),
    "天麻钩藤饮加减10g",
  );
  // Age field
  const ageInput = screen.getByPlaceholderText("岁");
  await user.clear(ageInput);
  await user.type(ageInput, "45");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Workbench rendering", () => {
  it("renders the form with required field labels", async () => {
    render(<Workbench />);
    await waitFor(() => expect(screen.getByText(/中医临床智伴/)).toBeInTheDocument());

    expect(screen.getByText(/主诉 Presenting Complaint/)).toBeInTheDocument();
    expect(screen.getByText(/现病史 History of Presenting Complaint/)).toBeInTheDocument();
    expect(screen.getByText(/诊断 Diagnosis/)).toBeInTheDocument();
    expect(screen.getByText(/处方 Treatment/)).toBeInTheDocument();
  });

  it("renders prescription type segmented control with all 3 options", async () => {
    render(<Workbench />);
    await waitFor(() => screen.getByText("方药"));

    expect(screen.getByText("方药")).toBeInTheDocument();
    expect(screen.getByText("针灸")).toBeInTheDocument();
    expect(screen.getByText("综合调理")).toBeInTheDocument();
  });

  it("renders sex segmented control with 男 and 女", async () => {
    render(<Workbench />);
    await waitFor(() => screen.getByText("男"));

    expect(screen.getByText("男")).toBeInTheDocument();
    expect(screen.getByText("女")).toBeInTheDocument();
  });

  it("renders the analyze button", async () => {
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));
    expect(screen.getByText("开始分析")).toBeInTheDocument();
  });
});

describe("Form field interactions", () => {
  it("updates chief complaint field on input", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByPlaceholderText(/头痛眩晕反复发作/));

    const input = screen.getByPlaceholderText(/头痛眩晕反复发作/);
    await user.type(input, "头痛眩晕");
    expect(input).toHaveValue("头痛眩晕");
  });

  it("switches prescription type chip on click (single-select)", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("针灸"));

    // 方药 is active by default
    expect(screen.getByText("方药").closest("button")).toHaveClass("segmented-btn--active");

    // Click 针灸 — it becomes the sole selection
    await user.click(screen.getByText("针灸"));
    expect(screen.getByText("针灸").closest("button")).toHaveClass("segmented-btn--active");
    // 方药 is now inactive (single-select)
    expect(screen.getByText("方药").closest("button")).not.toHaveClass("segmented-btn--active");
  });

  it("switches sex on click", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("男"));

    await user.click(screen.getByText("男"));
    expect(screen.getByText("男").closest("button")).toHaveClass("segmented-btn--active");
  });

  it("placeholder changes when 针灸 is selected", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("针灸"));

    // Click 针灸 — single-select immediately switches placeholder
    await user.click(screen.getByText("针灸"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/百会、太冲、风池/)).toBeInTheDocument(),
    );
  });
});

describe("Form validation", () => {
  it("submit button is disabled when required fields are empty", async () => {
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));
    expect(screen.getByText("开始分析").closest("button")).toBeDisabled();
  });

  it("shows field error on blur when a required field is left empty", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    // Focus then blur an empty required field
    const chiefInput = screen.getByPlaceholderText(/头痛眩晕反复发作/);
    await user.click(chiefInput);
    await user.tab();
    await waitFor(() => {
      const errors = document.querySelectorAll(".field-error");
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it("does not call /api/analyze when required fields are missing", async () => {
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    // Button is disabled — no click possible; fetch must not be called
    const fetchMock = vi.mocked(global.fetch);
    const analyzeCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/analyze");
    expect(analyzeCalls).toHaveLength(0);
  });

  it("clears error after field is filled following a blur", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    // Trigger error: blur an empty field
    const chiefInput = screen.getByPlaceholderText(/头痛眩晕反复发作/);
    await user.click(chiefInput);
    await user.tab();
    await waitFor(() => expect(document.querySelectorAll(".field-error").length).toBeGreaterThan(0));

    // Fill the field — error should disappear
    await user.type(chiefInput, "头痛");
    await waitFor(() => {
      const fieldError = chiefInput.closest(".form-group")?.querySelector(".field-error");
      expect(fieldError).toBeNull();
    });
  });
});

describe("Analyze flow", () => {
  it("calls /api/analyze with form data after filling required fields", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    const fetchMock = vi.mocked(global.fetch);
    await waitFor(() => {
      const analyzeCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/analyze");
      expect(analyzeCalls).toHaveLength(1);
    });

    const analyzeCall = fetchMock.mock.calls.find(([url]) => url === "/api/analyze");
    expect(analyzeCall).toBeDefined();
    const body = JSON.parse(analyzeCall![1]!.body as string) as { form: unknown };
    expect(body.form).toMatchObject({ chiefComplaint: "头痛眩晕反复发作" });
  });

  it("renders result sections after successful analyze", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => {
      expect(screen.getByText("判断 Assessment")).toBeInTheDocument();
    });

    expect(screen.getByText("重点结论 Conclusion")).toBeInTheDocument();
    expect(screen.getByText("处方方向基本合理")).toBeInTheDocument();
    expect(screen.getByText("判断 Assessment")).toBeInTheDocument();
    expect(screen.getByText("方案 Plan")).toBeInTheDocument();
    // "随访监测" appears in both column title and section title — use getAllByText
    expect(screen.getAllByText(/随访监测/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows cautions banner when cautions contain non-generic content", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => screen.getByText("风险与提醒 Cautions"));
    expect(screen.getByText("注意肝功能")).toBeInTheDocument();
  });

  it("shows feedback section after analyze and saves case id + related case id + feedback through header save", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => screen.getByText("给AI回馈 Feedback to AI"));
    expect(screen.queryByText("提交回馈")).not.toBeInTheDocument();

    const caseIdInput = screen.getByPlaceholderText("例：0004222");
    const relatedCaseIdInput = screen.getByPlaceholderText("例：0004221");
    await user.type(caseIdInput, "0004222");
    await user.type(relatedCaseIdInput, "0004221");
    const textarea = screen.getByPlaceholderText(/整体方向有帮助/);
    await user.type(textarea, "建议保留风险提示，但可以更具体。");
    await user.click(screen.getByTitle("保存"));

    const fetchMock = vi.mocked(global.fetch);
    await waitFor(() => {
      const feedbackCall = fetchMock.mock.calls.find(
        ([url, options]) => String(url).includes("/api/consultations/") && options?.method === "PATCH",
      );
      expect(feedbackCall).toBeDefined();
      expect(String(feedbackCall?.[1]?.body)).toContain("aiFeedback");
      expect(String(feedbackCall?.[1]?.body)).toContain("caseId");
      expect(String(feedbackCall?.[1]?.body)).toContain("relatedCaseId");
    });
  });

  it("keeps analyzed form fields read-only while Case ID remains editable", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => screen.getByText("给AI回馈 Feedback to AI"));
    expect(screen.getByPlaceholderText(/头痛眩晕反复发作/)).toBeDisabled();
    expect(screen.getByPlaceholderText("例：0004222")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("例：0004221")).not.toBeDisabled();
  });

  it("asks before discarding unsaved post-analysis Case ID changes", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => screen.getByText("给AI回馈 Feedback to AI"));
    await user.type(screen.getByPlaceholderText("例：0004222"), "0004222");
    await user.click(screen.getByText("新建"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByPlaceholderText("例：0004222")).toHaveValue("0004222");
    confirmSpy.mockRestore();
  });

  it("shows a manual linkage rail from direct and reverse matches, sorted newest first, and loads the linked record", async () => {
    const olderTimestamp = "2026-05-19T08:15:00.000Z";
    const newerTimestamp = "2026-05-21T10:30:00.000Z";
    const linkedRecord = {
      id: "linked-1",
      consultation_name: "\u5973 44 \u5931\u7720",
      case_id: "0004221",
      case_id_updated_at: olderTimestamp,
      related_case_id: null,
      related_case_id_updated_at: null,
      form_data: {
        consultationName: "",
        prescriptionType: "\u65b9\u836f",
        patientAge: "44",
        patientSex: "\u5973",
        chiefComplaint: "\u5931\u7720",
        currentIllness: "\u5931\u7720\u53cd\u590d\u53d1\u4f5c\u3002",
        pastHistory: "",
        physicalExam: "\u820c\u6de1\u7ea2\u82d4\u8584\u767d\uff0c\u8109\u7ec6",
        diagnosis: "\u4e0d\u5bd0",
        pattern: "\u5fc3\u813e\u4e24\u865a",
        prescription: "\u5f52\u813e\u6c64\u52a0\u51cf",
      },
      analysis_status: "analyzed",
      created_at: olderTimestamp,
      updated_at: olderTimestamp,
      analyzed_at: olderTimestamp,
      analysis_result: MOCK_RESULT,
      analysis_raw: {},
      model_meta: null,
      ai_feedback: null,
      ai_feedback_updated_at: null,
    };
    const reverseLinkedRecord = {
      ...linkedRecord,
      id: "linked-2",
      consultation_name: "\u7537 51 \u54b3\u55fd",
      case_id: "0005000",
      case_id_updated_at: newerTimestamp,
      related_case_id: "0004222",
      form_data: {
        ...linkedRecord.form_data,
        patientAge: "51",
        patientSex: "\u5973",
        chiefComplaint: "\u5931\u7720",
        diagnosis: "\u4e0d\u5bd0",
        pattern: "\u5fc3\u813e\u4e24\u865a",
        prescription: "\u5f52\u813e\u6c64\u52a0\u51cf",
      },
      created_at: newerTimestamp,
      updated_at: newerTimestamp,
      analyzed_at: newerTimestamp,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url === "/api/consultations" && method === "GET") {
          return makeOkJson({ records: [linkedRecord, reverseLinkedRecord] });
        }
        if (url === "/api/analyze") {
          return makeOkJson({
            result: MOCK_RESULT,
            raw: {},
            model: "deepseek-flash",
            promptVersion: "tcm-analysis-v0.8",
            repairedJson: false,
          });
        }
        if (url === "/api/consultations" && method === "POST") {
          const body = JSON.parse(String(init?.body)) as { caseId?: string | null; relatedCaseId?: string | null };
          return makeOkJson({
            record: {
              id: "new-123",
              consultation_name: null,
              case_id: body.caseId ?? null,
              case_id_updated_at: body.caseId ? new Date().toISOString() : null,
              related_case_id: body.relatedCaseId ?? null,
              related_case_id_updated_at: body.relatedCaseId ? new Date().toISOString() : null,
              form_data: null,
              analysis_status: "analyzed",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              analyzed_at: new Date().toISOString(),
              analysis_result: null,
              analysis_raw: null,
              model_meta: null,
              ai_feedback: null,
              ai_feedback_updated_at: null,
            },
          });
        }
        if (url === "/api/consultations/linked-1" && method === "GET") {
          return makeOkJson({ record: linkedRecord });
        }
        if (url === "/api/consultations/linked-2" && method === "GET") {
          return makeOkJson({ record: reverseLinkedRecord });
        }
        if (String(url).includes("/api/consultations/") && method === "GET") {
          return makeOkJson({ record: linkedRecord });
        }
        return makeErrJson(404, "not found");
      }),
    );

    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("\u5f00\u59cb\u5206\u6790"));

    await fillRequiredFields(user);
    await user.type(screen.getByPlaceholderText("\u4f8b\uff1a0004222"), "0004222");
    await user.type(screen.getByPlaceholderText("\u4f8b\uff1a0004221"), "0004221");
    await user.click(screen.getByText("\u5f00\u59cb\u5206\u6790"));

    await waitFor(() => screen.getByLabelText("\u5173\u8054\u75c5\u6848"));
    expect(screen.getByText("\u5f53\u524d\u75c5\u6848")).toBeInTheDocument();
    const linkedButtons = screen
      .getAllByRole("button")
      .filter((element) => (element.textContent ?? "").includes("0004221")
        || (element.textContent ?? "").includes("0005000"));
    expect(linkedButtons).toHaveLength(2);
    expect(linkedButtons.map((element) => element.textContent ?? "").slice(0, 2)).toEqual([
      expect.stringContaining("0005000"),
      expect.stringContaining("0004221"),
    ]);

    await user.click(linkedButtons[1]);
    await waitFor(() => {
      expect(vi.mocked(global.fetch).mock.calls.some(
        ([url, init]) => url === "/api/consultations/linked-1" && (init?.method ?? "GET") === "GET",
      )).toBe(true);
    });
  });

  it("does not create linkage from numeric adjacency alone", async () => {
    const adjacentRecord = {
      id: "adjacent-1",
      consultation_name: "女 52 眩晕",
      case_id: "0004221",
      case_id_updated_at: new Date().toISOString(),
      related_case_id: null,
      related_case_id_updated_at: null,
      form_data: null,
      analysis_status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      analyzed_at: null,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url === "/api/consultations" && method === "GET") {
          return makeOkJson({ records: [adjacentRecord] });
        }
        if (url === "/api/analyze") {
          return makeOkJson({
            result: MOCK_RESULT,
            raw: {},
            model: "deepseek-flash",
            promptVersion: "tcm-analysis-v0.8",
            repairedJson: false,
          });
        }
        if (url === "/api/consultations" && method === "POST") {
          const body = JSON.parse(String(init?.body)) as { caseId?: string | null; relatedCaseId?: string | null };
          return makeOkJson({
            record: {
              id: "new-123",
              consultation_name: null,
              case_id: body.caseId ?? null,
              case_id_updated_at: body.caseId ? new Date().toISOString() : null,
              related_case_id: body.relatedCaseId ?? null,
              related_case_id_updated_at: body.relatedCaseId ? new Date().toISOString() : null,
              form_data: null,
              analysis_status: "analyzed",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              analyzed_at: new Date().toISOString(),
              analysis_result: null,
              analysis_raw: null,
              model_meta: null,
              ai_feedback: null,
              ai_feedback_updated_at: null,
            },
          });
        }
        return makeErrJson(404, "not found");
      }),
    );

    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.type(screen.getByPlaceholderText("例：0004222"), "0004222");
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => screen.getByText("给AI回馈 Feedback to AI"));
    expect(screen.queryByText("关联病案")).not.toBeInTheDocument();
  });

  it("deleting a dirty active record confirms once and resets cleanly", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));
    await waitFor(() => screen.getByText("给AI回馈 Feedback to AI"));

    await user.type(screen.getByPlaceholderText("例：0004222"), "0004222");
    await user.click(screen.getByText("历史"));
    await waitFor(() => screen.getByLabelText("删除病案"));
    await user.click(screen.getByLabelText("删除病案"));

    const fetchMock = vi.mocked(global.fetch);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/api/consultations/new-123") && init?.method === "DELETE")).toBe(true);
    expect(screen.getByPlaceholderText("例：0004222")).toHaveValue("");
    confirmSpy.mockRestore();
  });

  it("shows error toast when analyze API fails", async () => {
    vi.mocked(global.fetch).mockImplementationOnce(() => makeOkJson({ records: [] })); // initial history load
    vi.mocked(global.fetch).mockImplementationOnce(() => makeErrJson(503, "服务暂时不可用"));

    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("开始分析"));

    await fillRequiredFields(user);
    await user.click(screen.getByText("开始分析"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toContain("服务暂时不可用");
  });
});

describe("History panel", () => {
  it("opens history panel on history button click", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("历史"));

    await user.click(screen.getByText("历史"));
    await waitFor(() => screen.getByText("历史记录"));
    expect(screen.getByText("暂无历史记录")).toBeInTheDocument();
  });

  it("searches history by case id and related case id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url === "/api/consultations" && method === "GET") {
          return makeOkJson({
            records: [
              {
                id: "case-1",
                consultation_name: null,
                case_id: "000325",
                case_id_updated_at: new Date().toISOString(),
                related_case_id: "000221",
                related_case_id_updated_at: new Date().toISOString(),
                form_data: {
                  patientSex: "\u5973",
                  patientAge: "52",
                  chiefComplaint: "\u7729\u6655",
                },
                analysis_status: "analyzed",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                analyzed_at: new Date().toISOString(),
              },
            ],
          });
        }
        if (String(url).includes("/api/consultations/") && method === "GET") {
          return makeOkJson({
            record: {
              id: "case-1",
              form_data: null,
              analysis_result: null,
              model_meta: null,
              analysis_status: "draft",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              analyzed_at: null,
              consultation_name: null,
              case_id: "000325",
              case_id_updated_at: new Date().toISOString(),
              related_case_id: "000221",
              related_case_id_updated_at: new Date().toISOString(),
              ai_feedback: null,
              ai_feedback_updated_at: null,
            },
          });
        }
        return makeErrJson(404, "not found");
      }),
    );

    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("\u5386\u53f2"));

    await user.click(screen.getByText("\u5386\u53f2"));
    await waitFor(() => screen.getByText("\u5386\u53f2\u8bb0\u5f55"));

    const searchInput = screen.getByPlaceholderText("搜索病案…");
    await user.type(searchInput, "000221");

    await waitFor(() => {
      expect(screen.getByText("000325")).toBeInTheDocument();
      expect(screen.getByText("000221")).toBeInTheDocument();
    });
  });

  it("closes history panel when clicking 新建", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("历史"));

    await user.click(screen.getByText("历史"));
    await waitFor(() => screen.getByText("历史记录"));

    // Click the header-level 新建 button (not the one inside history panel)
    const newButtons = screen.getAllByTitle("新建");
    await user.click(newButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("历史记录")).not.toBeInTheDocument();
    });
  });
});
