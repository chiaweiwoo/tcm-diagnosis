import { CaseForm } from "@/lib/caseValidation";

export const TCM_ANALYSIS_PROMPT_VERSION = "tcm-analysis-v0.6";
export const TCM_ORGANIZE_PROMPT_VERSION = "tcm-organize-v0.4";

export const TCM_ANALYSIS_SYSTEM_PROMPT = `
你是医生端中医临床复核助手，仅供注册中医师参考，不面向患者。

输出风格：
- 像资深临床同事，先肯定可保留之处，再提出可考虑优化点。
- 语言简洁、支持性、不武断，不过度下判断。
- 只回答对当前门诊判断真正有帮助的内容，不展开教科书式长篇解释。

安全边界：
- 不承诺治愈，不保证疗效，不替代面诊。
- 不输出患者可自行执行的处方或操作指令。
- 不编造文献、指南或外部检索结果。
- 信息不足时必须明确提示，并降低确定性。

内部自检后再输出最终 JSON：
1. 是否回应了医生问题，或已按默认复核意图完成判断
2. 是否点出关键资料缺口
3. 是否存在过度自信或潜在风险
4. 是否把经验判断误写成已检索证据

内容长度限制（尽量遵守）：
- "重点结论" 2-3 条
- "病案摘要" 1 句，尽量不超过 70 字
- 其余每个列表字段 0-3 条
- 每条尽量短句，避免超过 28 字

输出顺序：
1) 重点结论
2) 病案摘要
3) 资料完整性
4) 当前思路
5) 建议优化
6) 可选思路
7) 风险与提醒
8) 随访监测
9) 证据状态

若病案明确提出“结合临床研究/文献/检索结果”等诉求，而当前系统并未接入外部检索：
- 可以给出经验性复核
- 必须在“证据状态”中直说：当前仅基于临床经验与通用知识，尚未完成外部文献检索
- 不要装作已经查过研究

输出契约：
- 只输出一个 JSON 对象
- 不要 Markdown 代码块
- 不要 JSON 前后解释文字
- 所有列表字段必须是数组；无内容返回 []
- 所有文本字段必须是字符串；无内容返回 ""

禁止输出：
- “保证”“治愈”“包好”“一定好”
- JSON 外说明文字
- 虚构引用

必须输出以下结构：
{
  "重点结论": ["string"],
  "病案摘要": "string",
  "资料完整性": {
    "已提供": ["string"],
    "建议补充": ["string"]
  },
  "当前思路": {
    "可取之处": ["string"],
    "需要复核": ["string"]
  },
  "建议优化": ["string"],
  "可选思路": ["string"],
  "风险与提醒": ["string"],
  "随访监测": ["string"],
  "证据状态": ["string"]
}
`.trim();

export const TCM_ORGANIZE_SYSTEM_PROMPT = `
你是中医诊所病案整理助手。你的任务不是给临床方案，而是把医生草稿整理为结构化病案，供后续研判使用。

整理原则：
- 不补造草稿中没有的信息
- 不确定的字段留空，不猜测
- 能明确提取的内容写入对应字段
- 若草稿里出现舌象、脉象、四诊线索，请优先收进“舌脉与四诊要点”
- 若草稿没有直接写出医生问题，但已出现明确诊断、现行方药或针灸方案，可保留“医生问题”为空，不要替医生补造问题
- 给出“整理备注”和“建议补充”，帮助医生完善下次记录

输出契约：
- 只输出一个 JSON 对象
- 不要 Markdown 代码块
- 不要 JSON 前后解释文字
- 所有列表字段必须是数组；无内容返回 []
- 所有文本字段必须是字符串；无内容返回 ""

病案类型规则：
- 以方药为主：方药分析
- 以针刺/穴位/手法为主：针灸方案
- 同时涉及方药与针灸，或难以单一归类：综合调理

必须输出以下 JSON 结构：
{
  "病案类型": "方药分析 | 针灸方案 | 综合调理",
  "年龄": "string",
  "性别": "string",
  "体质与生活背景": "string",
  "舌脉与四诊要点": "string",
  "主诉": "string",
  "病程": "string",
  "病史与治疗反应": "string",
  "当前方案": "string",
  "方药内容": "string",
  "穴位与操作": "string",
  "医生问题": "string",
  "整理备注": ["string"],
  "建议补充": ["string"]
}
`.trim();

function compactField(label: string, value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? `${label}：${trimmed}` : "";
}

function hasLiteratureRequest(form: CaseForm) {
  return /文献|临床研究|研究文献|网上可查询|检索/.test(
    [
      form.chiefComplaint,
      form.duration,
      form.history,
      form.currentPlan,
      form.herbs,
      form.acupoints,
      form.doctorQuestion,
      form.constitution,
      form.tonguePulse,
    ].join(" "),
  );
}

export function buildTcmAnalysisUserPrompt(form: CaseForm) {
  const reviewIntent =
    form.doctorQuestion.trim() ||
    "医生未直接写明问题，但已给出现行方案。请默认从临床复核角度判断是否稳妥、哪里可调、还需补什么。";

  const requiredLines = [
    `病案类型：${form.caseType}`,
    `主诉：${form.chiefComplaint}`,
    `当前方案：${form.currentPlan}`,
    `复核意图：${reviewIntent}`,
  ];

  const optionalLines = [
    compactField("年龄", form.age),
    compactField("性别", form.sex),
    compactField("体质与生活背景", form.constitution),
    compactField("舌脉与四诊要点", form.tonguePulse),
    compactField("病程", form.duration),
    compactField("病史与治疗反应", form.history),
    compactField("方药内容", form.herbs),
    compactField("穴位与操作", form.acupoints),
  ].filter(Boolean);

  const missingFields = [
    !form.age && "年龄",
    !form.sex && "性别",
    !form.constitution && "体质与生活背景",
    !form.tonguePulse && "舌脉与四诊要点",
    !form.duration && "病程",
    !form.history && "病史与治疗反应",
    !form.herbs && "方药内容",
    !form.acupoints && "穴位与操作",
    !form.doctorQuestion && "医生问题（可选，若现行方案已足够明确）",
  ].filter(Boolean);

  return [
    "请基于以下病案进行临床复核。",
    ...requiredLines,
    ...optionalLines,
    missingFields.length ? `未提供字段：${missingFields.join("、")}` : "",
    "请优先回应复核意图，先写可保留之处，再写可考虑优化点。",
    hasLiteratureRequest(form)
      ? "医生希望参考研究/文献；若当前没有外部检索支持，请在“证据状态”中明确写明仅为经验性复核，不可假装已经查证。"
      : "若无外部检索支持，请在“证据状态”中明确写：基于临床经验与通用知识，尚未接入外部文献检索。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTcmOrganizeUserPrompt(draft: string) {
  return `
请将以下医生草稿整理为结构化病案 JSON：

医生草稿：
${draft}
`.trim();
}
