import Link from "next/link";
import { listAssessmentRuns } from "@/lib/assessmentRuns";

export default async function AssessmentsPage() {
  const runs = await listAssessmentRuns();

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>评估记录</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin/examples" className="secondary-button compact-button">样本库</Link>
          <Link href="/admin/usage" className="secondary-button compact-button">Token 用量</Link>
          <Link href="/" className="secondary-button compact-button">← 返回工作台</Link>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="admin-empty">
          <p>暂无评估记录。运行 <code>npm run assess:run</code> 后记录将自动存入。</p>
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>运行 ID</th>
              <th>时间</th>
              <th>模式</th>
              <th>样本数</th>
              <th>整理成功率</th>
              <th>分析成功率</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const org = run.organize_stats;
              const orgRate = org && org.total > 0 ? `${org.success}/${org.total}` : "—";

              // For single-mode runs use run.mode; for old dual-mode runs aggregate both
              const modeKey = run.mode ?? null;
              const modeStats = modeKey
                ? run.mode_stats?.[modeKey]
                : Object.values(run.mode_stats ?? {}).reduce<{ success: number; count: number } | null>(
                    (acc, s) => acc
                      ? { success: acc.success + s.success, count: acc.count + s.count }
                      : { success: s.success, count: s.count },
                    null,
                  );
              const analyzeRate = modeStats && modeStats.count > 0
                ? `${modeStats.success}/${modeStats.count}`
                : "—";

              return (
                <tr key={run.run_id}>
                  <td className="run-id-cell"><code>{run.run_id}</code></td>
                  <td>{new Date(run.created_at).toLocaleString("zh-SG")}</td>
                  <td>
                    {modeKey
                      ? <span className="mode-tag">{modeKey === "normal" ? "常规" : "智能"}</span>
                      : <span className="mode-tag muted">—</span>}
                  </td>
                  <td>{run.example_count ?? "—"}</td>
                  <td>{orgRate}</td>
                  <td>{analyzeRate}</td>
                  <td>
                    <span className={`status-pill ${run.status}`}>{run.status}</span>
                  </td>
                  <td>
                    <Link href={`/admin/assessments/${run.run_id}`} className="secondary-button compact-button">
                      查看
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
