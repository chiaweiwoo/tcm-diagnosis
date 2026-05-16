import Link from "next/link";
import RunButton from "./RunButton";

type JobRow = {
  id: string;
  triggered_by: string;
  status: string;
  sample_count: number | null;
  created_at: string;
  completed_at: string | null;
  synthesis: { verdict?: string } | null;
};

async function listJobs(): Promise<JobRow[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const url = new URL(`${supabaseUrl}/rest/v1/assessment_jobs`);
  url.searchParams.set("select", "id,triggered_by,status,sample_count,created_at,completed_at,synthesis");
  url.searchParams.set("order", "created_at.desc");

  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return (await res.json()) as JobRow[];
}

const STATUS_LABELS: Record<string, string> = {
  running:              "运行中",
  done:                 "完成",
  done_no_synthesis:    "完成（无综合审核）",
  failed:               "失败",
};

const VERDICT_CLASSES: Record<string, string> = {
  stable:          "verdict-badge--stable",
  needs_attention: "verdict-badge--attention",
  critical:        "verdict-badge--critical",
};

const VERDICT_LABELS: Record<string, string> = {
  stable:          "提示稳定",
  needs_attention: "有待改进",
  critical:        "需立即处理",
};

function formatSGT(iso: string) {
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function AssessmentsPage() {
  const jobs = await listJobs();

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>评估任务</h1>
          <p className="admin-meta">对所有样本运行分析，综合审核提示质量与幻觉风险</p>
        </div>
        <RunButton />
      </div>

      {jobs.length === 0 ? (
        <div className="admin-empty">
          <p>暂无评估记录。点击"运行新评估"开始第一次评估。</p>
        </div>
      ) : (
        <div className="job-list">
          {jobs.map((job) => {
            const verdict = job.synthesis?.verdict;
            return (
              <div key={job.id} className="job-row">
                <div className="job-row__left">
                  <span className={`status-pill ${job.status}`}>
                    {STATUS_LABELS[job.status] ?? job.status}
                  </span>
                  {verdict && (
                    <span className={`verdict-badge ${VERDICT_CLASSES[verdict] ?? ""}`}>
                      {VERDICT_LABELS[verdict] ?? verdict}
                    </span>
                  )}
                </div>
                <div className="job-row__meta">
                  <span>{job.sample_count ?? "—"} 个样本</span>
                  <span>{formatSGT(job.created_at)}</span>
                </div>
                {job.status !== "running" && (
                  <Link href={`/admin/assessments/${job.id}`} className="secondary-button compact-button">
                    查看报告 →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
