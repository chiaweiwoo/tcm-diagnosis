import { describe, expect, it } from "vitest";
import { mapOrganizedCaseToForm } from "./organizeCase";

describe("mapOrganizedCaseToForm", () => {
  it("normalizes wrong-shaped fields into a valid form payload", () => {
    const result = mapOrganizedCaseToForm(
      {
        病案类型: "方药分析",
        年龄: 33,
        性别: "女",
        舌脉与四诊要点: "舌红苔黄白腻，脉弦",
        主诉: "停经",
        当前方案: "调理方",
        方药内容: "当归10g",
        医生问题: "",
        整理备注: "药名待确认",
        建议补充: ["补充检查", null, 12],
      },
      "原始草稿",
    );

    expect(result.form.caseType).toBe("方药分析");
    expect(result.form.age).toBe("33");
    expect(result.form.tonguePulse).toBe("舌红苔黄白腻，脉弦");
    expect(result.form.doctorQuestion).toBe("");
    expect(result.notes).toEqual(["药名待确认"]);
    expect(result.suggestions).toEqual(["补充检查", "12"]);
  });

  it("falls back to comprehensive case type and draft history", () => {
    const result = mapOrganizedCaseToForm(
      {
        病案类型: "未知类型",
        主诉: "酸痛",
      },
      "草稿病史",
    );

    expect(result.form.caseType).toBe("综合调理");
    expect(result.form.history).toBe("草稿病史");
    expect(result.notes).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });
});
