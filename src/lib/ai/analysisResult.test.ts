import { describe, expect, it } from "vitest";
import { buildAnalysisResult, normalizeStringList } from "./analysisResult";

describe("buildAnalysisResult", () => {
  it("maps grouped analysis fields to UI contract", () => {
    const result = buildAnalysisResult(
      {
        重点结论: ["保留原调经方向", "优先优化剂量与随访节奏"],
        病案摘要: "患者以调理月经周期为当前目标。",
        资料完整性: {
          已提供: ["主诉与病程较清晰"],
          建议补充: ["补充基础化验与随访周期"],
        },
        当前思路: {
          可取之处: ["当前方案方向基本合理"],
          需要复核: ["确认关键药名是否存在笔误"],
        },
        建议优化: ["将关键颗粒剂量上调到可观察区间"],
        可选思路: ["若复诊反馈不佳，再考虑二线方案"],
        风险与提醒: ["活血药需结合出血风险复核"],
        随访监测: ["建议1个周期后复诊复核执行效果"],
        证据状态: ["基于临床经验与通用知识，尚未接入外部文献检索。"],
      },
      "方药分析",
    );

    expect(result.title).toBe("方药分析研判");
    expect(result.keyPoints).toEqual(["保留原调经方向", "优先优化剂量与随访节奏"]);
    expect(result.summary).toBe("患者以调理月经周期为当前目标。");
    expect(result.groups.map((group) => group.title)).toEqual(["资料完整性", "当前思路", "建议优化", "随访监测"]);
    expect(result.cautions).toEqual(["活血药需结合出血风险复核"]);
    expect(result.evidence).toEqual(["基于临床经验与通用知识，尚未接入外部文献检索。"]);
  });

  it("falls back to safe defaults when sections are missing", () => {
    const result = buildAnalysisResult({}, "针灸方案");

    expect(result.title).toBe("针灸方案研判");
    expect(result.keyPoints.length).toBeGreaterThan(0);
    expect(result.cautions.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("normalizes wrong-shaped fields without throwing", () => {
    const result = buildAnalysisResult(
      {
        重点结论: "先复核，再调整",
        病案摘要: 1234,
        资料完整性: {
          已提供: "主诉已给",
          建议补充: null,
        },
        当前思路: {
          可取之处: ["方向可保留", 7],
          需要复核: { note: "剂量单位需确认" },
        },
        建议优化: "",
        可选思路: ["可选A"],
        风险与提醒: false,
        随访监测: "复诊观察周期",
        证据状态: "",
      },
      "方药分析",
    );

    expect(result.keyPoints).toEqual(["先复核，再调整"]);
    expect(result.summary).toBe("1234");
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.cautions.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});

describe("normalizeStringList", () => {
  it("coerces array and scalar values into clean string arrays", () => {
    expect(normalizeStringList(["A", " ", 2, false])).toEqual(["A", "2", "false"]);
    expect(normalizeStringList("单条")).toEqual(["单条"]);
    expect(normalizeStringList(null)).toEqual([]);
  });
});
