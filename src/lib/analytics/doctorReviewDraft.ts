import { callDeepSeekJson, DeepSeekError, getDeepSeekFastModel, getDeepSeekSmartModel } from "@/lib/ai/deepseek";

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

export type DoctorReviewDraftRow = {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
};

export type DraftCaseCard = {
  caseNumber: number;
  label: string;
  category: string;
  treatmentType: string;
  patternOrLogic: string;
  keyEvidence: string;
  aiRiskTags: string[];
};

export type DoctorReviewDraft = {
  clinicalSummary: string;
  mainCaseTypes: string[];
  treatmentStyle: string[];
  aiMedicalRiskThemes: string[];
  strengths: string[];
  discussionDirections: string[];
  conversationReference: string[];
};

export type DraftCallDiagnostic = {
  stage: "flash_case_cards" | "pro_synthesis" | "flash_cleanup";
  model: string;
  usage?: Usage;
  finishReason?: string | null;
  repairedJson?: boolean;
  maxTokens?: number;
};

export type DraftMedicalSignals = {
  totalCases: number;
  caseTypeCounts: Array<{ label: string; count: number }>;
  treatmentMix: Array<{ label: string; count: number }>;
  treatmentLogicCounts: Array<{ label: string; count: number }>;
  riskThemeCounts: Array<{ label: string; count: number }>;
  strengthSignalCounts: Array<{ label: string; count: number }>;
  representativeLabels: string[];
};

export type DoctorReviewDraftResult = {
  ok: true;
  mode: "medical_profile_v2";
  windowDays: number;
  recordCount: number;
  signals: DraftMedicalSignals;
  caseCards: DraftCaseCard[];
  draft: DoctorReviewDraft;
  diagnostics: {
    calls: DraftCallDiagnostic[];
  };
};

type FlashCaseCardResponse = {
  caseCard: Omit<DraftCaseCard, "caseNumber">;
};

const MAX_RAW_CASE_CHARS = {
  complaint: 36,
  currentIllness: 96,
  physicalExam: 72,
  diagnosis: 36,
  pattern: 36,
};

const FLASH_CASE_CONCURRENCY = 6;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: unknown, max: number): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function topCounts(values: string[], max = 8): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([label, count]) => ({ label, count }));
}

function compactTags(values: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => compact(item, maxChars))
    .slice(0, maxItems);
}

export function buildDraftCaseLabel(formData: Record<string, unknown> | null | undefined, index: number): string {
  const sex = stringValue(formData?.patientSex);
  const age = stringValue(formData?.patientAge) || (typeof formData?.patientAge === "number" ? String(formData.patientAge) : "");
  const complaint = compact(formData?.chiefComplaint, 14).replace(/\s+/g, "");
  const label = `${sex}${age ? `${age}岁` : ""}${complaint}`;
  return label || `案例${index}`;
}

function prescriptionTypeLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("、") || "未注明";
  }
  return stringValue(value) || "未注明";
}

function collectAnalysisText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAnalysisText(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectAnalysisText(item, out);
  }
  return out;
}

function collectCautions(analysisResult: Record<string, unknown> | null): string {
  const cautions = analysisResult?.cautions;
  if (Array.isArray(cautions)) {
    return cautions.filter((item): item is string => typeof item === "string").join("；");
  }
  return collectAnalysisText(analysisResult).join(" ");
}

function inferCaseCategory(formData: Record<string, unknown> | null): string {
  const primaryText = [
    formData?.chiefComplaint,
    formData?.diagnosis,
  ].map((value) => String(value ?? "")).join(" ");
  const allText = [
    formData?.chiefComplaint,
    formData?.currentIllness,
    formData?.diagnosis,
    formData?.pattern,
  ].map((value) => String(value ?? "")).join(" ");

  if (/月经|经期|乳房|妇|孕|冲任|带下/.test(primaryText)) return "妇科调理";
  if (/湿疹|皮肤|瘙痒|痤疮|疱疹/.test(primaryText)) return "皮肤问题";
  if (/咳|感冒|鼻|咽|痰|呼吸|支气管/.test(primaryText)) return "呼吸咳嗽";
  if (/胃|腹|便秘|大便|纳呆|痞满|消化/.test(primaryText)) return "脾胃消化";
  if (/失眠|焦虑|情绪|多梦|睡眠|心烦/.test(primaryText)) return "睡眠情志";
  if (/减肥|肥胖|体重|代谢/.test(primaryText)) return "体重代谢";
  if (/痛|疼|伤筋|劳损|肩|腰|膝|腕|肘|颈|跟骨|肌|关节|筋|痹/.test(primaryText)) return "疼痛筋伤";

  if (/月经|经期|乳房|妇|孕|冲任|带下/.test(allText)) return "妇科调理";
  if (/湿疹|皮肤|瘙痒|痤疮|疱疹/.test(allText)) return "皮肤问题";
  if (/咳|感冒|鼻|咽|痰|呼吸|支气管/.test(allText)) return "呼吸咳嗽";
  if (/胃|腹|便秘|大便|纳呆|痞满|消化/.test(allText)) return "脾胃消化";
  if (/失眠|焦虑|情绪|多梦|睡眠|心烦/.test(allText)) return "睡眠情志";
  if (/减肥|肥胖|体重|代谢/.test(allText)) return "体重代谢";
  if (/痛|疼|伤筋|劳损|肩|腰|膝|腕|肘|颈|跟骨|肌|关节|筋|痹/.test(allText)) return "疼痛筋伤";
  return "其他";
}

export function extractMedicalRiskTags(analysisResult: Record<string, unknown> | null): string[] {
  const text = collectCautions(analysisResult);
  const tags: string[] = [];
  const add = (tag: string, pattern: RegExp) => {
    if (pattern.test(text) && !tags.includes(tag)) tags.push(tag);
  };

  add("针刺深度/解剖风险", /深刺|气胸|神经|脊髓|血管|脏器|肺尖|坐骨/);
  add("进一步检查/转诊", /转诊|拍片|MRI|超声|排除|进一步检查|复查|骨折|椎间盘|卒中/);
  add("血压/慢病监测", /血压|高血压|降压|升压|心悸/);
  add("温燥/伤阴", /温燥|伤阴|口干|便秘|裂纹|阴液|滋腻/);
  add("肝肾功能监测", /肝肾|肝功|肾功|转氨酶|肾功能/);
  add("感染/消毒", /感染|消毒|皮肤破损/);
  add("药物相互作用", /相互作用|西药|抗凝|Rinvoq|乌帕替尼|降压药/);
  add("活血/出血风险", /活血|出血|凝血|红花|益母草|桃仁/);

  return tags.slice(0, 4);
}

function deterministicStrengthTags(
  formData: Record<string, unknown> | null,
  analysisResult: Record<string, unknown> | null,
): string[] {
  const tags: string[] = [];
  const exam = stringValue(formData?.physicalExam);
  const pastHistory = stringValue(formData?.pastHistory);
  const prescription = stringValue(formData?.prescription);
  const pattern = stringValue(formData?.pattern);
  const cautions = collectCautions(analysisResult);

  if (/[舌脉]/.test(exam)) tags.push("体检支持判断");
  if (pastHistory) tags.push("慢病背景有交代");
  if (prescription && pattern) tags.push("治疗方向较清楚");
  if (/未发现明显用药禁忌|无明显用药禁忌/.test(cautions)) tags.push("风险提示较克制");

  return tags;
}

function treatmentLogic(formData: Record<string, unknown> | null): string {
  const pattern = compact(formData?.pattern, 28);
  const diagnosis = compact(formData?.diagnosis, 24);
  return [pattern, diagnosis].filter(Boolean).join(" / ") || "未注明";
}

function keyEvidence(formData: Record<string, unknown> | null): string {
  const exam = stringValue(formData?.physicalExam);
  if (!exam) return "未注明";

  const tonguePulse = exam.match(/[^。；\n]*(舌|脉)[^。；\n]*/)?.[0];
  if (tonguePulse) return compact(tonguePulse, 46);

  return compact(exam, 46);
}

export function buildDraftMedicalSignals(
  caseCards: DraftCaseCard[],
  strengthSignals: string[],
): DraftMedicalSignals {
  const categories = caseCards.map((card) => card.category);
  const treatmentTypes = caseCards.map((card) => card.treatmentType);
  const treatmentLogics = caseCards.map((card) => card.patternOrLogic).filter(Boolean);
  const risks = caseCards.flatMap((card) => card.aiRiskTags);
  return {
    totalCases: caseCards.length,
    caseTypeCounts: topCounts(categories),
    treatmentMix: topCounts(treatmentTypes),
    treatmentLogicCounts: topCounts(treatmentLogics),
    riskThemeCounts: topCounts(risks),
    strengthSignalCounts: topCounts(strengthSignals),
    representativeLabels: caseCards.map((card) => card.label).slice(0, 8),
  };
}

function serializeRawCase(row: DoctorReviewDraftRow, caseNumber: number): string {
  const formData = row.form_data ?? {};
  const riskHint = extractMedicalRiskTags(row.analysis_result).join("/");
  return [
    `#${caseNumber}`,
    `label=${buildDraftCaseLabel(formData, caseNumber)}`,
    `type=${prescriptionTypeLabel(formData.prescriptionType)}`,
    `category_hint=${inferCaseCategory(formData)}`,
    `chief=${compact(formData.chiefComplaint, MAX_RAW_CASE_CHARS.complaint)}`,
    `illness=${compact(formData.currentIllness, MAX_RAW_CASE_CHARS.currentIllness)}`,
    `exam=${compact(formData.physicalExam, MAX_RAW_CASE_CHARS.physicalExam)}`,
    `diagnosis=${compact(formData.diagnosis, MAX_RAW_CASE_CHARS.diagnosis)}`,
    `pattern=${compact(formData.pattern, MAX_RAW_CASE_CHARS.pattern)}`,
    `risk_hint=${riskHint || "none"}`,
  ].join(" | ");
}

function serializeSignals(signals: DraftMedicalSignals): string {
  return [
    `totalCases=${signals.totalCases}`,
    `caseTypes=${signals.caseTypeCounts.map((item) => `${item.label}${item.count}`).join(" / ") || "none"}`,
    `treatmentMix=${signals.treatmentMix.map((item) => `${item.label}${item.count}`).join(" / ") || "none"}`,
    `treatmentLogics=${signals.treatmentLogicCounts.map((item) => `${item.label}${item.count}`).join(" / ") || "none"}`,
    `riskThemes=${signals.riskThemeCounts.map((item) => `${item.label}${item.count}`).join(" / ") || "none"}`,
    `strengthSignals=${signals.strengthSignalCounts.map((item) => `${item.label}${item.count}`).join(" / ") || "none"}`,
    `examples=${signals.representativeLabels.join(" / ") || "none"}`,
  ].join("\n");
}

function deterministicCaseCards(rows: DoctorReviewDraftRow[]): DraftCaseCard[] {
  return rows.map((row, index) => {
    const formData = row.form_data ?? {};
    return {
      caseNumber: index + 1,
      label: buildDraftCaseLabel(formData, index + 1),
      category: inferCaseCategory(formData),
      treatmentType: prescriptionTypeLabel(formData.prescriptionType),
      patternOrLogic: treatmentLogic(formData),
      keyEvidence: keyEvidence(formData),
      aiRiskTags: extractMedicalRiskTags(row.analysis_result),
    };
  });
}

function normalizeCaseCards(cards: DraftCaseCard[], fallback: DraftCaseCard[]): DraftCaseCard[] {
  const byNumber = new Map(cards.map((card) => [card.caseNumber, card]));
  return fallback.map((deterministic) => {
    const card = byNumber.get(deterministic.caseNumber);
    if (!card) return deterministic;
    return {
      caseNumber: deterministic.caseNumber,
      label: compact(card.label || deterministic.label, 28),
      category: compact(card.category || deterministic.category, 16),
      treatmentType: compact(card.treatmentType || deterministic.treatmentType, 16),
      patternOrLogic: compact(card.patternOrLogic || deterministic.patternOrLogic, 36),
      keyEvidence: compact(card.keyEvidence || deterministic.keyEvidence, 54),
      aiRiskTags: Array.isArray(card.aiRiskTags) && card.aiRiskTags.length
        ? card.aiRiskTags.map((tag) => compact(tag, 18)).slice(0, 4)
        : deterministic.aiRiskTags,
    };
  });
}

function serializeCaseCards(cards: DraftCaseCard[]): string {
  return cards.map((card) => [
    `#${card.caseNumber} ${card.label}`,
    `病类:${card.category}`,
    `治疗:${card.treatmentType}`,
    `思路:${card.patternOrLogic}`,
    `证据:${card.keyEvidence}`,
    `AI风险:${card.aiRiskTags.join("、") || "无明显重复"}`,
  ].join(" | ")).join("\n");
}

function pushDiagnostic(
  calls: DraftCallDiagnostic[],
  stage: DraftCallDiagnostic["stage"],
  result: {
    model: string;
    usage?: Usage;
    finishReason?: string | null;
    repairedJson?: boolean;
    maxTokens?: number;
  },
) {
  calls.push({
    stage,
    model: result.model,
    usage: result.usage,
    finishReason: result.finishReason,
    repairedJson: result.repairedJson ?? false,
    maxTokens: result.maxTokens,
  });
}

async function buildFlashCaseCards(
  rows: DoctorReviewDraftRow[],
  calls: DraftCallDiagnostic[],
): Promise<{ caseCards: DraftCaseCard[]; strengthSignals: string[] }> {
  const fallback = deterministicCaseCards(rows);
  const model = getDeepSeekFastModel();
  const strengthSignals = rows.flatMap((row) => deterministicStrengthTags(row.form_data, row.analysis_result));

  const flashResults: Array<{
    card: DraftCaseCard;
    diagnostic: {
      model: string;
      usage?: Usage;
      finishReason?: string | null;
      repairedJson?: boolean;
      maxTokens?: number;
    };
  }> = [];

  async function runCase(row: DoctorReviewDraftRow, fallbackCard: DraftCaseCard) {
    try {
      const result = await callDeepSeekJson<FlashCaseCardResponse>({
        model,
        maxTokens: 220,
        timeoutMs: 60_000,
        repairJson: true,
        retryOnEmpty: true,
        jsonMode: false,
        messages: [
          {
            role: "system",
            content: [
              "You compress one TCM consultation into one tiny caseCard.",
              "Do not evaluate the doctor. Do not expand the text. Do not add facts not present in the input.",
              "Prefer the provided category_hint and risk_hint unless they are clearly wrong.",
              "Keep every field very short: label <= 10 chars, category <= 6 chars, patternOrLogic <= 10 chars, keyEvidence <= 12 chars.",
              "aiRiskTags may contain at most 2 items, each <= 8 chars.",
              "Return valid JSON only.",
              'Shape: {"caseCard":{"label":"女35咳嗽","category":"呼吸","treatmentType":"方药","patternOrLogic":"寒痰","keyEvidence":"舌暗红苔白","aiRiskTags":["血压监测"]}}',
            ].join("\n"),
          },
          { role: "user", content: serializeRawCase(row, fallbackCard.caseNumber) },
        ],
      });

      const raw = result.data.caseCard;
      return {
        card: {
          caseNumber: fallbackCard.caseNumber,
          label: compact(raw?.label || fallbackCard.label, 28),
          category: compact(raw?.category || fallbackCard.category, 16),
          treatmentType: compact(raw?.treatmentType || fallbackCard.treatmentType, 16),
          patternOrLogic: compact(raw?.patternOrLogic || fallbackCard.patternOrLogic, 36),
          keyEvidence: compact(raw?.keyEvidence || fallbackCard.keyEvidence, 54),
          aiRiskTags: Array.isArray(raw?.aiRiskTags) && raw.aiRiskTags.length
            ? raw.aiRiskTags.map((tag) => compact(tag, 18)).slice(0, 4)
            : fallbackCard.aiRiskTags,
        },
        diagnostic: {
          model: result.model,
          usage: result.usage,
          finishReason: result.finishReason,
          repairedJson: result.repairedJson ?? false,
          maxTokens: result.maxTokens,
        },
      };
    } catch (error) {
      const details = error instanceof DeepSeekError ? (error.details ?? {}) : {};
      return {
        card: fallbackCard,
        diagnostic: {
          model,
          usage: typeof details === "object" && details && "usage" in details ? details.usage as Usage : undefined,
          finishReason: typeof details === "object" && details && "finishReason" in details ? String(details.finishReason ?? "fallback") : "fallback",
          repairedJson: false,
          maxTokens: 220,
        },
      };
    }
  }

  for (let index = 0; index < rows.length; index += FLASH_CASE_CONCURRENCY) {
    const groupRows = rows.slice(index, index + FLASH_CASE_CONCURRENCY);
    const groupFallbacks = fallback.slice(index, index + FLASH_CASE_CONCURRENCY);
    const groupResults = await Promise.all(
      groupRows.map((row, rowIndex) => runCase(row, groupFallbacks[rowIndex])),
    );
    flashResults.push(...groupResults);
  }

  for (const result of flashResults) {
    pushDiagnostic(calls, "flash_case_cards", result.diagnostic);
  }

  return {
    caseCards: flashResults.map((result) => result.card),
    strengthSignals,
  };
}

function profileTooLong(profile: DoctorReviewDraft): boolean {
  return JSON.stringify(profile).length > 2600;
}

async function synthesizeWithPro({
  signals,
  caseCards,
  windowDays,
  calls,
}: {
  signals: DraftMedicalSignals;
  caseCards: DraftCaseCard[];
  windowDays: number;
  calls: DraftCallDiagnostic[];
}): Promise<DoctorReviewDraft> {
  const model = getDeepSeekSmartModel();
  const result = await callDeepSeekJson<DoctorReviewDraft>({
    model,
    maxTokens: 3200,
    timeoutMs: 180_000,
    repairJson: true,
    retryOnEmpty: true,
    jsonMode: false,
    messages: [
      {
        role: "system",
        content: [
          "你是中医临床工作画像分析员，输出给管理员用于理解医生的临床工作模式。",
          "重点是医学画像，不是行政统计，也不是审计报告。",
          "只基于给定 AGGREGATE_SIGNALS 与 CASE_CARDS，不要发明病例、比例或诊疗事实。",
          "不要评价医生临床判断对错。语气使用：可见、倾向、可讨论、可留意。",
          "不要建议医生扩大病种范围；病例结构只作为观察背景，不作为能力评价。",
          "输出紧凑、具体、能帮助管理员与医生沟通。",
          "只输出合法 JSON，不要 markdown。",
          "字段必须为：clinicalSummary:string; mainCaseTypes:string[]; treatmentStyle:string[]; aiMedicalRiskThemes:string[]; strengths:string[]; discussionDirections:string[]; conversationReference:string[]。",
          "数组每项不超过 24 个汉字；clinicalSummary 最多 2 句；每个数组最多 4 项。",
          "conversationReference必须给2-4条可直接对话的话术，不要留空。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `WINDOW_DAYS=${windowDays}`,
          "AGGREGATE_SIGNALS",
          serializeSignals(signals),
          "",
          "CASE_CARDS",
          serializeCaseCards(caseCards),
          "",
          "请输出这六个医学部分：主要病例类型、诊疗思路与治疗风格、AI反复关注的医学风险、可取之处、可讨论方向、对话参考。",
        ].join("\n"),
      },
    ],
  });
  pushDiagnostic(calls, "pro_synthesis", result);
  return result.data;
}

async function cleanupWithFlash(profile: DoctorReviewDraft, calls: DraftCallDiagnostic[]): Promise<DoctorReviewDraft> {
  const result = await callDeepSeekJson<DoctorReviewDraft>({
    model: getDeepSeekFastModel(),
    maxTokens: 1200,
    timeoutMs: 90_000,
    repairJson: true,
    retryOnEmpty: true,
    jsonMode: false,
    messages: [
      {
        role: "system",
        content: [
          "你只负责压缩 JSON 文案，不改变含义，不添加医学事实。",
          "保留相同字段。clinicalSummary 最多2句；数组每项不超过24个汉字；每个数组最多4项。",
          "只输出合法 JSON。",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(profile) },
    ],
  });
  pushDiagnostic(calls, "flash_cleanup", result);
  return result.data;
}

export async function runDoctorReviewDraft({
  rows,
  windowDays,
}: {
  rows: DoctorReviewDraftRow[];
  windowDays: number;
}): Promise<DoctorReviewDraftResult> {
  const calls: DraftCallDiagnostic[] = [];
  const { caseCards, strengthSignals } = await buildFlashCaseCards(rows, calls);
  const signals = buildDraftMedicalSignals(caseCards, strengthSignals);
  let draft = await synthesizeWithPro({ signals, caseCards, windowDays, calls });

  if (profileTooLong(draft)) {
    draft = await cleanupWithFlash(draft, calls);
  }

  return {
    ok: true,
    mode: "medical_profile_v2",
    windowDays,
    recordCount: rows.length,
    signals,
    caseCards,
    draft,
    diagnostics: { calls },
  };
}
