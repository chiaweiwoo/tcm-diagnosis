import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssessmentRun, type ExampleSummary, type ExampleReview, type SectionReview } from "@/lib/assessmentRuns";

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
    if (/^### /.test(line)) { flushList(); elements.push(<h3 key={key++}>{line.slice(4)}</h3>); }
    else if (/^## /.test(line)) { flushList(); elements.push(<h2 key={key++}>{line.slice(3)}</h2>); }
    else if (/^# /.test(line)) { flushList(); elements.push(<h1 key={key++}>{line.slice(2)}</h1>); }
    else if (/^[-*] /.test(line)) { listBuffer.push(line.slice(2)); }
    else if (/^\d+\. /.test(line)) { listBuffer.push(line.replace(/^\d+\. /, "")); }
    else if (line === "") { flushList(); elements.push(<br key={key++} />); }
    else { flushList(); elements.push(<p key={key++} dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />); }
  }
  flushList();
  return elements;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "badge-success",
    blocked: "badge-blocked",
    failed: "badge-failed",
  };
  return <span className={`example-badge ${map[status] ?? "badge-default"}`}>{status}</span>;
}

function ExampleCard({ ex, index }: { ex: ExampleSummary; index: number }) {
  const modeKeys = Object.keys(ex.modes ?? {});

  return (
    <div className="example-card">
      <div className="example-card-header">
        <span className="example-index">#{index + 1}</span>
        {ex.caseTypeGuess && <span className="example-tag">{ex.caseTypeGuess}</span>}
        {ex.topicGuess && <span className="example-tag muted">{ex.topicGuess}</span>}
      </div>

      {ex.draftPreview && (
        <p className="example-draft">{ex.draftPreview}&hellip;</p>
      )}

      <div className="example-stages">
        {/* Organize */}
        <div className="example-stage">
          <span className="stage-label">整理</span>
          <StatusBadge status={ex.organize.status} />
          {ex.organize.latencyMs != null && (
            <span className="stage-meta">{ex.organize.latencyMs} ms</span>
          )}
          {ex.organize.formSummary && ex.organize.formSummary.length > 0 && (
            <div className="form-summary-pills">
              {ex.organize.formSummary.map((s, i) => <span key={i} className="form-pill">{s}</span>)}
            </div>
          )}
        </div>

        {/* Mode stages (single or dual) */}
        {modeKeys.map((modeKey) => {
          const m = ex.modes[modeKey];
          if (!m) return null;
          return (
            <div key={modeKey} className="example-stage">
              <span className="stage-label">{modeKey === "normal" ? "常规" : modeKey === "smart" ? "智能" : modeKey}</span>
              <StatusBadge status={m.status} />
              {m.latencyMs != null && <span className="stage-meta">{m.latencyMs} ms</span>}
              {m.costUsd != null && <span className="stage-meta">US${m.costUsd.toFixed(5)}</span>}
              {m.repairedJson && <span className="stage-meta warn">已修复 JSON</span>}
              {m.blockedReasons && m.blockedReasons.length > 0 && (
                <div className="blocked-reasons">
                  {m.blockedReasons.map((r, i) => <span key={i} className="blocked-tag">{r}</span>)}
                </div>
              )}
              {m.result?.title && (
                <p className="result-title">{m.result.title}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScorecardCard({ rev, index }: { rev: ExampleReview; index: number }) {
  return (
    <div className="scorecard-card">
      <div className="scorecard-header">
        <span className="example-index">#{index + 1}</span>
        <span className="scorecard-id">{rev.id}</span>
        {rev.error && <span className="stage-meta warn">评审失败</span>}
      </div>
      {rev.scorecard
        ? <pre className="scorecard-body">{rev.scorecard}</pre>
        : <p className="scorecard-error">{rev.error ?? "未知错误"}</p>}
    </div>
  );
}

function SectionCard({ sec }: { sec: SectionReview }) {
  return (
    <div className="section-review-card">
      <div className="section-review-header">{sec.label}</div>
      {sec.analysis
        ? <div className="section-review-body admin-markdown">{renderMarkdown(sec.analysis)}</div>
        : <p className="scorecard-error">{sec.error ?? "未知错误"}</p>}
    </div>
  );
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
  const modeKey = run.mode ?? null;
  const modeLabel = modeKey === "normal" ? "常规" : modeKey === "smart" ? "智能" : null;
  const examples = run.raw_results?.aggregate?.examples ?? [];

  // Collect which modes actually have stats
  const activeModesWithStats = Object.entries(run.mode_stats ?? {}).filter(([, s]) => s && s.count > 0);

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">评估详情</p>
          <h1><code>{run.run_id}</code></h1>
          <p className="admin-meta">
            {new Date(run.created_at).toLocaleString("zh-SG")} ·{" "}
            {run.example_count ?? 0} 个样本 · 触发：{run.triggered_by}
            {modeLabel && <> · 模式：{modeLabel}</>}
            {run.base_url && <> · <span>{run.base_url}</span></>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span className={`status-pill ${run.status}`}>{run.status}</span>
          <Link href="/admin/assessments" className="secondary-button compact-button">← 返回列表</Link>
        </div>
      </div>

      {/* Stats summary */}
      <section className="admin-section">
        <h2>稳定性摘要</h2>
        <div className="admin-stats-grid">
          {org && (
            <div className="admin-stat-card">
              <span className="stat-label">整理成功</span>
              <span className="stat-value">{org.success}/{org.total}</span>
              <span className="stat-sub">失败 {org.failed}</span>
            </div>
          )}
          {activeModesWithStats.map(([mode, s]) => (
            <div key={mode} className="admin-stat-card">
              <span className="stat-label">{mode === "normal" ? "常规" : "智能"} 成功</span>
              <span className="stat-value">{s.success}/{s.count}</span>
              <span className="stat-sub">阻断 {s.blocked} · 失败 {s.failed} · 修复 {s.repairTriggered}</span>
              <span className="stat-sub">均延迟 {s.averageLatencyMs} ms · 均费用 US${s.averageCostUsd}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Blocked reason groups */}
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

      {/* Per-example breakdown */}
      {examples.length > 0 && (
        <section className="admin-section">
          <h2>样本明细 <span className="admin-meta">({examples.length} 个)</span></h2>
          <div className="example-list">
            {examples.map((ex, i) => (
              <ExampleCard key={ex.id ?? i} ex={ex} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Per-example scorecards */}
      {run.example_reviews && run.example_reviews.length > 0 && (
        <section className="admin-section">
          <h2>逐条病案评分 <span className="admin-meta">({run.example_reviews.length} 条)</span></h2>
          <div className="scorecard-list">
            {run.example_reviews.map((rev, i) => (
              <ScorecardCard key={rev.id ?? i} rev={rev} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Per-section consistency analyses */}
      {run.section_reviews && run.section_reviews.length > 0 && (
        <section className="admin-section">
          <h2>输出栏目一致性 <span className="admin-meta">({run.section_reviews.length} 个栏目)</span></h2>
          <div className="section-review-list">
            {run.section_reviews.map((sec) => (
              <SectionCard key={sec.key} sec={sec} />
            ))}
          </div>
        </section>
      )}

      {/* Final reviewer commentary */}
      {run.reviewer_text ? (
        <section className="admin-section">
          <h2>综合评审报告 <span className="admin-meta">({run.reviewer_model})</span></h2>
          <div className="admin-markdown">{renderMarkdown(run.reviewer_text)}</div>
        </section>
      ) : (
        <section className="admin-section">
          <h2>评审报告</h2>
          <div className="admin-empty" style={{ padding: 20 }}>
            <p>评审尚未生成。在 GitHub Actions → Assess Review 填入此 run_id 触发。</p>
            <p style={{ marginTop: 8 }}><code>{run.run_id}</code></p>
          </div>
        </section>
      )}
    </main>
  );
}
