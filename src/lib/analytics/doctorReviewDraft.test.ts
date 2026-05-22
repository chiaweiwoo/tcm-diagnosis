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
        analyzed_at: "2026-05-20T00:00:00.000Z",
        form_data: {
          patientSex: "女",
          patientAge: "35",
          chiefComplaint: "膝外侧疼痛多时",
          diagnosis: "膝外侧副韧带炎",
          pattern: "气血瘀滞",
          prescriptionType: ["针灸"],
        },
        analysis_result: {
          cautions: ["针刺时避开腓总神经走行区。"],
        },
      },
      {
        analyzed_at: "2026-05-20T00:00:00.000Z",
        form_data: {
          patientSex: "女",
          patientAge: "45",
          chiefComplaint: "湿疹反复发作",
          diagnosis: "湿疹",
          pattern: "风寒湿",
          prescriptionType: ["方药"],
        },
        analysis_result: {
          cautions: ["温燥药可能加重口干便秘，需观察。"],
        },
      },
    ]);

    expect(signals.totalCases).toBe(2);
    expect(signals.caseTypeCounts).toContainEqual({ label: "疼痛筋伤", count: 1 });
    expect(signals.caseTypeCounts).toContainEqual({ label: "皮肤问题", count: 1 });
    expect(signals.treatmentMix).toContainEqual({ label: "针灸", count: 1 });
    expect(signals.treatmentMix).toContainEqual({ label: "方药", count: 1 });
    expect(signals.patternCounts).toContainEqual({ label: "气血瘀滞", count: 1 });
    expect(signals.riskThemeCounts).toContainEqual({ label: "针刺深度/解剖风险", count: 1 });
    expect(signals.riskThemeCounts).toContainEqual({ label: "温燥/伤阴", count: 1 });
  });
});
