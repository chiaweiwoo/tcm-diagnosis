"use client";

import { useState, useEffect } from "react";
import type { OutputAuditRow, Finding, AuditCategories } from "@/lib/analytics/outputAudit";
import { VERDICT, SEVERITY, CATEGORY, CATEGORY_ORDER } from "@/lib/analytics/auditDefinitions";

// ---------------------------------------------------------------------------
// Tooltip helper — reuses .profile-help-tip CSS from admin.css
// ---------------------------------------------------------------------------

function Tip({ text }: { text: string }) {
  return (
    <span
      className="profile-help-tip"
      data-tooltip={text}
      aria-label={text}
    >
      ?
    </span>
  );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

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

function formatDateSGT(iso: string) {
  return new Date(iso).toLocaleDateString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Verdict badge
// ---------------------------------------------------------------------------

const VERDICT_CLASS: Record<string, string> = {
  stable: "eval-verdict--stable",
  needs_attention: "eval-verdict--warn",
  regressing: "eval-verdict--critical",
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const def = VERDICT[verdict];
  return (
    <span className={`eval-verdict ${VERDICT_CLASS[verdict] ?? "eval-verdict--stable"}`}>
      {def?.label ?? verdict}
      {def && <Tip text={def.tip} />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Finding card
// ---------------------------------------------------------------------------

function FindingCard({ finding }: { finding: Finding }) {
  const [showExamples, setShowExamples] = useState(false);
  const sev = finding.severity ?? "low";
  const sevDef = SEVERITY[sev];

  return (
    <div className={`audit-finding-card audit-finding-card--${sev}`}>
      <div className="audit-finding-header">
        <span className="audit-finding-name">{finding.shortName}</span>
        <span className={`audit-severity-badge audit-severity-badge--${sev}`}>
          {sevDef?.label ?? sev}
          {sevDef && <Tip text={sevDef.tip} />}
        </span>
      </div>

      <p className="audit-finding-obs">{finding.observation}</p>

      {finding.exampleCases && finding.exampleCases.length > 0 && (
        <div>
          <button
            className="audit-examples-toggle"
            onClick={() => setShowExamples((v) => !v)}
          >
            {showExamples ? "收起示例" : `查看示例（${finding.exampleCases.length}）`}
          </button>
          {showExamples && (
            <ul className="audit-example-list">
              {finding.exampleCases.map((e, i) => (
                <li key={i}>{e.summary}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {finding.suggestedFix && (
        <p className="audit-finding-fix">💡 {finding.suggestedFix}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category section — one per audit category
// ---------------------------------------------------------------------------

function CategorySection({
  catKey,
  findings,
}: {
  catKey: string;
  findings: Finding[];
}) {
  if (!findings || findings.length === 0) return null;
  const def = CATEGORY[catKey];

  return (
    <div className="audit-category-section">
      <div className="audit-category-header">
        <span className="audit-category-label">
          {def?.label ?? catKey}
          {def && <Tip text={def.tip} />}
        </span>
        <span className="audit-category-count">{findings.length}</span>
      </div>
      <div className="audit-finding-list">
        {findings.map((f, i) => (
          <FindingCard key={f.findingKey ?? i} finding={f} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// v1 legacy renderer — for audits without categories field
// ---------------------------------------------------------------------------

function LegacyReview({ review }: { review: Record<string, unknown> }) {
  const hallucinationPatterns = (review.hallucinationPatterns as { pattern: string; severity: string; affectedCases: number[] }[] | undefined) ?? [];
  const structuralDrift = (review.structuralDrift as string[]) ?? [];
  const languageIssues = (review.languageIssues as string[]) ?? [];
  const promptImprovements = (review.promptImprovements as { issue: string; suggestedPromptChange: string; affectedCases: number[] }[]) ?? [];

  const SEVERITY_LABEL: Record<string, string> = { low: "低", medium: "中", high: "高" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {hallucinationPatterns.length > 0 && (
        <div className="eval-block">
          <h3 className="eval-block-title">幻觉模式</h3>
          <div className="eval-gap-list">
            {hallucinationPatterns.map((h, i) => (
              <div key={i} className="eval-gap-row">
                <div className="eval-gap-desc">
                  <strong>严重度：{SEVERITY_LABEL[h.severity] ?? h.severity}</strong>
                  <span style={{ marginLeft: "0.5rem" }}>{h.pattern}</span>
                </div>
                {h.affectedCases?.length > 0 && (
                  <div className="eval-gap-hint">涉及案例：{h.affectedCases.join("、")}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {structuralDrift.length > 0 && (
        <div className="eval-block">
          <h3 className="eval-block-title">结构漂移</h3>
          <ul className="eval-list">
            {structuralDrift.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
      {languageIssues.length > 0 && (
        <div className="eval-block">
          <h3 className="eval-block-title">语言问题</h3>
          <ul className="eval-list">
            {languageIssues.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
      {promptImprovements.length > 0 && (
        <div className="eval-block">
          <h3 className="eval-block-title">提示词改进建议</h3>
          <div className="eval-gap-list">
            {promptImprovements.map((p, i) => (
              <div key={i} className="eval-gap-row">
                <div className="eval-gap-desc">
                  <strong>问题：</strong>{p.issue}
                  {p.affectedCases?.length > 0 && (
                    <span className="eval-gap-freq">案例 {p.affectedCases.join("、")}</span>
                  )}
                </div>
                <div className="eval-gap-hint">💡 {p.suggestedPromptChange}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main review card
// ---------------------------------------------------------------------------

function AuditCard({ row }: { row: OutputAuditRow }) {
  const [expanded, setExpanded] = useState(false);
  const review = row.review;
  const isV2 = review && typeof review === "object" && "categories" in review && review.categories != null;

  // Count total findings across all categories
  let totalFindings = 0;
  if (isV2 && review.categories) {
    const cats = review.categories as AuditCategories;
    for (const key of CATEGORY_ORDER) {
      totalFindings += cats[key as keyof AuditCategories]?.length ?? 0;
    }
  }

  return (
    <div className="audit-card">
      {/* Header */}
      <div className="audit-card-header">
        <div>
          <div className="audit-card-title-row">
            <VerdictBadge verdict={review.verdict} />
            {!isV2 && <span className="audit-v1-banner">v1 旧版</span>}
            {isV2 && totalFindings > 0 && (
              <span className="audit-category-count">{totalFindings} 条发现</span>
            )}
          </div>
          <p className="audit-card-meta">
            {formatSGT(row.created_at)} ·{" "}
            样本窗口 {formatDateSGT(row.window_start)} — {formatDateSGT(row.window_end)} ·{" "}
            {row.sample_size} 个样本 · {row.prompt_version_at_run}
          </p>
        </div>
        <button
          className="secondary-button compact-button"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开详情"}
        </button>
      </div>

      {/* Summary — always visible */}
      <div className="audit-summary-block">
        <p className="audit-summary-text">{review.reviewSummary}</p>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="audit-detail-body">
          {isV2 ? (
            <>
              {/* v2: categories */}
              {CATEGORY_ORDER.some((k) => ((review.categories as AuditCategories)?.[k as keyof AuditCategories]?.length ?? 0) > 0) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  {CATEGORY_ORDER.map((catKey) => {
                    const findings = (review.categories as AuditCategories)?.[catKey as keyof AuditCategories] ?? [];
                    return (
                      <CategorySection
                        key={catKey}
                        catKey={catKey}
                        findings={findings}
                      />
                    );
                  })}
                </div>
              )}

              {/* User feedback summary (v3+) */}
              {review.userFeedbackSummary && (
                <div>
                  <h3 className="audit-section-title">
                    用户反馈
                    <Tip text="医生在病案中留下的文字反馈（匿名汇总），反映使用体验与意见。" />
                  </h3>
                  <div className="audit-feedback-block">
                    <p className="audit-feedback-text">{review.userFeedbackSummary}</p>
                  </div>
                </div>
              )}

              {/* Prompt improvements */}
              {review.promptImprovements && review.promptImprovements.length > 0 && (
                <div>
                  <h3 className="audit-section-title">
                    提示词改进建议
                    <Tip text="具体、可操作的提示词修改方向，指向具体片段或结构位置。" />
                  </h3>
                  <div className="audit-prompt-improvements">
                    {review.promptImprovements.map((p, i) => (
                      <div key={i} className="audit-improvement-card">
                        <p className="audit-improvement-issue">{p.issue}</p>
                        <p className="audit-improvement-change">💡 {p.suggestedPromptChange}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <LegacyReview review={review as unknown as Record<string, unknown>} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List component
// ---------------------------------------------------------------------------

export function OutputAuditList({ initialAudits }: { initialAudits: OutputAuditRow[] }) {
  const [audits, setAudits] = useState<OutputAuditRow[]>(initialAudits);

  useEffect(() => {
    fetch("/api/admin/analytics/output-audit?limit=20")
      .then((r) => r.json())
      .then((json: { audits?: OutputAuditRow[] }) => {
        if (json.audits) setAudits(json.audits);
      })
      .catch(() => { /* non-critical, fall back to SSR data */ });
  }, []);

  return (
    <div>
      <p style={{ margin: "0 0 1.5rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
        对最近一批 AI 临床输出（窗口锚定至最新病案时间）进行系统审查，发现提示词层面问题，并汇总医生文字反馈。
        通过 GitHub Actions → <strong>AI Output Audit</strong> → Run workflow 触发。
      </p>

      {audits.length === 0 ? (
        <div className="admin-empty">
          <p>暂无审查记录。请通过 GitHub Actions 触发首次审查。</p>
        </div>
      ) : (
        audits.map((row) => <AuditCard key={row.id} row={row} />)
      )}
    </div>
  );
}
