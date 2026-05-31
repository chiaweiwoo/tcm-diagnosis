/**
 * Core computation logic for the doctor risk-nudge feature.
 * Two stages:
 *   1. Deterministic keyword bucketing (always runs; graceful floor)
 *   2. DeepSeek flash rephrasing of labels + example selection (polish; optional)
 *
 * Robustness guarantee: if AI fails for any reason, deterministic bucket labels
 * and examples are used as-is. The caller NEVER receives an empty result due to
 * an AI outage.
 *
 * Invariant 8: caution text goes to DeepSeek (permitted recipient).
 *              Langfuse receives tokens/cost/latency ONLY — never caution text.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { getLangfuse } from "@/lib/langfuse";
import {
  BOILERPLATE,
  WINDOW_DAYS,
  bucketCautions,
  type SurfacedBucket,
} from "./buckets";
import { getPrompt } from "@/lib/prompts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NudgeTheme = {
  key: string;
  count: number;
  description?: string;
  examples: string[];
  originalKey?: string;
};

export type NudgeComputeStatus =
  | "computed"
  | "no-cases"
  | "no-themes"
  | "skipped"; // watermark unchanged

export type NudgeComputeResult = {
  status: NudgeComputeStatus;
  themeCount?: number;
};

export type AiThemeOutput = { key: string; description: string; examples: string[] };

export const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  "转诊 / 排除器质病变": "建议转诊或进一步影像检查以排除器质性病变",
  "针刺安全（深度·解剖）": "针刺时注意进针深度，避开重要血管、神经和脏器解剖部位",
  "手法 / 推拿安全": "推拿与手法治疗时注意力度适中，避免暴力操作造成二次损伤",
  "出血 / 抗凝 / 活血药": "活血化瘀类药物与侵入性操作需防范出血风险，关注凝血及经期禁忌",
  "感染防控 / 操作禁忌": "严格执行无菌消毒操作，防范局部感染，严格排查治疗禁忌症",
  "剂量 / 药物体质": "注意用量剂量，结合患者体质防范毒副作用及合理配伍",
  "慢病监测": "高血压、糖尿病等慢性病调理期间，需嘱咐患者定期监测生理指标",
  "复诊指征": "嘱咐患者若出现症状加重或无改善，应及时复诊或寻求专科评估",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns MAX(analyzed_at) for the doctor, or null if no analyzed cases. */
export async function getLatestAnalyzedAt(
  client: SupabaseClient,
  doctorId: string,
): Promise<Date | null> {
  const { data, error } = await client
    .from("consultations")
    .select("analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.analyzed_at) return null;
  return new Date(data.analyzed_at as string);
}

/**
 * Returns true if we should recompute:
 *   - No existing row (first run), OR
 *   - latest analyzed_at > stored source_last_record_at (new cases since last nudge)
 *   - force=true bypasses watermark check
 */
export async function needsRecompute(
  client: SupabaseClient,
  doctorId: string,
  latest: Date,
  force = false,
  promptVersion?: string,
): Promise<boolean> {
  if (force) return true;

  const { data, error } = await client
    .from("doctor_risk_nudges")
    .select("source_last_record_at, prompt_version")
    .eq("doctor_id", doctorId)
    .maybeSingle();

  if (error || !data) return true; // no row → must compute
  if (!data.source_last_record_at) return true;

  // Resolve dynamically from prompt registry
  const { version: resolvedVersion } = getPrompt("risk-nudge", promptVersion);

  // Recompute if prompt version changed
  if ((data.prompt_version as string | null) !== resolvedVersion) return true;

  const stored = new Date(data.source_last_record_at as string);
  return latest > stored;
}

/** Parse the AI JSON array output; returns [] on any failure. */
export function parseAiOutput(text: string): AiThemeOutput[] {
  try {
    const raw = JSON.parse(text);
    const arr: unknown = Array.isArray(raw)
      ? raw
      : (raw as Record<string, unknown>).themes ??
        (raw as Record<string, unknown>).items ??
        (raw as Record<string, unknown>).data ??
        Object.values(raw as Record<string, unknown>)[0];

    if (!Array.isArray(arr)) return [];

    return (arr as unknown[])
      .filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).key === "string",
      )
      .map((item) => ({
        key: String(item.key).trim(),
        description: typeof item.description === "string" ? String(item.description).trim() : "",
        examples: Array.isArray(item.examples)
          ? (item.examples as unknown[])
              .map((e) => String(e).trim())
              .filter(Boolean)
              .slice(0, 5)
          : [],
      }));
  } catch {
    return [];
  }
}

/**
 * Merge AI output into surfaced buckets by index.
 * Falls back to the bucket's own key/examples if AI output is missing or too short.
 */
export function mergeWithAi(
  surfaced: SurfacedBucket[],
  aiItems: AiThemeOutput[],
): NudgeTheme[] {
  return surfaced.map((bucket, i) => {
    const ai = aiItems[i];
    return {
      key: ai?.key || bucket.key,
      count: bucket.count,
      description: ai?.description || FALLBACK_DESCRIPTIONS[bucket.key] || "",
      examples: (ai?.examples?.length ? ai.examples : bucket.examples).slice(0, 5),
      originalKey: bucket.key,
    };
  });
}

// ─── Main compute function ────────────────────────────────────────────────────

/**
 * Compute and upsert the risk-nudge row for a single doctor.
 * Graceful degradation: AI failure → deterministic labels used as-is.
 */
export async function computeNudgeForDoctor(
  client: SupabaseClient,
  doctorId: string,
  options: { force?: boolean; promptVersion?: string } = {},
): Promise<NudgeComputeResult> {
  const t0 = Date.now();

  const { version: resolvedVersion, prompt: systemPrompt } = getPrompt("risk-nudge", options.promptVersion);

  // Step 1: get latest analyzed_at
  const latest = await getLatestAnalyzedAt(client, doctorId);
  if (!latest) {
    // No analyzed cases at all — upsert empty record
    await client.from("doctor_risk_nudges").upsert(
      {
        doctor_id: doctorId,
        themes: [],
        window_start: null,
        window_end: null,
        source_last_record_at: null,
        case_count: 0,
        caution_count: 0,
        model: null,
        prompt_version: resolvedVersion,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "doctor_id" },
    );
    return { status: "no-cases", themeCount: 0 };
  }

  // Step 2: watermark check
  const shouldRecompute = await needsRecompute(client, doctorId, latest, options.force, options.promptVersion);
  if (!shouldRecompute) {
    return { status: "skipped" };
  }

  // Step 3: fetch consultations in the 14-day window ending at latest
  const windowEnd = latest;
  const windowStart = new Date(latest);
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS);

  const { data: rows, error: rowsErr } = await client
    .from("consultations")
    .select("id, analyzed_at, analysis_result")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lte("analyzed_at", windowEnd.toISOString())
    .order("analyzed_at", { ascending: false });

  if (rowsErr) {
    throw new Error(`computeNudgeForDoctor: supabase fetch failed: ${rowsErr.message}`);
  }

  const consultations = rows ?? [];

  // Step 4: extract cautions from analysis_result
  const allCautions: string[] = [];
  for (const row of consultations) {
    const ar = row.analysis_result as Record<string, unknown> | null;
    if (!ar) continue;
    const raw = [
      ...(Array.isArray(ar["cautions"]) ? (ar["cautions"] as unknown[]) : []),
      ...(Array.isArray(ar["风险与提醒"]) ? (ar["风险与提醒"] as unknown[]) : []),
    ]
      .filter((t): t is string => typeof t === "string" && t.trim() !== "" && t.trim() !== BOILERPLATE)
      .map((t) => t.trim());
    allCautions.push(...raw);
  }

  // Step 5: deterministic bucketing (floor)
  const { surfaced } = bucketCautions(allCautions);

    if (surfaced.length === 0) {
    // Not enough recurring themes
    await client.from("doctor_risk_nudges").upsert(
      {
        doctor_id: doctorId,
        themes: [],
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        source_last_record_at: latest.toISOString(),
        case_count: consultations.length,
        caution_count: allCautions.length,
        model: null,
        prompt_version: resolvedVersion,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "doctor_id" },
    );
    return { status: "no-themes", themeCount: 0 };
  }

  // Step 6: build AI input — compact summary per surfaced bucket
  const aiUserLines = surfaced.map((b) => {
    const exStr = b.examples.map((e) => `  · ${e.slice(0, 40)}`).join("\n");
    return `${b.key}（${b.count}例）\n${exStr}`;
  });
  const aiUserContent = aiUserLines.join("\n");

  // Step 7: call AI for label rephrasing (graceful degradation)
  const model = getDeepSeekFastModel();
  let themes: NudgeTheme[];
  let usedModel: string | null = null;
  let aiUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  try {
    const aiResult = await callDeepSeekJson<{ themes: AiThemeOutput[] } | AiThemeOutput[]>({
      model,
      maxTokens: 4000,
      repairJson: true,
      retryOnEmpty: true,
      jsonMode: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: aiUserContent },
      ],
    });

    // Unwrap — AI may return array or object wrapping array
    let parsedItems: AiThemeOutput[];
    const raw = aiResult.data;
    if (Array.isArray(raw)) {
      parsedItems = raw as AiThemeOutput[];
    } else {
      const rawText = JSON.stringify(raw);
      parsedItems = parseAiOutput(rawText);
    }

    usedModel = model;
    aiUsage = aiResult.usage;
    themes = mergeWithAi(surfaced, parsedItems);
  } catch (err) {
    console.error("AI Nudge rephrasing failed:", err);
    // AI failed — use deterministic labels as-is (invariant: never empty on AI failure)
    themes = surfaced.map((b) => ({
      key: b.key,
      count: b.count,
      description: FALLBACK_DESCRIPTIONS[b.key] || "",
      examples: b.examples,
    }));
  }

  // Step 8: upsert the row
  await client.from("doctor_risk_nudges").upsert(
    {
      doctor_id: doctorId,
      themes: themes,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      source_last_record_at: latest.toISOString(),
      case_count: consultations.length,
      caution_count: allCautions.length,
      model: usedModel,
      prompt_version: resolvedVersion,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "doctor_id" },
  );

  // Step 9: Langfuse — tokens/cost/latency ONLY (invariant 8: no caution text)
  try {
    const lf = getLangfuse();
    if (lf && aiUsage) {
      const trace = lf.trace({ name: "dr_nudge", userId: doctorId });
      trace.generation({
        name: "dr_nudge-flash",
        model,
        usage: {
          input: aiUsage.prompt_tokens ?? 0,
          output: aiUsage.completion_tokens ?? 0,
        },
        metadata: {
          promptVersion: resolvedVersion,
          themeCount: themes.length,
          caseCount: consultations.length,
          latencyMs: Date.now() - t0,
        },
        // NEVER include input/output text — caution text must not leave to Langfuse (invariant 8)
      });
      await lf.flushAsync();
    }
  } catch {
    // Langfuse failure must never break the compute
  }

  return { status: "computed", themeCount: themes.length };
}

// ─── Fleet-wide runner ────────────────────────────────────────────────────────

/**
 * Compute nudges for all active allowlisted doctors.
 * Skips doctors with no analyzed cases or unchanged watermark.
 */
export async function computeNudgesForActiveDoctors(
  client: SupabaseClient,
): Promise<{ computed: string[]; skipped: string[] }> {
  // Fetch active allowlisted doctors
  const { data: allowlist, error: allowErr } = await client
    .from("doctor_allowlist")
    .select("email")
    .eq("is_active", true);

  if (allowErr || !allowlist?.length) {
    return { computed: [], skipped: [] };
  }

  // Resolve to UUIDs via auth.users
  const computed: string[] = [];
  const skipped: string[] = [];

  console.log(`[dr_nudge] Starting fleet-wide computation for ${allowlist.length} active doctors...`);

  for (const { email } of allowlist) {
    console.log(`\n[dr_nudge] Processing doctor: ${email}`);
    try {
      // Resolve UUID by email
      const { data: usersData, error: userErr } = await client.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (userErr) {
        console.error(`  ❌ Failed to list users to resolve ID: ${userErr.message}`);
        skipped.push(email);
        continue;
      }

      const user = usersData.users.find(
        (u) => u.email?.toLowerCase().trim() === email.toLowerCase().trim(),
      );
      if (!user) {
        console.warn(`  ⚠️ No registered user found in auth.users matching email.`);
        skipped.push(email);
        continue;
      }

      console.log(`  Resolved UUID: ${user.id}`);

      const latest = await getLatestAnalyzedAt(client, user.id);
      if (!latest) {
        console.log(`  → Skipped: No analyzed consultations found.`);
        skipped.push(email);
        continue;
      }

      console.log(`  Latest analyzed case at: ${latest.toISOString()}`);

      const result = await computeNudgeForDoctor(client, user.id);
      console.log(`  → Result status: ${result.status}`);
      
      if (result.status === "skipped") {
        console.log(`  → Skipped: Watermark unchanged.`);
        skipped.push(email);
      } else {
        console.log(`  ✓ Successfully computed: ${result.themeCount ?? 0} themes generated.`);
        computed.push(email);
      }
    } catch (err) {
      console.error(`  ❌ Error processing ${email}:`, err instanceof Error ? err.message : String(err));
      skipped.push(email);
    }
  }

  console.log(`\n[dr_nudge] Fleet-wide computation completed.`);
  console.log(`  - Computed: ${computed.length} doctors (${computed.join(", ") || "none"})`);
  console.log(`  - Skipped:  ${skipped.length} doctors (${skipped.join(", ") || "none"})`);

  return { computed, skipped };
}
