import { z } from "zod";

export const caseTypes = ["方药分析", "针灸方案", "综合调理"] as const;
export const modelModes = ["快速模式", "深度模式"] as const;

export type StageOneRequirement = {
  key: string;
  label: string;
  description: string;
};

export const commonStageOneRequirements: StageOneRequirement[] = [
  {
    key: "chiefComplaint",
    label: "主诉或核心病情",
    description: "至少说明当前最需要处理的问题，避免判断失焦。",
  },
  {
    key: "currentPlan",
    label: "当前方案或处理方向",
    description: "让系统先看你现在准备怎么做，才能复核是否稳妥。",
  },
  {
    key: "doctorQuestion",
    label: "医生问题",
    description: "明确你想确认什么，例如是否合适、哪里要调、接下来怎么跟。",
  },
  {
    key: "timeline",
    label: "病程或时间线",
    description: "至少要知道多久、何时变化，才有基本判断依据。",
  },
];

const typeSpecificRequirements: Record<(typeof caseTypes)[number], StageOneRequirement[]> = {
  方药分析: [
    {
      key: "herbs",
      label: "方药内容",
      description: "需要药名、剂量或至少主要组成，才可复核方义与轻重。",
    },
  ],
  针灸方案: [
    {
      key: "acupoints",
      label: "穴位与操作",
      description: "需要穴位、手法或治疗方式，才可复核配穴与操作思路。",
    },
  ],
  综合调理: [
    {
      key: "treatmentDetail",
      label: "主要处理细节",
      description: "若涉及方药或针灸，至少要有一项具体内容，才能继续复核。",
    },
  ],
};

export function getStageOneRequirements(caseType: (typeof caseTypes)[number]) {
  return [...commonStageOneRequirements, ...typeSpecificRequirements[caseType]];
}

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
    const timelineMissing = !value.duration.trim() && !value.history.trim();

    if (timelineMissing) {
      context.addIssue({
        code: "custom",
        path: ["duration"],
        message: "请至少补充病程或既往治疗反应，便于建立基本判断依据。",
      });
    }

    if (value.caseType === "方药分析" && !value.herbs.trim()) {
      context.addIssue({
        code: "custom",
        path: ["herbs"],
        message: "方药分析至少需要填写处方或方药内容。",
      });
    }

    if (value.caseType === "针灸方案" && !value.acupoints.trim()) {
      context.addIssue({
        code: "custom",
        path: ["acupoints"],
        message: "针灸方案至少需要填写穴位与操作。",
      });
    }

    if (value.caseType === "综合调理" && !value.herbs.trim() && !value.acupoints.trim()) {
      context.addIssue({
        code: "custom",
        path: ["currentPlan"],
        message: "综合调理至少需要补充方药内容或穴位与操作中的一项。",
      });
    }

    if (/帮我看看|随便|都可以|看看/i.test(value.doctorQuestion.trim())) {
      context.addIssue({
        code: "custom",
        path: ["doctorQuestion"],
        message: "问题过于笼统，请写明想确认的临床目标。",
      });
    }
  });

export type CaseForm = z.infer<typeof caseSchema>;

export function getBlockedReasons(form: CaseForm) {
  const blockedReasons: string[] = [];

  if (/帮我看看|随便|都可以|看看/i.test(form.doctorQuestion.trim())) {
    blockedReasons.push("医生问题过于笼统，暂时无法形成有针对性的复核。");
  }

  if (/保证|治愈|包好|一定好/.test(`${form.doctorQuestion}${form.currentPlan}`)) {
    blockedReasons.push("当前表述含有保证疗效或治愈倾向，不符合本工具的临床边界。");
  }

  if (/我是患者|我自己|我可以吃|我该怎么办/.test(form.doctorQuestion)) {
    blockedReasons.push("内容疑似患者自用场景；本工具仅供注册中医师参考。");
  }

  return blockedReasons;
}

function getStageOneBlockingHints(form: CaseForm) {
  const hints: string[] = [];

  if (!form.chiefComplaint.trim()) {
    hints.push("请先说明本次最需要处理的主诉或核心病情。");
  }

  if (!form.currentPlan.trim()) {
    hints.push("请先写明当前方案或准备采取的处理方向。");
  }

  if (!form.doctorQuestion.trim()) {
    hints.push("请明确这次想复核的问题，例如是否合适、哪里要调整。");
  }

  if (!form.duration.trim() && !form.history.trim()) {
    hints.push("请至少补充病程或既往治疗反应，系统才有基本判断依据。");
  }

  if (form.caseType === "方药分析" && !form.herbs.trim()) {
    hints.push("请补充方药内容，至少给出主要药物与剂量。");
  }

  if (form.caseType === "针灸方案" && !form.acupoints.trim()) {
    hints.push("请补充穴位与操作，至少说明主要配穴或治疗方式。");
  }

  if (form.caseType === "综合调理" && !form.herbs.trim() && !form.acupoints.trim()) {
    hints.push("请至少补充方药内容或穴位与操作中的一项。");
  }

  return hints;
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

  const blockedReasons = getBlockedReasons(form);
  const stageOneHints = getStageOneBlockingHints(form);

  return {
    errors,
    blockedReasons,
    missingContext: getMissingContext(form),
    stageOneHints,
    canProceed: stageOneHints.length === 0 && blockedReasons.length === 0,
  };
}

export function getMissingContext(form: CaseForm) {
  const reminders: string[] = [];

  if (!form.age.trim()) reminders.push("年龄未填写，后续可补充以帮助判断剂量与风险。");
  if (!form.sex.trim()) reminders.push("性别未填写，后续可补充以帮助妇科、生殖与禁忌判断。");
  if (!form.constitution.trim()) reminders.push("体质与生活背景未填写，后续可补充睡眠、饮食、运动、压力等。");
  if (!form.history.trim()) reminders.push("病史与治疗反应若能再具体一些，会更利于判断当前方案是否延续。");
  if (!form.duration.trim()) reminders.push("若能补充更明确的病程时间线，后续判断会更稳。");

  if (form.caseType === "方药分析" && form.herbs.trim() && !/\d/.test(form.herbs)) {
    reminders.push("若方便，可补充剂量或剂型，便于判断药力轻重。");
  }

  if (form.caseType === "针灸方案" && form.acupoints.trim() && !/针|灸|留针|电针|艾灸|手法/.test(form.acupoints)) {
    reminders.push("若方便，可补充操作方式、刺激量或疗程安排。");
  }

  return reminders;
}
