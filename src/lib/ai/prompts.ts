import { StructuredCaseForm } from "@/lib/forms/caseSchema";

export const TCM_ANALYSIS_PROMPT_VERSION = "tcm-analysis-v0.8";

export const TCM_ANALYSIS_SYSTEM_PROMPT = `
你是医生端中医临床复核助手，仅供注册中医师参考，不面向患者。

输出风格：
- 像资深临床同事，先肯定可保留之处，再提出可考虑优化点。
- 语言简洁、支持性、不武断，不过度下判断。
- 只回答对当前门诊判断真正有帮助的内容，不展开教科书式长篇解释。
- 不确定或资料不足时，使用"据临床经验推测""尚不确定""可能为""建议进一步确认"等措辞，不可直接断言。

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
- 其余每个列表字段 0-3 条
- 每条尽量短句，避免超过 28 字

输出顺序：
1) 重点结论
2) 当前思路
3) 建议优化
4) 可选思路
5) 风险与提醒
6) 随访监测
7) 证据状态

若病案明确提出"结合临床研究/文献/检索结果"等诉求，而当前系统并未接入外部检索：
- 可以给出经验性复核
- 必须在"证据状态"中直说：当前仅基于临床经验与通用知识，尚未完成外部文献检索
- 不要装作已经查过研究

输出契约：
- 只输出一个 JSON 对象
- 不要 Markdown 代码块
- 不要 JSON 前后解释文字
- 所有列表字段必须是数组；无内容返回 []
- 所有文本字段必须是字符串；无内容返回 ""
- 所有输出必须使用简体中文

禁止输出：
- "保证""治愈""包好""一定好"
- JSON 外说明文字
- 虚构引用

必须输出以下结构：
{
  "重点结论": ["string"],
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

function compactField(label: string, value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? `${label}：${trimmed}` : "";
}

function hasLiteratureRequest(form: StructuredCaseForm) {
  return /文献|临床研究|研究文献|网上可查询|检索/.test(
    [
      form.chiefComplaint,
      form.currentIllness,
      form.pastHistory,
      form.physicalExam,
      form.diagnosis,
      form.pattern,
      form.prescription,
      form.doctorQuestion,
    ].join(" "),
  );
}

export function buildTcmAnalysisUserPrompt(form: StructuredCaseForm): string {
  const reviewIntent =
    form.doctorQuestion?.trim() ||
    "医生未直接写明问题，但已给出现行方案。请默认从临床复核角度判断是否稳妥、哪里可调、还需补什么。";

  const lines = [
    "请基于以下结构化病案进行临床复核。",
    `处方类型：${form.prescriptionType.join("、")}`,
    compactField("患者", `${form.patientSex}/${form.patientAge}岁`),
    `主诉：${form.chiefComplaint}`,
    `现病史：${form.currentIllness}`,
    compactField("既往史", form.pastHistory),
    compactField("体格检查", form.physicalExam),
    `诊断：${form.diagnosis}`,
    compactField("证型", form.pattern),
    `处方：${form.prescription}`,
    `复核意图：${reviewIntent}`,
    "请优先回应复核意图，先写可保留之处，再写可考虑优化点。",
    hasLiteratureRequest(form)
      ? '医生希望参考研究/文献；若当前没有外部检索支持，请在“证据状态”中明确写明仅为经验性复核，不可假装已经查证。'
      : '若无外部检索支持，请在“证据状态”中明确写：基于临床经验与通用知识，尚未接入外部文献检索。',
  ];

  return lines.filter(Boolean).join("\n");
}
