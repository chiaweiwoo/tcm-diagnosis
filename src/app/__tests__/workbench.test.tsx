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
    vi.fn((url: string) => {
      if (url === "/api/consultations") {
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
        return makeOkJson({ record: { id: "abc", form_data: null, analysis_result: null, model_meta: null, analysis_status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), analyzed_at: null, consultation_name: null } });
      }
      if (url === "/api/consultations" || String(url).startsWith("/api/consultations")) {
        return makeOkJson({ record: { id: "new-123", form_data: null, analysis_result: null, model_meta: null, analysis_status: "analyzed", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), analyzed_at: new Date().toISOString(), consultation_name: null } });
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

  it("toggles prescription type chips on click", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("针灸"));

    // 方药 is active by default
    expect(screen.getByText("方药").closest("button")).toHaveClass("segmented-btn--active");

    // Click 针灸 to add it
    await user.click(screen.getByText("针灸"));
    expect(screen.getByText("针灸").closest("button")).toHaveClass("segmented-btn--active");
    // 方药 still active (multi-select)
    expect(screen.getByText("方药").closest("button")).toHaveClass("segmented-btn--active");
  });

  it("switches sex on click", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("男"));

    await user.click(screen.getByText("男"));
    expect(screen.getByText("男").closest("button")).toHaveClass("segmented-btn--active");
  });

  it("placeholder changes when only 针灸 is selected", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await waitFor(() => screen.getByText("针灸"));

    // Add 针灸, then remove 方药 → only 针灸 selected
    await user.click(screen.getByText("针灸"));
    await user.click(screen.getByText("方药"));
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
