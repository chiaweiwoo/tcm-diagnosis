import { notFound } from "next/navigation";
import type { AssessmentSynthesis } from "@/lib/ai/assessmentReview";
import type { AnalysisResult } from "@/lib/ai/analysisResult";
import type { StructuredCaseForm } from "@/lib/forms/caseSchema";

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

type JobDetail = {
  id: string;
  status: string;
  sample_count: number | null;
  triggered_by: string;
  created_at: string;
  completed_at: string | null;
  synthesis: AssessmentSynthesis | null;
  review_model: string | null;
  error_summary: string | null;
};

type ResultRow = {
  id: string;
  sample_id: string;
  form_data: StructuredCaseForm;
  analysis: AnalysisResult | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};

async function getJob(jobId: string): Promise<JobDetail | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/assessment_jobs`);
  url.searchParams.set("id", `eq.${jobId}`);
  url.searchParams.set("select", "id,status,sample_count,triggered_by,created_at,completed_at,synthesis,review_model,error_summary");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as JobDetail[];
  return rows[0] ?? null;
}

async function getResults(jobId: string): Promise<ResultRow[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const url = new URL(`${supabaseUrl}/rest/v1/assessment_job_results`);
  url.searchParams.set("job_id", `eq.${jobId}`);
  url.searchParams.set("select", "id,sample_id,form_data,analysis,error,duration_ms,created_at");
  url.searchParams.set("order", "created_at.asc");

  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return (await res.json()) as ResultRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERDICT_META: Record<string, { label: string; cls: string }> = {
  stable:          { label: "提示稳定",    cls: "verdict-badge--stable" },
  needs_attention: { label: "有待改进",    cls: "verdict-badge--attention" },
  critical:        { label: "需立即处理",  cls: "verdict-badge--critical" },
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  hallucination:   "🔴 幻觉风险",
  guardrail:       "🔴 护栏违规",
  off_structure:   "🟠 结构失控",
  tone_drift:      "🟡 角色漂移",
  generic_content: "🟡 内容泛化",
  evidence_blur:   "🟡 证据模糊",
  edge_case_miss:  "🔵 边缘案例",
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  urgent: { label: "紧急",   cls: "priority--urgent" },
  medium: { label: "中优先", cls: "priority--medium" },
  low:    { label: "低优先", cls: "priority--low" },
};

function formatSGT(iso: string) {
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SynthesisReport({ s }: { s: AssessmentSynthesis }) {
  const vm = VERDICT_META[s.verdict] ?? { label: s.verdict, cls: "" };
  const sortedIssues = [...(s.issues ?? [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
  const sortedRecs = [...(s.prompt_recommendations ?? [])].sort(
    (a, b) => (PRIORITY_META[a.priority] ? 0 : 1) - (PRIORITY_META[b.priority] ? 0 : 1),
  );

  return (
    <div className="synthesis-report">
      {/* Verdict + summary */}
      <div className="synthesis-verdict-row">
        <span className={`verdict-badge verdict-badge--lg ${vm.cls}`}>{vm.label}</span>
      </div>
      <p className="synthesis-summary">{s.executive_summary}</p>

      {/* Strengths */}
      {s.strengths?.length > 0 && (
        <section className="synthesis-section">
          <h2 className="synthesis-section__title synthesis-section__title--green">✓ 做得好的地方</h2>
          <ul className="synthesis-bullets synthesis-bullets--green">
            {s.strengths.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      )}

      {/* Issues */}
      {sortedIssues.length > 0 && (
        <section className="synthesis-section">
          <h2 className="synthesis-section__title">⚠ 发现的问题</h2>
          <div className="issue-list">
            {sortedIssues.map((issue, i) => (
              <div key={i} className={`issue-card issue-card--${issue.severity}`}>
                <div className="issue-card__header">
                  <span className="issue-type">{ISSUE_TYPE_LABELS[issue.type] ?? issue.type}</span>
                  <span className={`issue-severity issue-severity--${issue.severity}`}>
                    {issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}
                  </span>
                </div>
                <p className="issue-description">{issue.description}</p>
                {issue.samples?.length > 0 && (
                  <div className="issue-samples">
                    {issue.samples.map((s, j) => <span key={j} className="issue-sample-ref">{s}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recommendations */}
      {sortedRecs.length > 0 && (
        <section className="synthesis-section">
          <h2 className="synthesis-section__title">→ 提示改进建议</h2>
          <div className="rec-list">
            {sortedRecs.map((rec, i) => {
              const pm = PRIORITY_META[rec.priority] ?? { label: rec.priority, cls: "" };
              return (
                <div key={i} className="rec-card">
                  <div className="rec-card__header">
                    <span className={`priority-badge ${pm.cls}`}>{pm.label}</span>
                    <span className="rec-target">{rec.target}</span>
                  </div>
                  <p className="rec-suggestion">{rec.suggestion}</p>
                  <p className="rec-rationale">{rec.rationale}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Doctor questions */}
      {s.doctor_questions?.length > 0 && (
        <section className="synthesis-section">
          <h2 className="synthesis-section__title synthesis-section__title--blue">? 需要请教医生的问题</h2>
          <ul className="synthesis-bullets synthesis-bullets--blue">
            {s.doctor_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function PerSampleResults({ results }: { results: ResultRow[] }) {
  return (
    <details className="sample-results-details">
      <summary className="sample-results-summary">
        查看各样本详情（{results.length} 条）
      </summary>
      <div className="sample-results-body">
        {results.map((r, i) => {
          const types = Array.isArray(r.form_data?.prescriptionType)
            ? r.form_data.prescriptionType.join("+")
            : r.form_data?.prescriptionType ?? "—";
          const label = `#${i + 1} ${r.form_data?.patientSex ?? ""}/${r.form_data?.patientAge ?? ""}岁 · ${r.form_data?.chiefComplaint ?? ""}`;

          return (
            <details key={r.id} className="per-sample-card">
              <summary className="per-sample-summary">
                <span className="per-sample-label">{label}</span>
                <span className="per-sample-meta">{types}</span>
                {r.error
                  ? <span className="per-sample-status per-sample-status--error">失败</span>
                  : <span className="per-sample-status per-sample-status--ok">
                      {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "完成"}
                    </span>
                }
              </summary>
              {r.error ? (
                <p className="per-sample-error">{r.error}</p>
              ) : r.analysis ? (
                <div className="per-sample-analysis">
                  {r.analysis.keyPoints?.length > 0 && (
                    <div className="per-sample-field">
                      <span className="per-sample-field__label">重点结论</span>
                      <ul>{r.analysis.keyPoints.map((p, j) => <li key={j}>{p}</li>)}</ul>
                    </div>
                  )}
                  {r.analysis.groups?.map((group) =>
                    group.sections.map((sec) =>
                      sec.items.length > 0 ? (
                        <div key={`${group.title}-${sec.title}`} className="per-sample-field">
                          <span className="per-sample-field__label">{group.title}·{sec.title}</span>
                          <ul>{sec.items.map((item, j) => <li key={j}>{item}</li>)}</ul>
                        </div>
                      ) : null,
                    ),
                  )}
                  {r.analysis.cautions?.length > 0 && (
                    <div className="per-sample-field">
                      <span className="per-sample-field__label">风险与提醒</span>
                      <ul>{r.analysis.cautions.map((c, j) => <li key={j}>{c}</li>)}</ul>
                    </div>
                  )}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AssessmentJobPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const [job, results] = await Promise.all([getJob(runId), getResults(runId)]);

  if (!job) notFound();

  const successCount = results.filter((r) => !r.error).length;

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">评估任务</p>
          <h1>质量审核报告</h1>
          <p className="admin-meta">
            {formatSGT(job.created_at)}
            {" · "}{successCount}/{job.sample_count ?? results.length} 成功
            {job.review_model && <> · 综合审核：{job.review_model.replace("deepseek-", "DeepSeek ")}</>}
          </p>
        </div>
      </div>

      {job.error_summary && !job.synthesis && (
        <div className="admin-empty" style={{ marginBottom: 24 }}>
          <p>综合审核失败：{job.error_summary}</p>
        </div>
      )}

      {job.synthesis ? (
        <SynthesisReport s={job.synthesis} />
      ) : job.status === "running" ? (
        <div className="admin-empty"><p>任务运行中，请稍后刷新。</p></div>
      ) : null}

      {results.length > 0 && <PerSampleResults results={results} />}
    </main>
  );
}
