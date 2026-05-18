"use client";

import { useState, useEffect } from "react";
import type { SessionReviewRow } from "@/lib/analytics/sessionReview";

const VERDICT_LABEL: Record<string, string> = {
  stable: "正常",
  needs_attention: "需关注",
  critical: "须立即检查",
};

const VERDICT_CLASS: Record<string, string> = {
  stable: "eval-verdict--stable",
  needs_attention: "eval-verdict--warn",
  critical: "eval-verdict--critical",
};

const STATUS_LABEL: Record<string, string> = {
  resolved: "✅ 已解决",
  partial: "🔶 部分改善",
  unchanged: "⏸ 未变化",
  regressed: "❌ 退步",
};

const SEVERITY_LABEL: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

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

function ReviewCard({ row }: { row: SessionReviewRow }) {
  const [expanded, setExpanded] = useState(false);
  const review = row.review;
  const verdictClass = VERDICT_CLASS[review.verdict] ?? "eval-verdict--stable";

  return (
    <div className="eval-panel" style={{ marginBottom: "1rem" }}>
      <div className="eval-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span className={`eval-verdict ${verdictClass}`}>
            {VERDICT_LABEL[review.verdict] ?? review.verdict}
          </span>
          <span className="eval-meta">
            {formatSGT(row.created_at)} ·
            窗口 {formatDateSGT(row.window_start)} — {formatDateSGT(row.window_end)} ·
            {row.sample_size} 个样本 · {row.prompt_version_at_run}
            {row.prior_review_id && (
              <> · 链接上一轮</>
            )}
          </span>
        </div>
        <button
          className="secondary-button compact-button"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开详情"}
        </button>
      </div>

      <div className="eval-section" style={{ marginTop: "0.75rem" }}>
        <p className="eval-summary">{review.reviewSummary}</p>
      </div>

      {expanded && (
        <div style={{ marginTop: "0.5rem" }}>
          {/* Prior improvement status */}
          {review.priorImprovementStatus && review.priorImprovementStatus.length > 0 && (
            <div className="eval-block">
              <h3 className="eval-block-title">上一轮建议追踪</h3>
              {review.promptVersionsCompared && (
                <p className="eval-meta" style={{ marginBottom: "0.5rem" }}>
                  {review.promptVersionsCompared.prior} → {review.promptVersionsCompared.current}
                </p>
              )}
              <div className="eval-gap-list">
                {review.priorImprovementStatus.map((s, i) => (
                  <div key={i} className="eval-gap-row">
                    <div className="eval-gap-desc">
                      <strong>{STATUS_LABEL[s.status] ?? s.status}</strong>
                      <span style={{ marginLeft: "0.5rem" }}>{s.priorIssue}</span>
                    </div>
                    <div className="eval-gap-hint">{s.evidence}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hallucination patterns */}
          {review.hallucinationPatterns.length > 0 && (
            <div className="eval-block">
              <h3 className="eval-block-title">幻觉模式</h3>
              <div className="eval-gap-list">
                {review.hallucinationPatterns.map((h, i) => (
                  <div key={i} className="eval-gap-row">
                    <div className="eval-gap-desc">
                      <strong>严重度：{SEVERITY_LABEL[h.severity] ?? h.severity}</strong>
                      <span style={{ marginLeft: "0.5rem" }}>{h.pattern}</span>
                    </div>
                    <div className="eval-gap-hint">
                      涉及案例：{h.affectedCases.join("、")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Structural drift */}
          {review.structuralDrift.length > 0 && (
            <div className="eval-block">
              <h3 className="eval-block-title">结构漂移</h3>
              <ul className="eval-list">
                {review.structuralDrift.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}

          {/* Language issues */}
          {review.languageIssues.length > 0 && (
            <div className="eval-block">
              <h3 className="eval-block-title">语言问题</h3>
              <ul className="eval-list">
                {review.languageIssues.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}

          {/* Prompt improvements */}
          {review.promptImprovements.length > 0 && (
            <div className="eval-block">
              <h3 className="eval-block-title">提示词改进建议</h3>
              <div className="eval-gap-list">
                {review.promptImprovements.map((p, i) => (
                  <div key={i} className="eval-gap-row">
                    <div className="eval-gap-desc">
                      <strong>问题：</strong>{p.issue}
                      {p.affectedCases.length > 0 && (
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
      )}
    </div>
  );
}

function RunningCard() {
  return (
    <div className="eval-panel" style={{ marginBottom: "1rem", opacity: 0.7 }}>
      <div className="eval-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="eval-verdict eval-verdict--stable" style={{ background: "#F3F4F6", color: "#6B7280", borderColor: "#D1D5DB" }}>
            运行中
          </span>
          <span className="eval-meta">正在审查近 14 天 AI 输出，请稍候（约 1 分钟）…</span>
        </div>
      </div>
    </div>
  );
}

export function SessionReviewList({ initialReviews }: { initialReviews: SessionReviewRow[] }) {
  const [reviews, setReviews] = useState<SessionReviewRow[]>(initialReviews);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: re-fetch list from API so a page refresh always reflects DB state
  useEffect(() => {
    fetch("/api/admin/analytics/session-review?limit=20")
      .then((r) => r.json())
      .then((json: { reviews?: SessionReviewRow[] }) => {
        if (json.reviews) setReviews(json.reviews);
      })
      .catch(() => { /* non-critical, fall back to SSR data */ });
  }, []);

  async function runReview() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/analytics/session-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includePrior: true }),
      });
      const json = await res.json() as { message?: string; review?: SessionReviewRow };
      if (!res.ok) throw new Error(json.message ?? "审查失败");
      if (json.review) setReviews((prev) => [json.review!, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "审查失败，请稍后重试。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="eval-toolbar" style={{ marginBottom: "1.5rem" }}>
        <div>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.875rem" }}>
            对近 14 天全体医生的 AI 输出进行系统审查，用于发现提示词问题并追踪改进效果。
          </p>
        </div>
        <button
          className="primary-button"
          onClick={runReview}
          disabled={running}
        >
          {running ? "审查中…" : "运行新审查"}
        </button>
      </div>

      {error && <div className="eval-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {running && <RunningCard />}

      {reviews.length === 0 && !running ? (
        <div className="admin-empty">
          <p>暂无审查记录。点击"运行新审查"开始。</p>
        </div>
      ) : (
        reviews.map((row) => <ReviewCard key={row.id} row={row} />)
      )}
    </div>
  );
}
