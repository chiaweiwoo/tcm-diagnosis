import Link from "next/link";
import { listApiCallLogs, computeUsageSummary } from "@/lib/usageLogs";

function fmtCost(usd: number) {
  return usd < 0.0001 ? "<$0.0001" : `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number | null) {
  if (n === null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtLatency(ms: number | null) {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtRate(rate: number | null) {
  if (rate === null) return "—";
  return `$${rate}`;
}

export default async function AdminUsagePage() {
  const rows = await listApiCallLogs(200);
  const summary = computeUsageSummary(rows);

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">AI 调用监控</p>
          <h1>Token 用量</h1>
          <p className="admin-meta">最近 {rows.length} 条记录</p>
        </div>
        <Link href="/admin/assessments" className="secondary-button compact-button">← 评估列表</Link>
      </div>

      <section className="admin-section">
        <h2>汇总</h2>
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <span className="stat-label">总调用次数</span>
            <span className="stat-value">{summary.totalCalls}</span>
            <span className="stat-sub">成功 {summary.successCalls}</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">总费用</span>
            <span className="stat-value">{fmtCost(summary.totalCostUsd)}</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">输入 Token</span>
            <span className="stat-value">{fmtTokens(summary.totalInputTokens)}</span>
            <span className="stat-sub">命中缓存 {fmtTokens(summary.totalCacheHitTokens)}</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">输出 Token</span>
            <span className="stat-value">{fmtTokens(summary.totalOutputTokens)}</span>
          </div>
        </div>
      </section>

      <section className="admin-section">
        <h2>调用明细</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>名称</th>
                <th>模型</th>
                <th>状态</th>
                <th>延迟</th>
                <th>输入</th>
                <th>缓存命中</th>
                <th>缓存未命中</th>
                <th>输出</th>
                <th>缓存命中价/1M</th>
                <th>输入价/1M</th>
                <th>输出价/1M</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(row.created_at).toLocaleString("zh-SG", { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td>
                    <code>{row.call_name ?? row.route}</code>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: "0.75rem" }}>{row.model ?? "—"}</span>
                  </td>
                  <td>
                    <span className={`status-pill ${row.success ? "status-active" : "status-inactive"}`}>
                      {row.success ? "成功" : "失败"}
                    </span>
                  </td>
                  <td>{fmtLatency(row.latency_ms)}</td>
                  <td>{fmtTokens(row.prompt_tokens)}</td>
                  <td>{fmtTokens(row.input_cache_hit_tokens)}</td>
                  <td>{fmtTokens(row.input_cache_miss_tokens)}</td>
                  <td>{fmtTokens(row.completion_tokens)}</td>
                  <td>{fmtRate(row.cache_hit_rate_per_1m)}</td>
                  <td>{fmtRate(row.input_rate_per_1m)}</td>
                  <td>{fmtRate(row.output_rate_per_1m)}</td>
                  <td>{row.cost_usd !== null ? fmtCost(row.cost_usd) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ textAlign: "center", padding: "2rem", color: "var(--meta-color)" }}>
                    暂无记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
