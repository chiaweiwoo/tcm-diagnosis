import { getServiceRoleClient } from "@/lib/supabase/server";
import RunAnalyticsButton from "./RunAnalyticsButton";
import type { PromptQualityStats } from "@/lib/analytics/stats";

type QualityRun = {
  id: string;
  window_start: string;
  window_end: string;
  stats: PromptQualityStats;
  narrative: string | null;
  created_at: string;
};

async function listRuns(): Promise<QualityRun[]> {
  const admin = getServiceRoleClient();
  const { data } = await admin
    .from("analytics_prompt_quality_runs")
    .select("id,window_start,window_end,stats,narrative,created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as QualityRun[];
}

function formatSGT(iso: string) {
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(n: number) {
  return `${(n * 100).toFixed(0)}%`;
}

export default async function AnalyticsPage() {
  const runs = await listRuns();
  const latest = runs[0] ?? null;

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>提示质量分析</h1>
          <p className="admin-meta">全局统计 · 覆盖所有医生近7天的已分析病案</p>
        </div>
        <RunAnalyticsButton />
      </div>

      {/* Latest run stats */}
      {latest && (
        <div className="admin-section">
          <h2>最新一次统计（{formatSGT(latest.created_at)}）</h2>
          <div className="analytics-window-label">
            窗口：{latest.window_start.slice(0, 10)} — {latest.window_end.slice(0, 10)}
          </div>

          <div className="admin-stats-grid" style={{ marginTop: 12 }}>
            <div className="admin-stat-card">
              <span className="stat-label">病案数</span>
              <span className="stat-value">{latest.stats.consultationCount}</span>
            </div>
            <div className="admin-stat-card">
              <span className="stat-label">JSON修复率</span>
              <span className="stat-value">{pct(latest.stats.repairedJsonRate)}</span>
            </div>
            <div className="admin-stat-card">
              <span className="stat-label">风险提醒率</span>
              <span className="stat-value">{pct(latest.stats.riskFlagRate)}</span>
            </div>
            {latest.stats.avgDurationSeconds !== null && (
              <div className="admin-stat-card">
                <span className="stat-label">平均耗时</span>
                <span className="stat-value">{latest.stats.avgDurationSeconds}s</span>
              </div>
            )}
          </div>

          {/* Section coverage */}
          <div className="analytics-coverage-grid">
            {(
              [
                ["重点结论", latest.stats.sectionCoverage.keyPoints],
                ["风险提醒", latest.stats.sectionCoverage.cautions],
                ["证据状态", latest.stats.sectionCoverage.evidence],
                ["判断列", latest.stats.sectionCoverage.column0],
                ["方案列", latest.stats.sectionCoverage.column1],
                ["随访列", latest.stats.sectionCoverage.column2],
              ] as [string, number][]
            ).map(([label, rate]) => (
              <div key={label} className="coverage-row">
                <span className="coverage-label">{label}</span>
                <div className="coverage-bar-wrap">
                  <div className="coverage-bar" style={{ width: `${Math.round(rate * 100)}%` }} />
                </div>
                <span className="coverage-pct">{pct(rate)}</span>
              </div>
            ))}
          </div>

          {/* Prescription type dist */}
          {Object.keys(latest.stats.prescriptionTypeDist).length > 0 && (
            <div className="analytics-dist">
              <span className="analytics-dist-label">处方类型分布：</span>
              {Object.entries(latest.stats.prescriptionTypeDist).map(([pt, n]) => (
                <span key={pt} className="analytics-dist-chip">
                  {pt} {n}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Run history */}
      <div className="admin-section">
        <h2>历史记录</h2>
        {runs.length === 0 ? (
          <div className="admin-empty">
            <p>暂无统计记录。点击"运行统计"开始第一次统计。</p>
          </div>
        ) : (
          <div className="job-list">
            {runs.map((run) => (
              <div key={run.id} className="job-row">
                <div className="job-row__meta">
                  <span>窗口 {run.window_start.slice(0, 10)} — {run.window_end.slice(0, 10)}</span>
                  <span>{run.stats.consultationCount} 条病案</span>
                  <span>JSON修复 {pct(run.stats.repairedJsonRate)}</span>
                  <span>风险提醒 {pct(run.stats.riskFlagRate)}</span>
                </div>
                <span className="admin-meta">{formatSGT(run.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
