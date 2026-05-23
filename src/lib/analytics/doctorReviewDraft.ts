import { callDeepSeekJson, DeepSeekError, getDeepSeekFastModel, getDeepSeekSmartModel } from "@/lib/ai/deepseek";
import pLimit from "p-limit";
import { z } from "zod";
import { getLangfuse } from "@/lib/langfuse";

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
  stage:
    | "flash_case_cards"
    | "pro_synthesis"
    | "flash_cleanup"
    | "flash_single_synth"
    | "flash_batch_synth"
    | "flash_merge"
    | "pro_review";
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

export function inferCaseCategory(formData: Record<string, unknown> | null): string {
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

const flashCaseCardSchema = z.object({
  caseCard: z.object({
    label: z.string(),
    category: z.string(),
    treatmentType: z.string(),
    patternOrLogic: z.string(),
    keyEvidence: z.string(),
    aiRiskTags: z.array(z.string()).max(2),
  })
});

const doctorReviewDraftSchema = z.object({
  clinicalSummary: z.string(),
  mainCaseTypes: z.array(z.string()).max(4),
  treatmentStyle: z.array(z.string()).max(4),
  aiMedicalRiskThemes: z.array(z.string()).max(4),
  strengths: z.array(z.string()).max(4),
  discussionDirections: z.array(z.string()).max(4),
  conversationReference: z.array(z.string()).min(2).max(4),
});

function logGenerationToLangfuse({
  parent,
  name,
  model,
  startTime,
  endTime,
  usage,
  metadata,
}: {
  parent: any;
  name: string;
  model: string;
  startTime: number;
  endTime: number;
  usage?: Usage;
  metadata?: any;
}) {
  if (!parent) return;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const cacheHit = usage?.prompt_cache_hit_tokens ?? 0;
  const cacheMiss = usage?.prompt_cache_miss_tokens ?? 0;

  const hitPrice = 0.07;
  const missPrice = 0.27;
  const outPrice = 1.10;

  const inputCost = ((cacheHit * hitPrice) + (cacheMiss * missPrice)) / 1_000_000;
  const outputCost = (completionTokens * outPrice) / 1_000_000;
  const totalCost = inputCost + outputCost;

  parent.generation({
    name,
    model,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      unit: "TOKENS",
    },
    usageDetails: {
      cacheHit,
      cacheMiss,
    },
    costDetails: {
      input: inputCost,
      output: outputCost,
      total: totalCost,
    },
    metadata,
  });
}

function buildFallbackDraft(): DoctorReviewDraft {
  return {
    clinicalSummary: "暂无足够数据生成完整的临床分析摘要。",
    mainCaseTypes: ["常见中医病证"],
    treatmentStyle: ["常规中医调理"],
    aiMedicalRiskThemes: ["建议常规关注临床诊疗安全与随访监视"],
    strengths: ["诊疗流程记录完整"],
    discussionDirections: ["建议结合具体病案分析进一步复盘"],
    conversationReference: ["我们可以结合近期的病案记录来聊聊您的常用诊疗思路。"],
  };
}

async function buildFlashCaseCards(
  rows: DoctorReviewDraftRow[],
  calls: DraftCallDiagnostic[],
  trace: any,
): Promise<{ caseCards: DraftCaseCard[]; strengthSignals: string[]; okCount: number; fallbackCount: number }> {
  const fallback = deterministicCaseCards(rows);
  const model = getDeepSeekFastModel();
  const strengthSignals = rows.flatMap((row) => deterministicStrengthTags(row.form_data, row.analysis_result));

  const span1 = trace ? trace.span({ name: "stage1-flash-case-cards" }) : null;
  const limit1 = pLimit(6);

  let okCount = 0;
  let fallbackCount = 0;

  const caseCards = await Promise.all(
    rows.map((row, idx) =>
      limit1(async () => {
        const fallbackCard = fallback[idx];
        const sTime = Date.now();
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

          const endTime = Date.now();
          pushDiagnostic(calls, "flash_case_cards", result);

          if (span1 && result.usage) {
            logGenerationToLangfuse({
              parent: span1,
              name: "flash-case-card",
              model: result.model,
              startTime: sTime,
              endTime,
              usage: result.usage,
              metadata: { caseNumber: fallbackCard.caseNumber },
            });
          }

          const parseResult = flashCaseCardSchema.safeParse(result.data);
          const raw = parseResult.success ? parseResult.data.caseCard : null;
          if (raw) {
            okCount++;
            return {
              caseNumber: fallbackCard.caseNumber,
              label: compact(raw.label || fallbackCard.label, 28),
              category: compact(raw.category || fallbackCard.category, 16),
              treatmentType: compact(raw.treatmentType || fallbackCard.treatmentType, 16),
              patternOrLogic: compact(raw.patternOrLogic || fallbackCard.patternOrLogic, 36),
              keyEvidence: compact(raw.keyEvidence || fallbackCard.keyEvidence, 54),
              aiRiskTags: Array.isArray(raw.aiRiskTags) && raw.aiRiskTags.length
                ? raw.aiRiskTags.map((tag) => compact(tag, 18)).slice(0, 4)
                : fallbackCard.aiRiskTags,
            };
          }
        } catch (error) {
          // Log fallback silently below
        }
        fallbackCount++;
        return fallbackCard;
      })
    )
  );

  if (span1) span1.end();

  return {
    caseCards,
    strengthSignals,
    okCount,
    fallbackCount,
  };
}

function profileTooLong(profile: DoctorReviewDraft): boolean {
  return JSON.stringify(profile).length > 2600;
}

async function runSingleFlashSynthesis({
  signals,
  caseCards,
  windowDays,
  calls,
  trace,
}: {
  signals: DraftMedicalSignals;
  caseCards: DraftCaseCard[];
  windowDays: number;
  calls: DraftCallDiagnostic[];
  trace: any;
}): Promise<DoctorReviewDraft> {
  const span = trace ? trace.span({ name: "stage2-flash-single-synth" }) : null;
  const sTime = Date.now();
  const model = getDeepSeekFastModel();

  try {
    const result = await callDeepSeekJson<DoctorReviewDraft>({
      model,
      maxTokens: 2500,
      timeoutMs: 90_000,
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
            "不要在输出文案中写数量、比例、百分比或类似“几例/多少条”的表达。",
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
          ].join("\n"),
        },
      ],
    });

    pushDiagnostic(calls, "flash_single_synth", result);

    if (span && result.usage) {
      logGenerationToLangfuse({
        parent: span,
        name: "flash-single-synth",
        model: result.model,
        startTime: sTime,
        endTime: Date.now(),
        usage: result.usage,
      });
    }

    const parseResult = doctorReviewDraftSchema.safeParse(result.data);
    if (parseResult.success) {
      if (span) span.end();
      return parseResult.data;
    }
  } catch (err) {
    // Fall back to deterministic draft placeholder
  }

  if (span) span.end();
  return buildFallbackDraft();
}

async function runBatchSynthesis({
  signals,
  caseCards,
  windowDays,
  calls,
  trace,
}: {
  signals: DraftMedicalSignals;
  caseCards: DraftCaseCard[];
  windowDays: number;
  calls: DraftCallDiagnostic[];
  trace: any;
}): Promise<DoctorReviewDraft[]> {
  const span = trace ? trace.span({ name: "stage2a-flash-batch-synth" }) : null;
  const limit = pLimit(4);
  const batches: DraftCaseCard[][] = [];
  const batchSize = 12;
  for (let i = 0; i < caseCards.length; i += batchSize) {
    batches.push(caseCards.slice(i, i + batchSize));
  }

  const model = getDeepSeekFastModel();

  const partialDrafts = await Promise.all(
    batches.map((batch, batchIdx) =>
      limit(async () => {
        const sTime = Date.now();
        try {
          const result = await callDeepSeekJson<DoctorReviewDraft>({
            model,
            maxTokens: 1800,
            timeoutMs: 75_000,
            repairJson: true,
            retryOnEmpty: true,
            jsonMode: false,
            messages: [
              {
                role: "system",
                content: [
                  "你是中医临床工作工作模式分析员。现在处理的是医生一部分病案的批次分析。",
                  "重点是分析本批次病例的诊疗特点并输出草稿段落，不要在文案中写数量、比例或百分比。",
                  "只输出合法 JSON，不要 markdown。",
                  "字段必须为：clinicalSummary:string; mainCaseTypes:string[]; treatmentStyle:string[]; aiMedicalRiskThemes:string[]; strengths:string[]; discussionDirections:string[]; conversationReference:string[]。",
                  "每项数组最多不超过 4 项，每项不超过 24 个汉字；clinicalSummary 最多 2 句。",
                ].join("\n"),
              },
              {
                role: "user",
                content: [
                  `WINDOW_DAYS=${windowDays}`,
                  `BATCH_NUMBER=${batchIdx + 1}/${batches.length}`,
                  "AGGREGATE_SIGNALS",
                  serializeSignals(signals),
                  "",
                  "BATCH_CASE_CARDS",
                  serializeCaseCards(batch),
                ].join("\n"),
              },
            ],
          });

          pushDiagnostic(calls, "flash_batch_synth", result);

          if (span && result.usage) {
            logGenerationToLangfuse({
              parent: span,
              name: "flash-batch-synth",
              model: result.model,
              startTime: sTime,
              endTime: Date.now(),
              usage: result.usage,
              metadata: { batchIndex: batchIdx },
            });
          }

          const parseResult = doctorReviewDraftSchema.safeParse(result.data);
          if (parseResult.success) {
            return parseResult.data;
          }
        } catch (error) {
          // Fall back below
        }
        return buildFallbackDraft();
      })
    )
  );

  if (span) span.end();
  return partialDrafts;
}

async function runConsolidatedMerge({
  signals,
  partialDrafts,
  calls,
  trace,
}: {
  signals: DraftMedicalSignals;
  partialDrafts: DoctorReviewDraft[];
  calls: DraftCallDiagnostic[];
  trace: any;
}): Promise<DoctorReviewDraft> {
  const span = trace ? trace.span({ name: "stage2b-flash-merge" }) : null;
  const sTime = Date.now();
  const model = getDeepSeekFastModel();

  try {
    const result = await callDeepSeekJson<DoctorReviewDraft>({
      model,
      maxTokens: 2500,
      timeoutMs: 90_000,
      repairJson: true,
      retryOnEmpty: true,
      jsonMode: false,
      messages: [
        {
          role: "system",
          content: [
            "你是中医临床工作画像合并员。你的任务是将多个批次的临床诊断分析草稿合并为一份精简的、统一的画像草稿。",
            "合并时，去除重复和累赘的词汇，使语言自然并紧凑。不要在输出文案中写数量、比例或百分比。",
            "只输出合法 JSON，不要 markdown。",
            "字段必须为：clinicalSummary:string; mainCaseTypes:string[]; treatmentStyle:string[]; aiMedicalRiskThemes:string[]; strengths:string[]; discussionDirections:string[]; conversationReference:string[]。",
            "每项数组最多不超过 4 项，每项不超过 24 个汉字；clinicalSummary 最多 2 句。",
            "conversationReference必须给2-4条可直接对话的话术，不要留空。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "AGGREGATE_SIGNALS",
            serializeSignals(signals),
            "",
            "PARTIAL_DRAFTS_TO_MERGE",
            JSON.stringify(partialDrafts),
          ].join("\n"),
        },
      ],
    });

    pushDiagnostic(calls, "flash_merge", result);

    if (span && result.usage) {
      logGenerationToLangfuse({
        parent: span,
        name: "flash-merge",
        model: result.model,
        startTime: sTime,
        endTime: Date.now(),
        usage: result.usage,
      });
    }

    const parseResult = doctorReviewDraftSchema.safeParse(result.data);
    if (parseResult.success) {
      if (span) span.end();
      return parseResult.data;
    }
  } catch (error) {
    // Fallback below
  }

  if (span) span.end();
  if (partialDrafts.length > 0) {
    return partialDrafts[0];
  }
  return buildFallbackDraft();
}

async function runProCreativeReview({
  signals,
  consolidatedDraft,
  windowDays,
  calls,
  trace,
}: {
  signals: DraftMedicalSignals;
  consolidatedDraft: DoctorReviewDraft;
  windowDays: number;
  calls: DraftCallDiagnostic[];
  trace: any;
}): Promise<DoctorReviewDraft> {
  const span = trace ? trace.span({ name: "stage3-pro-review" }) : null;
  const sTime = Date.now();
  const model = getDeepSeekSmartModel();

  try {
    const result = await callDeepSeekJson<DoctorReviewDraft>({
      model,
      maxTokens: 3200,
      timeoutMs: 90_000, // Strict 90s timeout
      repairJson: true,
      retryOnEmpty: true,
      jsonMode: false,
      messages: [
        {
          role: "system",
          content: [
            "你是资深中医专家与临床工作画像润色员，负责给临床工作台管理员输出最能触达中医师灵魂的临床风格与复盘话术。",
            "不要修改原画像中的医学事实和诊断倾向，主要进行语言润色、语气提升和专业化表达。",
            "语气使用：可见、倾向、可讨论、可留意，不要批评和说教。不要在文案中写数量、比例或百分比。",
            "只输出合法 JSON，不要 markdown。",
            "字段必须为：clinicalSummary:string; mainCaseTypes:string[]; treatmentStyle:string[]; aiMedicalRiskThemes:string[]; strengths:string[]; discussionDirections:string[]; conversationReference:string[]。",
            "每项数组最多不超过 4 项，每项不超过 24 个汉字；clinicalSummary 最多 2 句。",
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
            "CONSOLIDATED_DRAFT_INPUT",
            JSON.stringify(consolidatedDraft),
            "",
            "请对上述画像草案进行高级医学润色，确保产出最专业、最能帮助管理员与医师展开技术复盘的最终中文文案。",
          ].join("\n"),
        },
      ],
    });

    pushDiagnostic(calls, "pro_review", result);

    if (span && result.usage) {
      logGenerationToLangfuse({
        parent: span,
        name: "pro-review",
        model: result.model,
        startTime: sTime,
        endTime: Date.now(),
        usage: result.usage,
      });
    }

    const parseResult = doctorReviewDraftSchema.safeParse(result.data);
    if (parseResult.success) {
      if (span) span.end();
      return parseResult.data;
    }
  } catch (error) {
    console.warn("[stage3:pro-review] Failed or timed out. Falling back to consolidated draft.", error);
  }

  if (span) span.end();
  return consolidatedDraft;
}

async function cleanupWithFlash(
  profile: DoctorReviewDraft,
  calls: DraftCallDiagnostic[],
  trace: any,
): Promise<DoctorReviewDraft> {
  const span = trace ? trace.span({ name: "stage4-cleanup" }) : null;
  const sTime = Date.now();
  const model = getDeepSeekFastModel();

  try {
    const result = await callDeepSeekJson<DoctorReviewDraft>({
      model,
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

    if (span && result.usage) {
      logGenerationToLangfuse({
        parent: span,
        name: "flash-cleanup",
        model: result.model,
        startTime: sTime,
        endTime: Date.now(),
        usage: result.usage,
      });
    }

    const parseResult = doctorReviewDraftSchema.safeParse(result.data);
    if (parseResult.success) {
      if (span) span.end();
      return parseResult.data;
    }
  } catch (error) {
    // Fall back to original
  }

  if (span) span.end();
  return profile;
}

export async function runDoctorReviewDraft({
  rows,
  windowDays,
  doctorId,
}: {
  rows: DoctorReviewDraftRow[];
  windowDays: number;
  doctorId?: string;
}): Promise<DoctorReviewDraftResult> {
  const globalStart = Date.now();
  console.log(`[evaluate-doctors] doctorId=${doctorId ?? "unknown"} windowDays=${windowDays}`);

  // Setup Langfuse trace
  const langfuse = getLangfuse();
  const trace = langfuse
    ? langfuse.trace({
        name: "doctor-evaluation",
        userId: doctorId,
        metadata: {
          windowDays,
          sampleSize: rows.length,
        },
      })
    : null;

  const calls: DraftCallDiagnostic[] = [];

  // Stage 1: Flash case cards
  const s1Start = Date.now();
  const { caseCards, strengthSignals, okCount, fallbackCount } = await buildFlashCaseCards(rows, calls, trace);
  const s1Duration = ((Date.now() - s1Start) / 1000).toFixed(1);
  console.log(`[stage1:flash-case-cards] N=${rows.length} limit=6 ok=${okCount} fallback=${fallbackCount} → ${s1Duration}s`);

  // Compute aggregate signals
  const signals = buildDraftMedicalSignals(caseCards, strengthSignals);

  // Synthesize draft
  let draft: DoctorReviewDraft;
  if (rows.length <= 12) {
    // Short circuit: Single Flash synthesis + Stage 3
    const singleStart = Date.now();
    const flashDraft = await runSingleFlashSynthesis({ signals, caseCards, windowDays, calls, trace });
    const singleDuration = ((Date.now() - singleStart) / 1000).toFixed(1);
    console.log(`[stage2:flash-single-synth] N=${rows.length} → ${singleDuration}s`);

    const proStart = Date.now();
    const inputChars = JSON.stringify(flashDraft).length;
    draft = await runProCreativeReview({ signals, consolidatedDraft: flashDraft, windowDays, calls, trace });
    const proDuration = ((Date.now() - proStart) / 1000).toFixed(1);
    console.log(`[stage3:pro-review] inputChars=${inputChars} → ${proDuration}s`);
  } else {
    // Stage 2a: Batched synthesis
    const s2aStart = Date.now();
    const partialDrafts = await runBatchSynthesis({ signals, caseCards, windowDays, calls, trace });
    const s2aDuration = ((Date.now() - s2aStart) / 1000).toFixed(1);
    const batchesCount = Math.ceil(caseCards.length / 12);
    console.log(`[stage2a:flash-batch-synth] batches=${batchesCount} size=12 limit=4 → ${s2aDuration}s`);

    // Stage 2b: Merged synthesis
    const s2bStart = Date.now();
    const consolidatedDraft = await runConsolidatedMerge({ signals, partialDrafts, calls, trace });
    const s2bDuration = ((Date.now() - s2bStart) / 1000).toFixed(1);
    console.log(`[stage2b:flash-merge] partials=${partialDrafts.length} → ${s2bDuration}s`);

    // Stage 3: Pro creative review
    const proStart = Date.now();
    const inputChars = JSON.stringify(consolidatedDraft).length;
    draft = await runProCreativeReview({ signals, consolidatedDraft, windowDays, calls, trace });
    const proDuration = ((Date.now() - proStart) / 1000).toFixed(1);
    console.log(`[stage3:pro-review] inputChars=${inputChars} → ${proDuration}s`);
  }

  // Stage 4: Flash cleanup
  const s4Start = Date.now();
  const draftSize = JSON.stringify(draft).length;
  if (profileTooLong(draft)) {
    draft = await cleanupWithFlash(draft, calls, trace);
    const s4Duration = ((Date.now() - s4Start) / 1000).toFixed(1);
    console.log(`[stage4:flash-cleanup] size=${draftSize} → ${s4Duration}s`);
  } else {
    console.log(`[stage4:flash-cleanup] skipped (size=${draftSize})`);
  }

  const totalDuration = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log(`[evaluate-doctors] total=${totalDuration}s model=flash+pro`);

  if (trace) {
    // Flush trace to Langfuse in background
    trace.update({
      output: {
        draftSize: JSON.stringify(draft).length,
        totalDurationSeconds: Number(totalDuration),
      }
    });
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
