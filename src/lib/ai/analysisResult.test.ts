import { describe, expect, it } from "vitest";
import { buildAnalysisResult, ensureAnalysisResult, normalizeStringList } from "./analysisResult";

describe("buildAnalysisResult", () => {
  it("maps AI JSON to the 3-column UI contract", () => {
    const result = buildAnalysisResult(
      {
        重点结论: ["保留原调经方向", "优先优化剂量与随访节奏"],
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
      "方药",
    );

    expect(result.title).toBe("方药研判");
    expect(result.keyPoints).toEqual(["保留原调经方向", "优先优化剂量与随访节奏"]);
    // No summary field on new AnalysisResult
    expect("summary" in result).toBe(false);
    // 3 groups: 判断, 方案, 随访监测
    expect(result.groups.map((g) => g.title)).toEqual(["判断", "方案", "随访监测"]);
    expect(result.groups[0].sections.map((s) => s.title)).toEqual(["可取之处", "需要复核"]);
    expect(result.groups[1].sections.map((s) => s.title)).toEqual(["建议优化", "可选思路"]);
    expect(result.cautions).toEqual(["活血药需结合出血风险复核"]);
    expect(result.evidence).toEqual(["基于临床经验与通用知识，尚未接入外部文献检索。"]);
  });

  it("falls back to safe defaults when sections are missing", () => {
    const result = buildAnalysisResult({}, "针灸");

    expect(result.title).toBe("针灸研判");
    expect(result.keyPoints.length).toBeGreaterThan(0);
    expect(result.cautions.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.groups).toHaveLength(3);
  });

  it("normalizes wrong-shaped fields without throwing", () => {
    const result = buildAnalysisResult(
      {
        重点结论: "先复核，再调整",
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
      "方药",
    );

    expect(result.keyPoints).toEqual(["先复核，再调整"]);
    expect(result.groups.length).toBe(3);
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

describe("ensureAnalysisResult", () => {
  it("normalises a stored result with new-format groups", () => {
    const result = ensureAnalysisResult(
      {
        title: "方药研判",
        keyPoints: ["先看这一点"],
        groups: [
          {
            title: "判断",
            sections: [{ title: "可取之处", items: ["方向合理"] }],
          },
          {
            title: "方案",
            sections: [{ title: "建议优化", items: ["调剂量"] }],
          },
          {
            title: "随访监测",
            sections: [{ title: "随访监测", items: ["一周后复诊"] }],
          },
        ],
        cautions: ["注意出血风险"],
        evidence: ["基于临床经验"],
      },
      "方药",
    );

    expect(result).not.toBeNull();
    expect(result?.groups.map((g) => g.title)).toEqual(["判断", "方案", "随访监测"]);
    expect(result?.cautions).toEqual(["注意出血风险"]);
  });

  it("returns null for non-object input", () => {
    expect(ensureAnalysisResult(null)).toBeNull();
    expect(ensureAnalysisResult("string")).toBeNull();
    expect(ensureAnalysisResult(42)).toBeNull();
  });

  it("falls back to buildAnalysisResult for raw AI JSON shape", () => {
    const result = ensureAnalysisResult(
      {
        重点结论: ["结论A"],
        当前思路: { 可取之处: ["合理"], 需要复核: [] },
        建议优化: [],
        可选思路: [],
        风险与提醒: ["注意事项"],
        随访监测: [],
        证据状态: ["经验性复核"],
      },
      "针灸",
    );

    expect(result).not.toBeNull();
    expect(result?.title).toBe("针灸研判");
    expect(result?.keyPoints).toEqual(["结论A"]);
  });
});
