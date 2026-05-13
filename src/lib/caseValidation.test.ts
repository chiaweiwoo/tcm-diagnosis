import { describe, expect, it } from "vitest";
import { CaseForm, validateCaseForm } from "./caseValidation";

const validHerbCase: CaseForm = {
  caseType: "方药分析",
  age: "33",
  sex: "女",
  constitution: "素食者",
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

  it("针灸方案缺少当前方案时拦截，并提醒补充穴位操作", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      caseType: "针灸方案",
      currentPlan: "",
      herbs: "",
      acupoints: "",
    });

    expect(result.errors.currentPlan).toBe("请填写当前方案。");
    expect(result.errors.acupoints).toBe("针灸方案至少需要填写穴位与操作。");
  });

  it("拦截过于笼统的医生问题", () => {
    const result = validateCaseForm({
      ...validHerbCase,
      doctorQuestion: "帮我看看",
    });

    expect(result.errors.doctorQuestion).toBe("问题过于笼统，请写明想确认的临床目标。");
    expect(result.blockedReasons).toContain("医生问题过于笼统，暂时无法形成有针对性的复核。");
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
});
