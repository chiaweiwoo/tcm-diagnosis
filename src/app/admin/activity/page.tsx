import Link from "next/link";
import { listActivityLogs, computeDoctorSummaries, type ActivityLog } from "@/lib/activityLogs";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-SG", { timeZone: "Asia/Singapore" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-SG", { timeZone: "Asia/Singapore",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const EVENT_LABELS: Record<string, { label: string; cls: string }> = {
  login:    { label: "登录",   cls: "activity-badge-login" },
  organize: { label: "整理",   cls: "activity-badge-organize" },
  analyze:  { label: "复核",   cls: "activity-badge-analyze" },
};

function EventBadge({ type }: { type: string }) {
  const { label, cls } = EVENT_LABELS[type] ?? { label: type, cls: "activity-badge-default" };
  return <span className={`activity-badge ${cls}`}>{label}</span>;
}

function MetaSummary({ log }: { log: ActivityLog }) {
  const m = log.metadata;
  if (!m) return null;
  if (log.event_type === "login") {
    const ua = String(m.user_agent ?? "");
    // Extract a short browser/platform label from user agent
    const short = ua.includes("Mobile") ? "移动端"
      : ua.includes("Chrome") ? "Chrome"
      : ua.includes("Safari") ? "Safari"
      : ua.includes("Firefox") ? "Firefox"
      : ua ? "浏览器"
      : null;
    return short ? <span className="activity-meta">{short}</span> : null;
  }
  if (log.event_type === "analyze") {
    const parts = [m.caseType, m.reviewMode === "normal" ? "常规" : m.reviewMode === "smart" ? "智能" : null]
      .filter(Boolean).join(" · ");
    return parts ? <span className="activity-meta">{parts}</span> : null;
  }
  return null;
}

export default async function ActivityPage() {
  const logs = await listActivityLogs(300);
  const summaries = computeDoctorSummaries(logs);
  const recent = logs.slice(0, 60);

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>用户活动</h1>
          <p className="admin-meta">
            最近 {logs.length} 条事件 · {summaries.length} 个账号
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin/assessments" className="secondary-button compact-button">评估记录</Link>
          <Link href="/" className="secondary-button compact-button">← 返回工作台</Link>
        </div>
      </div>

      {/* Per-doctor summary */}
      <section className="admin-section">
        <h2>账号汇总</h2>
        {summaries.length === 0 ? (
          <div className="admin-empty">
            <p>暂无活动记录。医生登录或提交病案后将自动开始记录。</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>最近活跃</th>
                <th>最近登录</th>
                <th>本月活动</th>
                <th>累计登录</th>
                <th>累计整理</th>
                <th>累计复核</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.email}>
                  <td style={{ fontWeight: 600 }}>{s.email}</td>
                  <td>
                    <span title={s.lastActive}>{timeAgo(s.lastActive)}</span>
                  </td>
                  <td>
                    {s.lastLogin
                      ? <span title={s.lastLogin}>{timeAgo(s.lastLogin)}</span>
                      : "—"}
                  </td>
                  <td><strong>{s.thisMonthCount}</strong></td>
                  <td>{s.loginCount}</td>
                  <td>{s.organizeCount}</td>
                  <td>{s.analyzeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent event log */}
      {recent.length > 0 && (
        <section className="admin-section">
          <h2>最近事件 <span className="admin-meta">（最新 {recent.length} 条）</span></h2>
          <div className="activity-log">
            {recent.map((log) => (
              <div key={log.id} className="activity-row">
                <span className="activity-time" title={log.created_at}>
                  {fmtDateTime(log.created_at)}
                </span>
                <EventBadge type={log.event_type} />
                <span className="activity-email">{log.doctor_email}</span>
                <MetaSummary log={log} />
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
