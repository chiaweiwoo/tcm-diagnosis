/**
 * Semantic validation layer — fires after structural (zod) validation, before main analysis.
 * Uses a lightweight DeepSeek flash call to catch issues a regex cannot reliably detect.
 *
 * Fail-open: if the validator call itself throws, the caller should allow the request through.
 * This is intentional — we never block a doctor because of an LLM infrastructure hiccup.
 */
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { StructuredCaseForm } from "@/lib/forms/caseSchema";

export type SemanticIssue = {
  field: string;
  message: string;
};

export type SemanticValidationResult = {
  valid: boolean;
  issues: SemanticIssue[];
};

export const TCM_VALIDATOR_PROMPT_VERSION = "tcm-validator-v0.2";

export const TCM_VALIDATOR_SYSTEM_PROMPT = `
你是中医病案结构审核助手。仅做格式与信息完整性检查，不做临床判断。
只根据输入内容判断，不推断或补全未提及的信息。

任务：
检查以下病案字段是否满足最低信息要求。当前版本仅检查主诉（chiefComplaint）一项。输出 JSON，不要任何其他文字。

检查规则：
1. 主诉（chiefComplaint）：必须包含可辨认的症状持续时长（如"2周"、"3个月"、"半年余"、"多年"等）。
   - 若主诉完全没有提及时长，返回 issue。
   - 若时长模糊但可接受（如"多年"、"长期"、"近年"），不算问题。
   - 若时长缺失（完全没提），请说明。

自检后输出：
- valid: boolean（所有检查均通过则为 true）
- issues: 数组，每条包含 field（字段名）和 message（简短中文说明）

输出契约：
- 只输出一个 JSON 对象，无 Markdown 代码块，无前后说明
- 所有 message 使用简体中文
- 无问题时 issues 为 []

必须输出以下结构：
{ "valid": true, "issues": [] }
或
{ "valid": false, "issues": [{ "field": "chiefComplaint", "message": "主诉未注明症状持续时长。" }] }
`.trim();

export function buildTcmValidatorUserPrompt(form: StructuredCaseForm): string {
  return `请检查以下病案字段：

主诉（chiefComplaint）：${form.chiefComplaint}`;
}

export async function validateCaseSemantics(
  form: StructuredCaseForm,
): Promise<SemanticValidationResult> {
  const result = await callDeepSeekJson<SemanticValidationResult>({
    messages: [
      { role: "system", content: TCM_VALIDATOR_SYSTEM_PROMPT },
      { role: "user", content: buildTcmValidatorUserPrompt(form) },
    ],
    maxTokens: 200,
    model: getDeepSeekFastModel(),
    timeoutMs: 10_000,
    repairJson: true,
  });

  const data = result.data;

  // Normalise — ensure shape is correct even if model returns something unexpected
  return {
    valid: typeof data.valid === "boolean" ? data.valid : true,
    issues: Array.isArray(data.issues) ? data.issues : [],
  };
}
