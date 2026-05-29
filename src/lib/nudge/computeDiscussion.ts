/**
 * Core computation logic for the senior-reviewer discussion agenda (pre-computed weekly).
 * Two stages:
 *   1. Aggregation of 14-day diagnosis × pattern × modality counts (N >= 2)
 *   2. DeepSeek Flash generation of constructive discussion cards
 *
 * Robustness guarantee: if AI fails for any reason, deterministic case-group prompts
 * are generated as fallback discussion cards.
 *
 * Invariant 8: aggregated case metrics sent to DeepSeek (permitted).
 *              Langfuse receives tokens/cost/latency ONLY — never clinical text or questions.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { getLangfuse } from "@/lib/langfuse";
import { DISCUSSION_PROMPT_VERSION, DISCUSSION_SYSTEM_PROMPT } from "./discussionPrompts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiscussionItem = {
  question: string;
  caseAnchor: string | null;
  caseGroup: string | null;
  reasoning: string;
  followUp: string | null;
  n: number;
};

export type DiscussionComputeStatus =
  | "computed"
  | "no-cases"
  | "no-themes"
  | "skipped";

export type DiscussionComputeResult = {
  status: DiscussionComputeStatus;
  itemCount: number;
};

type AiDiscussionItem = {
  question: string;
  caseAnchor: string;
  caseGroup: string;
  reasoning: string;
  followUp: string;
  n: number;
};

type CaseGroup = {
  diagnosis: string;
  pattern: string;
  modality: string;
  n: number;
  complaints: string[];
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
 *   - stored prompt_version !== DISCUSSION_PROMPT_VERSION, OR
 *   - latest analyzed_at > stored source_last_record_at (new cases since last computed)
 *   - force=true bypasses watermark check
 */
export async function needsDiscussionRecompute(
  client: SupabaseClient,
  doctorId: string,
  latest: Date,
  force = false,
): Promise<boolean> {
  if (force) return true;

  const { data, error } = await client
    .from("doctor_discussion_agenda")
    .select("source_last_record_at, prompt_version")
    .eq("doctor_id", doctorId)
    .maybeSingle();

  if (error || !data) return true;
  if (data.prompt_version !== DISCUSSION_PROMPT_VERSION) return true;
  if (!data.source_last_record_at) return true;

  const stored = new Date(data.source_last_record_at as string);
  return latest > stored;
}

/** Parse the AI JSON object output; returns [] on any failure. */
export function parseAiOutput(text: string): AiDiscussionItem[] {
  try {
    const raw = JSON.parse(text);
    const arr = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.items)
      ? raw.items
      : [];

    return arr
      .filter((item: any): item is Record<string, any> =>
        typeof item === "object" && item !== null && typeof item.question === "string",
      )
      .map((item: any) => ({
        question: String(item.question).trim(),
        caseAnchor: typeof item.caseAnchor === "string" ? String(item.caseAnchor).trim() : "",
        caseGroup: typeof item.caseGroup === "string" ? String(item.caseGroup).trim() : "",
        reasoning: typeof item.reasoning === "string" ? String(item.reasoning).trim() : "",
        followUp: typeof item.followUp === "string" ? String(item.followUp).trim() : null,
        n: typeof item.n === "number" ? item.n : 0,
      }));
  } catch {
    return [];
  }
}

/** Build deterministic discussion items directly from case groups (graceful fallback). */
export function buildFallbackItems(
  caseGroups: CaseGroup[],
): DiscussionItem[] {
  return caseGroups
    .map((group) => ({
      question: `最近反复出现的“${group.diagnosis} / ${group.pattern} / ${group.modality}”病例，是否还可以再总结一条更稳定的辨证抓手？`,
      caseAnchor: `${group.diagnosis} ${group.n} 例`,
      caseGroup: `${group.diagnosis}×${group.pattern}×${group.modality}`,
      reasoning: `近14天内这一组病例重复出现 ${group.n} 次，适合优先做一次集中复盘。`,
      followUp: group.complaints?.[0]
        ? `可先从“${group.complaints[0]}”这类主诉切入，回看辨证与处置是否足够一致。`
        : "可先回看同组病例的主诉、辨证与处置是否保持一致。",
      n: group.n,
    }))
    .slice(0, 4);
}

// ─── Main compute function ────────────────────────────────────────────────────

/**
 * Compute and upsert the discussion agenda row for a single doctor.
 * Graceful degradation: AI failure → fall back to deterministic case-group prompts.
 */
export async function computeDiscussionForDoctor(
  client: SupabaseClient,
  doctorId: string,
  options: { force?: boolean } = {},
): Promise<DiscussionComputeResult> {
  const t0 = Date.now();

  // Step 1: get latest analyzed_at
  const latest = await getLatestAnalyzedAt(client, doctorId);
  if (!latest) {
    // No analyzed cases at all — upsert empty record
    await client.from("doctor_discussion_agenda").upsert(
      {
        doctor_id: doctorId,
        items: [],
        window_start: null,
        window_end: null,
        source_last_record_at: null,
        case_count: 0,
        model: null,
        prompt_version: DISCUSSION_PROMPT_VERSION,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "doctor_id" },
    );
    return { status: "no-cases", itemCount: 0 };
  }

  // Step 2: watermark and version check
  const shouldRecompute = await needsDiscussionRecompute(client, doctorId, latest, options.force);
  if (!shouldRecompute) {
    return { status: "skipped", itemCount: 0 };
  }

  // Step 3: fetch consultations in the 14-day window ending at latest
  const windowEnd = latest;
  const windowStart = new Date(latest);
  windowStart.setDate(windowStart.getDate() - 14);

  const { data: rows, error: rowsErr } = await client
    .from("consultations")
    .select("form_data, analyzed_at")
    .eq("doctor_id", doctorId)
    .not("analyzed_at", "is", null)
    .gte("analyzed_at", windowStart.toISOString())
    .lte("analyzed_at", windowEnd.toISOString())
    .order("analyzed_at", { ascending: false });

  if (rowsErr) {
    throw new Error(`computeDiscussionForDoctor: supabase consultations fetch failed: ${rowsErr.message}`);
  }

  const consultations = rows ?? [];

  // Step 4: aggregate diagnosis × pattern × modality counts (N >= 2)
  const groups = new Map<string, CaseGroup>();
  for (const c of consultations) {
    const fd = c.form_data as Record<string, any> | null;
    if (!fd) continue;

    const d = String(fd.diagnosis || "").trim();
    const p = String(fd.pattern || "").trim();
    const m = String(fd.prescriptionType || fd.prescription_type || "方药").trim();

    // Noise exclusion regex (same as senior_discussion_experiment.mjs)
    if (d.match(/\$|GST|receipt|membership/i) || p.match(/\$|GST|receipt|Corbett/i)) {
      continue;
    }

    if (!d || !p) continue;

    const key = `${d}|||${p}|||${m}`;
    if (!groups.has(key)) {
      groups.set(key, {
        diagnosis: d,
        pattern: p,
        modality: m,
        n: 0,
        complaints: [],
      });
    }
    const g = groups.get(key)!;
    g.n++;
    if (g.complaints.length < 2 && fd.chiefComplaint) {
      g.complaints.push(String(fd.chiefComplaint));
    }
  }

  const sortedGroups = [...groups.values()]
    .filter((g) => g.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 20);

  // Step 5: check if we have any case groups to discuss
  if (sortedGroups.length === 0) {
    const fallbackItems: DiscussionItem[] = [];
    await client.from("doctor_discussion_agenda").upsert(
      {
        doctor_id: doctorId,
        items: fallbackItems,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        source_last_record_at: latest.toISOString(),
        case_count: consultations.length,
        model: null,
        prompt_version: DISCUSSION_PROMPT_VERSION,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "doctor_id" },
    );
    return { status: fallbackItems.length > 0 ? "computed" : "no-themes", itemCount: fallbackItems.length };
  }

  // Step 6: build AI input
  const groupLines = sortedGroups.map(
    (g) => `${g.diagnosis} × ${g.pattern} × ${g.modality}: ${g.n}例`,
  );

  const aiInput = [
    `=== 14天病案聚合（共 ${consultations.length} 例记录） ===`,
    groupLines.join("\n"),
  ].join("\n");

  // Step 7: call AI for discussion agenda generation (graceful fallback)
  const model = getDeepSeekFastModel();
  let items: DiscussionItem[];
  let usedModel: string | null = null;
  let aiUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  try {
    const aiResult = await callDeepSeekJson<{ items: AiDiscussionItem[] }>({
      model,
      maxTokens: 3000,
      repairJson: true,
      retryOnEmpty: true,
      jsonMode: true,
      messages: [
        { role: "system", content: DISCUSSION_SYSTEM_PROMPT },
        { role: "user", content: aiInput },
      ],
    });

    const parsedItems = parseAiOutput(JSON.stringify(aiResult.data));
    usedModel = model;
    aiUsage = aiResult.usage;

    items = parsedItems.map((item) => ({
      question: item.question,
      caseAnchor: item.caseAnchor || null,
      caseGroup: item.caseGroup || null,
      reasoning: item.reasoning,
      followUp: item.followUp || null,
      n: item.n,
    })).slice(0, 4);

    // If AI successfully parsed 0 items, fall back to reshaping
    if (items.length === 0) {
      items = buildFallbackItems(sortedGroups);
    }
  } catch (err) {
    console.error("AI Discussion generation failed:", err);
    items = buildFallbackItems(sortedGroups);
  }

  // Step 8: upsert into DB
  const { error: upsertError } = await client.from("doctor_discussion_agenda").upsert(
    {
      doctor_id: doctorId,
      items: items,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      source_last_record_at: latest.toISOString(),
      case_count: consultations.length,
      model: usedModel,
      prompt_version: DISCUSSION_PROMPT_VERSION,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "doctor_id" },
  );

  if (upsertError) {
    throw new Error(`computeDiscussionForDoctor: supabase upsert failed: ${upsertError.message}`);
  }

  // Step 9: Langfuse — tokens/cost/latency ONLY (invariant 8: no clinical/agenda text)
  try {
    const lf = getLangfuse();
    if (lf && aiUsage) {
      const trace = lf.trace({ name: "dr_discussion", userId: doctorId });
      trace.generation({
        name: "dr_discussion-flash",
        model,
        usage: {
          input: aiUsage.prompt_tokens ?? 0,
          output: aiUsage.completion_tokens ?? 0,
        },
        metadata: {
          promptVersion: DISCUSSION_PROMPT_VERSION,
          itemCount: items.length,
          caseCount: consultations.length,
          latencyMs: Date.now() - t0,
        },
      });
      await lf.flushAsync();
    }
  } catch {
    // Langfuse failure ignored
  }

  return { status: "computed", itemCount: items.length };
}

// ─── Fleet-wide runner ────────────────────────────────────────────────────────

/**
 * Compute discussion agendas for all active allowlisted doctors.
 * Skips doctors with no cases or unchanged watermark.
 */
export async function computeDiscussionsForActiveDoctors(
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

  const computed: string[] = [];
  const skipped: string[] = [];

  console.log(`[dr_discussion] Starting fleet-wide computation for ${allowlist.length} active doctors...`);

  for (const { email } of allowlist) {
    console.log(`\n[dr_discussion] Processing doctor: ${email}`);
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

      const result = await computeDiscussionForDoctor(client, user.id);
      console.log(`  → Result status: ${result.status}`);

      if (result.status === "skipped") {
        console.log(`  → Skipped: Watermark unchanged.`);
        skipped.push(email);
      } else {
        console.log(`  ✓ Successfully computed: ${result.itemCount ?? 0} items generated.`);
        computed.push(email);
      }
    } catch (err) {
      console.error(`  ❌ Error processing ${email}:`, err instanceof Error ? err.message : String(err));
      skipped.push(email);
    }
  }

  console.log(`\n[dr_discussion] Fleet-wide computation completed.`);
  console.log(`  - Computed: ${computed.length} doctors (${computed.join(", ") || "none"})`);
  console.log(`  - Skipped:  ${skipped.length} doctors (${skipped.join(", ") || "none"})`);

  return { computed, skipped };
}
