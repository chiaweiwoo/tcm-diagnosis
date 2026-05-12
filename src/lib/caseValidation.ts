import { z } from "zod";

export const caseTypes = ["方药分析", "针灸方案", "综合调理"] as const;
export const modelModes = ["快速模式", "深度模式"] as const;

export const caseSchema = z
  .object({
    caseType: z.enum(caseTypes, { error: "请选择病案类型。" }),
    age: z.string(),
    sex: z.string(),
    constitution: z.string(),
    chiefComplaint: z.string().trim().min(1, "请填写主诉。"),
    duration: z.string(),
    history: z.string(),
    currentPlan: z.string().trim().min(1, "请填写当前方案。"),
    herbs: z.string(),
    acupoints: z.string(),
    doctorQuestion: z.string().trim().min(1, "请填写医生问题。"),
    modelMode: z.enum(modelModes),
  })
  .superRefine((value, context) => {
    if (value.caseType === "方药分析" && !value.herbs.trim()) {
      context.addIssue({
        code: "custom",
        path: ["herbs"],
        message: "方药分析至少需要填写处方或方药内容。",
      });
    }

    if (
      value.caseType === "针灸方案" &&
      !value.acupoints.trim() &&
      !value.currentPlan.trim()
    ) {
      context.addIssue({
        code: "custom",
        path: ["acupoints"],
        message: "针灸方案至少需要填写现有穴位或治疗方法。",
      });
    }

    if (/帮我看看|随便|都可以|看看/i.test(value.doctorQuestion.trim())) {
      context.addIssue({
        code: "custom",
        path: ["doctorQuestion"],
        message: "问题过于笼统，请写明需要判断、改良或比较的临床目标。",
      });
    }
  });

export type CaseForm = z.infer<typeof caseSchema>;

export function getBlockedReasons(form: CaseForm) {
  const blockedReasons: string[] = [];

  if (/帮我看看|随便|都可以|看看/i.test(form.doctorQuestion.trim())) {
    blockedReasons.push("医生问题过于笼统。");
  }

  if (/保证|治愈|包好|一定好/.test(`${form.doctorQuestion}${form.currentPlan}`)) {
    blockedReasons.push("请求含有保证疗效或治愈表述。");
  }

  if (/我是患者|我自己|我可以吃|我该怎么办/.test(form.doctorQuestion)) {
    blockedReasons.push("请求疑似患者自用场景，本工具仅供注册中医师参考。");
  }

  return blockedReasons;
}

export function validateCaseForm(form: CaseForm) {
  const parsed = caseSchema.safeParse(form);
  const errors: Partial<Record<keyof CaseForm, string>> = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CaseForm | undefined;
      if (key && !errors[key]) {
        errors[key] = issue.message;
      }
    }
  }

  return {
    errors,
    blockedReasons: getBlockedReasons(form),
    missingContext: getMissingContext(form),
  };
}

export function getMissingContext(form: CaseForm) {
  const reminders: string[] = [];

  if (!form.age.trim()) reminders.push("年龄未填写，会影响剂量、风险与病程判断。");
  if (!form.sex.trim()) reminders.push("性别未填写，会影响妇科、泌尿、生殖与部分禁忌判断。");
  if (!form.duration.trim()) reminders.push("病程未填写，难以区分急性、慢性或反复发作。");
  if (!form.constitution.trim()) reminders.push("体质与生活背景未填写，后续可补充睡眠、饮食、运动、压力等。");
  if (!form.history.trim()) reminders.push("病史与治疗反应未填写，较难判断当前方案是否有效或需停用。");

  if (form.caseType === "方药分析" && !form.herbs.trim()) {
    reminders.push("方药内容不足，建议补充药名、剂量、剂型与服用天数。");
  }

  if (form.caseType === "针灸方案" && !form.acupoints.trim()) {
    reminders.push("穴位与操作未填写，建议补充穴位、针刺深度、刺激量与疗程。");
  }

  return reminders;
}
