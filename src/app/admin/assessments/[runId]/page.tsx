import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssessmentRun } from "@/lib/assessmentRuns";

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (!listBuffer.length) return;
    elements.push(
      <ul key={key++}>
        {listBuffer.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
        ))}
      </ul>,
    );
    listBuffer = [];
  }

  function inlineFormat(line: string) {
    return line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^### /.test(line)) {
      flushList();
      elements.push(<h3 key={key++}>{line.slice(4)}</h3>);
    } else if (/^## /.test(line)) {
      flushList();
      elements.push(<h2 key={key++}>{line.slice(3)}</h2>);
    } else if (/^# /.test(line)) {
      flushList();
      elements.push(<h1 key={key++}>{line.slice(2)}</h1>);
    } else if (/^[-*] /.test(line)) {
      listBuffer.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      listBuffer.push(line.replace(/^\d+\. /, ""));
    } else if (line === "") {
      flushList();
      elements.push(<br key={key++} />);
    } else {
      flushList();
      elements.push(
        <p key={key++} dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />,
      );
    }
  }
  flushList();
  return elements;
}

export default async function AssessmentRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await getAssessmentRun(runId);
  if (!run) notFound();

  const org = run.organize_stats;
  const modes = ["normal", "smart"] as const;

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">评估详情</p>
          <h1><code>{run.run_id}</code></h1>
          <p className="admin-meta">
            {new Date(run.created_at).toLocaleString("zh-SG")} ·{" "}
            {run.example_count ?? 0} 个样本 · 触发方式：{run.triggered_by}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {run.report_url && (
            <a href={run.report_url} target="_blank" rel="noreferrer" className="secondary-button compact-button">
              查看 HTML 报告 ↗
            </a>
          )}
          <Link href="/admin/assessments" className="secondary-button compact-button">← 返回列表</Link>
        </div>
      </div>

      <section className="admin-section">
        <h2>稳定性摘要</h2>
        <div className="admin-stats-grid">
          {org && (
            <div className="admin-stat-card">
              <span className="stat-label">整理成功</span>
              <span className="stat-value">{org.success}/{org.total}</span>
            </div>
          )}
          {modes.map((mode) => {
            const s = run.mode_stats?.[mode];
            if (!s) return null;
            return (
              <div key={mode} className="admin-stat-card">
                <span className="stat-label">{mode === "normal" ? "常规" : "智能"} 成功</span>
                <span className="stat-value">{s.success}/{s.count}</span>
                <span className="stat-sub">阻断 {s.blocked} · 失败 {s.failed} · 修复 {s.repairTriggered}</span>
                <span className="stat-sub">均延迟 {s.averageLatencyMs} ms · 均费用 US${s.averageCostUsd}</span>
              </div>
            );
          })}
        </div>
      </section>

      {run.blocked_reason_groups && Object.keys(run.blocked_reason_groups).length > 0 && (
        <section className="admin-section">
          <h2>阻断原因分布</h2>
          <ul className="admin-reason-list">
            {Object.entries(run.blocked_reason_groups).map(([reason, count]) => (
              <li key={reason}><strong>×{count}</strong> {reason}</li>
            ))}
          </ul>
        </section>
      )}

      {run.reviewer_text && (
        <section className="admin-section">
          <h2>DeepSeek 评审意见 <span className="admin-meta">({run.reviewer_model})</span></h2>
          <div className="admin-markdown">{renderMarkdown(run.reviewer_text)}</div>
        </section>
      )}
    </main>
  );
}
