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
    description: "至少说明本次最需要处理的问题，避免复核失焦。",
  },
  {
    key: "currentPlan",
    label: "当前方案或处理方向",
    description: "让系统先看你准备怎么做，才能复核是否稳妥。",
  },
  {
    key: "timeline",
    label: "病程或时间线",
    description: "至少补到病程或既往治疗反应，系统才有基本判断依据。",
  },
  {
    key: "reviewIntent",
    label: "医生问题或清晰复核意图",
    description: "可以直接写明问题；若已写出明确诊断与现行方案，系统也可据此进入复核。",
  },
];

const typeSpecificRequirements: Record<(typeof caseTypes)[number], StageOneRequirement[]> = {
  "方药分析": [
    {
      key: "herbs",
      label: "方药内容",
      description: "需有药名、剂量或至少主要组成，才可复核方义与轻重。",
    },
  ],
  "针灸方案": [
    {
      key: "acupoints",
      label: "穴位与操作或具体手法",
      description: "需有穴位、手法、推拿或其他具体治疗方式，才可复核配穴与操作思路。",
    },
  ],
  "综合调理": [
    {
      key: "treatmentDetail",
      label: "主要处理细节",
      description: "至少提供方药、穴位、推拿，或在当前方案中描述具体处理方式，才能继续复核。",
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
    tonguePulse: z.string(),
    chiefComplaint: z.string().trim().min(1, "请填写主诉。"),
    duration: z.string(),
    history: z.string(),
    currentPlan: z.string().trim().min(1, "请填写当前方案。"),
    herbs: z.string(),
    acupoints: z.string(),
    doctorQuestion: z.string(),
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

    if (value.caseType === "针灸方案" && !value.acupoints.trim() && !hasConcreteManualTreatment(value.currentPlan)) {
      context.addIssue({
        code: "custom",
        path: ["acupoints"],
        message: "针灸方案至少需要填写穴位与操作，或在当前方案中描述具体手法/治疗方式。",
      });
    }

    if (value.caseType === "综合调理" && !value.herbs.trim() && !value.acupoints.trim() && !hasConcreteManualTreatment(value.currentPlan)) {
      context.addIssue({
        code: "custom",
        path: ["currentPlan"],
        message: "综合调理至少需要补充方药内容、穴位与操作，或在当前方案中描述具体处理方式（如推拿、手法等）。",
      });
    }

    if (isVagueQuestion(value.doctorQuestion) && !hasImpliedReviewIntent(value)) {
      context.addIssue({
        code: "custom",
        path: ["doctorQuestion"],
        message: "问题较笼统；若能补一句这次最想确认的临床目标，复核会更聚焦。",
      });
    }
  });

export type CaseForm = z.infer<typeof caseSchema>;

function normalizeSearchText(form: Pick<CaseForm, "chiefComplaint" | "duration" | "history" | "currentPlan" | "herbs" | "acupoints" | "doctorQuestion" | "constitution" | "tonguePulse">) {
  return [
    form.chiefComplaint,
    form.duration,
    form.history,
    form.currentPlan,
    form.herbs,
    form.acupoints,
    form.doctorQuestion,
    form.constitution,
    form.tonguePulse,
  ]
    .join(" ")
    .trim();
}

function isVagueQuestion(question: string) {
  const text = question.trim();
  if (!text) return false;
  return /帮我看看|随便|都可以|看看/.test(text);
}

function hasTreatmentDetail(form: CaseForm) {
  return Boolean(form.currentPlan.trim() || form.herbs.trim() || form.acupoints.trim());
}

function hasConcreteManualTreatment(plan: string) {
  return /推拿|按摩|正骨|整脊|手法|艾灸|拔罐|刮痧|针灸/.test(plan);
}

export function hasImpliedReviewIntent(form: CaseForm) {
  const explicitQuestion = form.doctorQuestion.trim();
  if (explicitQuestion && !isVagueQuestion(explicitQuestion)) {
    return true;
  }

  const hasClinicalBasis = Boolean(form.chiefComplaint.trim() || form.history.trim() || form.duration.trim());
  return hasClinicalBasis && hasTreatmentDetail(form);
}

function hasLiteratureRequest(form: CaseForm) {
  return /文献|临床研究|研究文献|网上可查询|检索/.test(normalizeSearchText(form));
}

function isGynePcosCase(form: CaseForm) {
  return /PCOS|多囊|停经|月经|经期|卵泡|妇科/.test(normalizeSearchText(form));
}

function isMusculoskeletalAcupunctureCase(form: CaseForm) {
  return (
    form.caseType === "针灸方案" &&
    /肩|颈|腰|膝|腕|肘|拇指|弹响指|酸痛|麻木|活动受限|关节|肌腱/.test(normalizeSearchText(form))
  );
}

function isGiDampHeatCase(form: CaseForm) {
  return /腹胀|胃酸|反流|大便|便秘|口中异味|口苦|咽干|湿热|苔黄|苔腻/.test(normalizeSearchText(form));
}

export function getBlockedReasons(form: CaseForm) {
  const blockedReasons: string[] = [];

  if (isVagueQuestion(form.doctorQuestion) && !hasImpliedReviewIntent(form)) {
    blockedReasons.push("当前问题仍偏笼统，暂时难以形成有针对性的临床复核。");
  }

  if (/保证|治愈|包好|一定好/.test(`${form.doctorQuestion}${form.currentPlan}`)) {
    blockedReasons.push("当前表述含有保证疗效或治愈倾向，不符合本工具的临床边界。");
  }

  if (/我是患者|我自己|我可以吃|我该怎么办/.test(`${form.doctorQuestion}${form.currentPlan}${form.history}`)) {
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

  if (!form.duration.trim() && !form.history.trim()) {
    hints.push("请至少补充病程或既往治疗反应，系统才有基本判断依据。");
  }

  if (!form.doctorQuestion.trim() && !hasImpliedReviewIntent(form)) {
    hints.push("若方便，请补一句这次最想确认的问题；或把现行方案写得更清楚一些。");
  }

  if (isVagueQuestion(form.doctorQuestion) && !hasImpliedReviewIntent(form)) {
    hints.push("建议把“想确认什么”写得更具体，例如是否合适、哪里要调、接下来如何跟进。");
  }

  if (form.caseType === "方药分析" && !form.herbs.trim()) {
    hints.push("请补充方药内容，至少给出主要药物与剂量。");
  }

  if (form.caseType === "针灸方案" && !form.acupoints.trim() && !hasConcreteManualTreatment(form.currentPlan)) {
    hints.push("请补充穴位与操作，或在当前方案中写明具体手法或治疗方式（如推拿、艾灸等）。");
  }

  if (form.caseType === "综合调理" && !form.herbs.trim() && !form.acupoints.trim() && !hasConcreteManualTreatment(form.currentPlan)) {
    hints.push("请至少补充方药内容、穴位与操作，或在当前方案中描述具体处理方式（如推拿、手法等）。");
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
    hasImpliedReviewIntent: hasImpliedReviewIntent(form),
  };
}

export function getMissingContext(form: CaseForm) {
  const reminders: string[] = [];

  if (!form.age.trim()) reminders.push("年龄未填写，后续可补充以帮助判断剂量与风险。");
  if (!form.sex.trim()) reminders.push("性别未填写，后续可补充以帮助妇科、生殖与禁忌判断。");
  if (!form.constitution.trim()) reminders.push("体质与生活背景未填写，后续可补充睡眠、饮食、运动、压力等。");
  if (!form.tonguePulse.trim()) reminders.push("若已见舌脉或四诊要点，建议顺手写入，后续辨证会更稳。");
  if (!form.history.trim()) reminders.push("病史与治疗反应若能再具体一些，会更利于判断当前方案是否延续。");
  if (!form.duration.trim()) reminders.push("若能补充更明确的病程时间线，后续判断会更稳。");

  if (form.caseType === "方药分析" && form.herbs.trim() && !/\d/.test(form.herbs)) {
    reminders.push("若方便，可补充剂量或剂型，便于判断药力轻重。");
  }

  if (form.caseType === "针灸方案" && form.acupoints.trim() && !/针|灸|留针|电针|艾灸|手法/.test(form.acupoints)) {
    reminders.push("若方便，可补充操作方式、刺激量或疗程安排。");
  }

  if (isGynePcosCase(form)) {
    if (!/舌|脉/.test(form.tonguePulse)) reminders.push("妇科/PCOS病案若能补舌脉与四诊信息，辨证与阶段判断会更清楚。");
    if (!/BMI|体重|胰岛素|激素|AMH|月经/.test(normalizeSearchText(form))) {
      reminders.push("妇科/PCOS病案可进一步补月经周期节点、体重/BMI或激素代谢检查线索。");
    }
  }

  if (isMusculoskeletalAcupunctureCase(form)) {
    if (!/每周|每次|次|留针|分钟|深度|电针|艾灸|手法/.test(normalizeSearchText(form))) {
      reminders.push("针灸筋骨病案可补充频率、留针/手法与局部功能变化，后续更易判断疗效。");
    }
  }

  if (isGiDampHeatCase(form)) {
    if (!form.tonguePulse.trim()) {
      reminders.push("脾胃湿热类病案建议补舌苔、脉象与二便细节，后续更利于寒热虚实判断。");
    }
  }

  if (!form.doctorQuestion.trim() && hasImpliedReviewIntent(form)) {
    reminders.push("这份病案已能进入复核；若方便，补一句最想确认的问题，系统会更聚焦。");
  }

  if (hasLiteratureRequest(form)) {
    reminders.push("若希望结合临床研究，当前会先给经验性复核；外部文献检索仍属后续能力。");
  }

  return reminders;
}
