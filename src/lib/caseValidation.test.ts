import { describe, expect, it } from "vitest";
import { CaseForm, validateCaseForm } from "./caseValidation";

const validHerbCase: CaseForm = {
  caseType: "方药分析",
  age: "33",
  sex: "女",
  constitution: "素食者",
  tonguePulse: "",
  chiefComplaint: "停经9月余",
  duration: "9月余",
  history: "有PCOS，药物催经后月经来潮。",
  currentPlan: "经后调理方颗粒5日。",
  herbs: "六味地黄5g，巴戟天1g，女贞子1g。",
  acupoints: "",
  doctorQuestion: "请判断当前经后调理方是否需要调整，并指出风险。",
  modelMode: "快速模式",
};

describe("病案校验", () => {
  it("允许资料完整的方药分析病案提交", () => {
    const result = validateCaseForm(validHerbCase);

    expect(result.errors).toEqual({});
    expect(result.blockedReasons).toEqual([]);
  });

  it("方药分析缺少方药内容时拦截", () => {
    const result = validateCaseForm({ ...validHerbCase, herbs: "" });

    expect(result.errors.herbs).toBe("方药分析至少需要填写处方或方药内容。");
  });

  it("缺少年龄性别病程时提醒但不拦截", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      age: "",
      sex: "",
      duration: "",
    });

    expect(result.errors.age).toBeUndefined();
    expect(result.errors.sex).toBeUndefined();
    expect(result.errors.duration).toBeUndefined();
    expect(result.missingContext).toContain("年龄未填写，后续可补充以帮助判断剂量与风险。");
    expect(result.missingContext).toContain("性别未填写，后续可补充以帮助妇科、生殖与禁忌判断。");
    expect(result.missingContext).toContain("若能补充更明确的病程时间线，后续判断会更稳。");
  });

  it("允许没有明确医生问题但已有清晰复核意图的病案继续提交", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      doctorQuestion: "",
    });

    expect(result.errors.doctorQuestion).toBeUndefined();
    expect(result.blockedReasons).toEqual([]);
    expect(result.stageOneHints).not.toContain(
      "若方便，请补一句这次最想确认的问题；或把现行方案写得更清楚一些。",
    );
    expect(result.hasImpliedReviewIntent).toBe(true);
  });

  it("针灸方案缺少当前方案时拦截，并提醒补充穴位操作", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      caseType: "针灸方案",
      currentPlan: "",
      herbs: "",
      acupoints: "",
    });

    expect(result.errors.currentPlan).toBe("请填写当前方案。");
    expect(result.errors.acupoints).toBe("针灸方案至少需要填写穴位与操作，或在当前方案中描述具体手法/治疗方式。");
  });

  it("拦截过于笼统的医生问题", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      currentPlan: "",
      herbs: "",
      doctorQuestion: "帮我看看",
    });

    expect(result.errors.doctorQuestion).toBe("问题较笼统；若能补一句这次最想确认的临床目标，复核会更聚焦。");
    expect(result.blockedReasons).toContain("当前问题仍偏笼统，暂时难以形成有针对性的临床复核。");
  });

  it("有现行方案时不因笼统问题而过度拦截", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      doctorQuestion: "帮我看看",
    });

    expect(result.errors.doctorQuestion).toBeUndefined();
    expect(result.blockedReasons).toEqual([]);
    expect(result.hasImpliedReviewIntent).toBe(true);
  });

  it("拦截保证疗效表述", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      doctorQuestion: "请给出一定好的方案。",
    });

    expect(result.blockedReasons).toContain("当前表述含有保证疗效或治愈倾向，不符合本工具的临床边界。");
  });

  it("拦截疑似患者自用请求", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      doctorQuestion: "我是患者，我可以吃这个方吗？",
    });

    expect(result.blockedReasons).toContain("内容疑似患者自用场景；本工具仅供注册中医师参考。");
  });

  it("对脾胃湿热类病案补充舌脉提醒", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      caseType: "综合调理",
      chiefComplaint: "腹胀多时，偶有胃酸倒流，大便不净感",
      duration: "",
      history: "诊断湿热，拟用颗粒方调理。",
      currentPlan: "防风通圣5 泽泻1 枳实1 栀子1 厚朴1 萆薢1",
      herbs: "防风通圣5 泽泻1 枳实1 栀子1 厚朴1 萆薢1",
      doctorQuestion: "",
      tonguePulse: "",
    });

    expect(result.missingContext).toContain("若已见舌脉或四诊要点，建议顺手写入，后续辨证会更稳。");
    expect(result.missingContext).toContain("脾胃湿热类病案建议补舌苔、脉象与二便细节，后续更利于寒热虚实判断。");
  });
});
