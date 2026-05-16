import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { buildAnalysisResult, type AnalysisJson } from "@/lib/ai/analysisResult";
import { TCM_ANALYSIS_SYSTEM_PROMPT, buildTcmAnalysisUserPrompt } from "@/lib/ai/prompts";
import { runAssessmentSynthesis, type SampleResultForReview } from "@/lib/ai/assessmentReview";
import type { StructuredCaseForm } from "@/lib/forms/caseSchema";

// Vercel Pro: allow up to 5 minutes for the full job
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Supabase helpers (service-role, no RLS)
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

async function dbGet<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const config = getSupabaseConfig();
  if (!config) return [];
  const url = new URL(`${config.url}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: config.headers, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as T[];
}

async function dbPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const config = getSupabaseConfig();
  if (!config) return null;
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...config.headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function dbPatch(path: string, filter: string, body: Record<string, unknown>): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) return;
  const url = new URL(`${config.url}/rest/v1/${path}`);
  url.searchParams.set("id", filter);
  await fetch(url, {
    method: "PATCH",
    headers: { ...config.headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET — list jobs
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  type JobRow = { id: string; triggered_by: string; status: string; sample_count: number | null; created_at: string; completed_at: string | null; synthesis: unknown };
  const jobs = await dbGet<JobRow>("assessment_jobs", {
    select: "id,triggered_by,status,sample_count,created_at,completed_at,synthesis",
    order: "created_at.desc",
  });

  return NextResponse.json({ jobs });
}

// ---------------------------------------------------------------------------
// POST — trigger a new assessment job
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  // 1. Load active samples
  type SampleRow = { id: string; label: string; form_data: StructuredCaseForm };
  const samples = await dbGet<SampleRow>("assessment_samples", {
    select: "id,label,form_data",
    is_active: "eq.true",
    order: "sort_order.asc",
  });

  if (samples.length === 0) {
    return apiError(400, "INVALID_INPUT", "没有启用的样本。请先运行 013_assessment_samples.sql。");
  }

  // 2. Create job row
  const jobRow = await dbPost("assessment_jobs", {
    triggered_by: user.email ?? "admin",
    status: "running",
    sample_count: samples.length,
  });
  const jobId = jobRow?.id as string | undefined;
  if (!jobId) return apiError(500, "INTERNAL_ERROR", "创建任务记录失败。");

  // 3. Run all analyses in parallel
  const analysisResults = await Promise.all(
    samples.map(async (sample, i): Promise<SampleResultForReview> => {
      const startMs = Date.now();
      try {
        const result = await callDeepSeekJson<AnalysisJson>({
          messages: [
            { role: "system", content: TCM_ANALYSIS_SYSTEM_PROMPT },
            { role: "user", content: buildTcmAnalysisUserPrompt(sample.form_data) },
          ],
          model: getDeepSeekFastModel(),
          maxTokens: 2000,
          repairJson: true,
        });

        const analysis = buildAnalysisResult(
          result.data,
          Array.isArray(sample.form_data.prescriptionType)
            ? sample.form_data.prescriptionType
            : [sample.form_data.prescriptionType],
        );
        const durationMs = Date.now() - startMs;

        // Save result row
        await dbPost("assessment_job_results", {
          job_id: jobId,
          sample_id: sample.id,
          form_data: sample.form_data,
          analysis,
          analysis_raw: result.data,
          duration_ms: durationMs,
        });

        return {
          index: i + 1,
          form: sample.form_data,
          analysis,
          error: null,
          durationMs,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startMs;

        await dbPost("assessment_job_results", {
          job_id: jobId,
          sample_id: sample.id,
          form_data: sample.form_data,
          analysis: null,
          error,
          duration_ms: durationMs,
        });

        return {
          index: i + 1,
          form: sample.form_data,
          analysis: null,
          error,
          durationMs,
        };
      }
    }),
  );

  // 4. Run synthesis over all results
  let synthesis = null;
  let reviewModel = null;
  let errorSummary = null;

  try {
    const { synthesis: syn, model } = await runAssessmentSynthesis(analysisResults);
    synthesis = syn;
    reviewModel = model;
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : "综合审核失败";
  }

  // 5. Update job to done
  await dbPatch("assessment_jobs", `eq.${jobId}`, {
    status: synthesis ? "done" : "done_no_synthesis",
    completed_at: new Date().toISOString(),
    synthesis,
    review_model: reviewModel,
    error_summary: errorSummary,
  });

  return NextResponse.json({ jobId, sampleCount: samples.length });
}
