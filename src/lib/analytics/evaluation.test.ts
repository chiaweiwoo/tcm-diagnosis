import { describe, expect, it } from "vitest";
import {
  buildCaseLabel,
  computeFieldCompleteness,
  doctorReviewDraftToProfile,
  extractThemeCandidates,
  normalizeDoctorProfile,
} from "./evaluation";

describe("Goal 2 deterministic evaluation helpers", () => {
  it("computes field completeness from structured form rows", () => {
    const rows = [
      {
        form_data: {
          pastHistory: "高血压史",
          physicalExam: "舌红，脉弦",
        },
        analysis_result: {},
        analyzed_at: "2026-05-19T00:00:00.000Z",
      },
      {
        form_data: {
          pastHistory: "",
          physicalExam: "舌淡，脉细",
        },
        analysis_result: {},
        analyzed_at: "2026-05-19T00:00:00.000Z",
      },
    ];

    expect(computeFieldCompleteness(rows)).toEqual([
      { field: "pastHistory", label: "既往史", filled: 1, total: 2, rate: 0.5 },
      { field: "physicalExam", label: "体格检查", filled: 2, total: 2, rate: 1 },
    ]);
  });

  it("extracts recurring AI themes with case numbers", () => {
    const rows = [
      {
        form_data: {},
        analysis_result: {
          keyPoints: ["建议补肾兼活血，并继续观察血压"],
        },
        analyzed_at: "2026-05-19T00:00:00.000Z",
      },
      {
        form_data: {},
        analysis_result: {
          cautions: ["需补充既往史和用药史"],
        },
        analyzed_at: "2026-05-19T00:00:00.000Z",
      },
    ];

    const themes = extractThemeCandidates(rows);

    expect(themes).toContainEqual({
      theme: "补肾",
      count: 1,
      rate: 0.5,
      caseNumbers: [1],
    });
    expect(themes).toContainEqual({
      theme: "既往史补充",
      count: 1,
      rate: 0.5,
      caseNumbers: [2],
    });
    expect(themes).toContainEqual({
      theme: "血压随访",
      count: 1,
      rate: 0.5,
      caseNumbers: [1],
    });
  });

  it("builds short browse-style case labels for signal summaries", () => {
    expect(buildCaseLabel({
      patientSex: "女",
      patientAge: 52,
      chiefComplaint: "眩晕日久，伴颈肩僵硬",
    }, 1)).toBe("女52眩晕日久，伴颈肩僵硬");
    expect(buildCaseLabel({}, 3)).toBe("案例3");
  });

  it("normalizes old profile rows into the v1.1 display shape", () => {
    const profile = normalizeDoctorProfile({
      profileSummary: "记录较稳定。",
      gaps: [
        {
          gap: "既往史偏简",
          frequency: "2/4",
          guidanceHint: "下次可询问长期用药。",
        },
      ],
      guidancePoints: ["可以先肯定记录的主诉清楚。"],
    });

    expect(profile.profileSummary).toBe("记录较稳定。");
    expect(profile.gaps).toEqual([
      {
        field: "既往史偏简",
        inputRate: 0,
        aiAskRate: 0,
        evidence: "2/4",
        caseNumbers: [],
        guidanceHint: "下次可询问长期用药。",
      },
    ]);
    expect(profile.guidancePoints).toEqual([
      { text: "可以先肯定记录的主诉清楚。", caseNumbers: [] },
    ]);
  });

  it("maps medical draft reviews into the stored doctor profile shape", () => {
    const profile = doctorReviewDraftToProfile({
      clinicalSummary: "疼痛筋伤病例较多，针灸与方药并用。",
      mainCaseTypes: ["疼痛筋伤", "呼吸咳嗽"],
      treatmentStyle: ["针灸处理局部筋伤", "方药重视气血辨证"],
      aiMedicalRiskThemes: ["针刺深度与解剖风险"],
      strengths: ["体检发现能支持辨证"],
      discussionDirections: ["可进一步统一高风险部位复核习惯"],
      conversationReference: ["可先肯定其治疗方向清楚。"],
    });

    expect(profile.profileSummary).toBe("疼痛筋伤病例较多，针灸与方药并用。");
    expect(profile.keyObservations).toEqual([
      "疼痛筋伤",
      "呼吸咳嗽",
      "针灸处理局部筋伤",
      "方药重视气血辨证",
    ]);
    expect(profile.aiRecurringThemes).toEqual([
      { theme: "针刺深度与解剖风险", frequency: "", caseNumbers: [] },
    ]);
    expect(profile.gaps[0]?.evidence).toBe("可进一步统一高风险部位复核习惯");
    expect(profile.guidancePoints).toEqual([
      { text: "可先肯定其治疗方向清楚。" },
    ]);
  });
});
