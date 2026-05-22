import { describe, expect, it } from "vitest";
import {
  buildDraftCaseLabel,
  buildDraftMedicalSignals,
  extractMedicalRiskTags,
} from "./doctorReviewDraft";

describe("doctor review draft deterministic signals", () => {
  it("builds browse-friendly case labels", () => {
    expect(buildDraftCaseLabel({
      patientSex: "女",
      patientAge: "52",
      chiefComplaint: "反复眩晕伴耳鸣",
    }, 1)).toBe("女52岁反复眩晕伴耳鸣");

    expect(buildDraftCaseLabel({}, 3)).toBe("案例3");
  });

  it("extracts normalized medical risk tags from AI cautions", () => {
    const tags = extractMedicalRiskTags({
      cautions: [
        "巨骨穴深刺需注意肺尖，避免气胸。",
        "患者高血压，建议监测血压。",
        "活血药可能影响凝血。",
      ],
    });

    expect(tags).toEqual([
      "针刺深度/解剖风险",
      "血压/慢病监测",
      "活血/出血风险",
    ]);
  });

  it("computes medical aggregate signals without operational metadata", () => {
    const signals = buildDraftMedicalSignals([
      {
        caseNumber: 1,
        label: "女35岁膝痛",
        category: "疼痛筋伤",
        treatmentType: "针灸",
        patternOrLogic: "气血瘀滞",
        keyEvidence: "膝外侧压痛",
        aiRiskTags: ["针刺深度/解剖风险"],
      },
      {
        caseNumber: 2,
        label: "女45岁湿疹",
        category: "皮肤问题",
        treatmentType: "方药",
        patternOrLogic: "风寒湿",
        keyEvidence: "舌黯脉弦",
        aiRiskTags: ["温燥/伤阴"],
      },
    ], [
      {
        caseTypeTags: ["疼痛筋伤", "皮肤问题"],
        treatmentLogicTags: ["气血瘀滞", "风寒湿"],
        riskThemeTags: ["针刺深度/解剖风险", "温燥/伤阴"],
        strengthTags: ["体检支持判断", "治疗方向较清楚"],
      },
    ]);

    expect(signals.totalCases).toBe(2);
    expect(signals.caseTypeCounts).toContainEqual({ label: "疼痛筋伤", count: 1 });
    expect(signals.caseTypeCounts).toContainEqual({ label: "皮肤问题", count: 1 });
    expect(signals.treatmentMix).toContainEqual({ label: "针灸", count: 1 });
    expect(signals.treatmentMix).toContainEqual({ label: "方药", count: 1 });
    expect(signals.treatmentLogicCounts).toContainEqual({ label: "气血瘀滞", count: 1 });
    expect(signals.riskThemeCounts).toContainEqual({ label: "针刺深度/解剖风险", count: 1 });
    expect(signals.riskThemeCounts).toContainEqual({ label: "温燥/伤阴", count: 1 });
    expect(signals.strengthSignalCounts).toContainEqual({ label: "体检支持判断", count: 1 });
  });
});
