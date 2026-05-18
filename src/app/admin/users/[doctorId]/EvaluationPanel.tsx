"use client";

import { useState, useEffect } from "react";
import { Sparkles, ClipboardList, Lightbulb, Compass, MessageSquare } from "lucide-react";
import type { DoctorProfile } from "@/lib/analytics/evaluation";

// Triggered via GH Actions (Actions → Evaluate Doctors → Run workflow)
// This panel is read-only. Pass doctor email or UUID as workflow input.

type EvaluationRecord = {
  id: string;
  window_start: string;
  window_end: string;
  consultation_count: number;
  doctor_profile: DoctorProfile | null;
  model: string | null;
  created_at: string;
} | null;

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

function parseRatio(presentIn: string): number {
  const match = presentIn.match(/^(\d+)\/(\d+)$/);
  if (!match) return 0;
  const n = parseInt(match[1]), d = parseInt(match[2]);
  return d === 0 ? 0 : n / d;
}

function barFillClass(ratio: number) {
  if (ratio >= 0.7) return "profile-bar-fill--strong";
  if (ratio >= 0.3) return "profile-bar-fill--mid";
  return "profile-bar-fill--weak";
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function StrengthsCard({ profile }: { profile: DoctorProfile }) {
  const strengths = profile.strengths ?? [];
  return (
    <div className="profile-card profile-card--sage">
      <h3 className="profile-card-title">
        <Sparkles size={15} /> 观察到的优势
      </h3>
      {strengths.length === 0 ? (
        <p className="profile-empty">本期暂未识别到有据可查的突出优势</p>
      ) : (
        <div className="profile-strength-list">
          {strengths.map((s, i) => (
            <div key={i} className="profile-strength-row">
              <span className="profile-strength-text">{s.strength}</span>
              {s.evidence && (
                <span className="profile-evidence-tag">· {s.evidence}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldCompletenessCard({ profile }: { profile: DoctorProfile }) {
  const fields = profile.fieldCompleteness;

  // Fallback for old DB records: derive from deprecated weakFields
  if (!fields || fields.length === 0) {
    const weak = profile.weakFields ?? [];
    if (weak.length === 0) return null;
    return (
      <div className="profile-card profile-card--mist">
        <h3 className="profile-card-title">
          <ClipboardList size={15} /> 记录画像
        </h3>
        <p className="profile-empty">偏简字段：{weak.join("、")}</p>
      </div>
    );
  }

  return (
    <div className="profile-card profile-card--mist">
      <h3 className="profile-card-title">
        <ClipboardList size={15} /> 记录画像
      </h3>
      <div className="profile-bar-list">
        {fields.map((f, i) => {
          const ratio = parseRatio(f.presentIn);
          return (
            <div key={i} className="profile-bar-row">
              <span className="profile-bar-label">{f.field}</span>
              <div className="profile-bar-track">
                <div
                  className={`profile-bar-fill ${barFillClass(ratio)}`}
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              <span className="profile-bar-fraction">{f.presentIn}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiThemesCard({ profile }: { profile: DoctorProfile }) {
  const themes = profile.aiRecurringThemes;
  if (!themes) return null;

  const hasContent =
    themes.frequentSuggestions.length > 0 ||
    themes.frequentRisks.length > 0 ||
    themes.frequentClarifications.length > 0;

  return (
    <div className="profile-card profile-card--gold">
      <h3 className="profile-card-title">
        <Lightbulb size={15} /> AI 与您对话的规律
      </h3>
      {!hasContent ? (
        <p className="profile-empty">本期 AI 输出暂无明显重复规律（频率 ≥30%）</p>
      ) : (
        <div className="profile-theme-groups">
          {themes.frequentSuggestions.length > 0 && (
            <div className="profile-theme-group">
              <span className="profile-theme-label">常见建议</span>
              <div className="profile-theme-pills">
                {themes.frequentSuggestions.map((s, i) => (
                  <span key={i} className="profile-theme-pill">{s}</span>
                ))}
              </div>
            </div>
          )}
          {themes.frequentRisks.length > 0 && (
            <div className="profile-theme-group">
              <span className="profile-theme-label">常见提醒</span>
              <div className="profile-theme-pills">
                {themes.frequentRisks.map((r, i) => (
                  <span key={i} className="profile-theme-pill">{r}</span>
                ))}
              </div>
            </div>
          )}
          {themes.frequentClarifications.length > 0 && (
            <div className="profile-theme-group">
              <span className="profile-theme-label">常见复核请求</span>
              <div className="profile-theme-pills">
                {themes.frequentClarifications.map((c, i) => (
                  <span key={i} className="profile-theme-pill">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GapsCard({ profile }: { profile: DoctorProfile }) {
  const gaps = profile.gaps ?? [];
  return (
    <div className="profile-card profile-card--tan">
      <h3 className="profile-card-title">
        <Compass size={15} /> 可深入的方向
      </h3>
      {gaps.length === 0 ? (
        <p className="profile-empty">本期暂无明显的输入-输出差距</p>
      ) : (
        <div className="profile-gap-list">
          {gaps.map((g, i) => {
            const freq = g.presentIn ?? g.frequency ?? "";
            return (
              <div key={i} className="profile-gap-row">
                <div className="profile-gap-header">
                  <span className="profile-gap-text">{g.gap}</span>
                  {freq && <span className="profile-gap-badge">{freq}</span>}
                </div>
                {g.evidence && (
                  <span className="profile-gap-evidence">{g.evidence}</span>
                )}
                <div className="profile-gap-hint">💬 {g.guidanceHint}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GuidanceCard({ profile }: { profile: DoctorProfile }) {
  const points = profile.guidancePoints ?? [];
  return (
    <div className="profile-card profile-card--ink">
      <h3 className="profile-card-title">
        <MessageSquare size={15} /> 可探讨的话题
      </h3>
      {points.length === 0 ? (
        <p className="profile-empty">本期暂无具体对话建议</p>
      ) : (
        <div className="profile-quote-list">
          {points.map((p, i) => (
            <div key={i} className="profile-quote">{p}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function EvaluationPanel({ doctorId }: { doctorId: string }) {
  const [record, setRecord] = useState<EvaluationRecord>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics/evaluate/${doctorId}`)
      .then((res) => {
        if (!res.ok) throw new Error("读取失败");
        return res.json() as Promise<{ evaluation: EvaluationRecord }>;
      })
      .then((json) => setRecord(json.evaluation))
      .catch(() => setError("读取评估记录失败，请稍后重试。"))
      .finally(() => setLoading(false));
  }, [doctorId]);

  if (loading) return <div className="eval-loading">加载中…</div>;

  return (
    <div className="profile-panel">
      {error && <div className="eval-error">{error}</div>}

      {!record && !error && (
        <div className="admin-empty">
          <p>暂无评估记录。请通过 GitHub Actions 触发首次评估。</p>
        </div>
      )}

      {record && (
        <>
          {/* Hero strip */}
          <div className="profile-hero">
            <div className="profile-hero-chips">
              <span className="profile-chip">{record.consultation_count} 例样本</span>
              <span className="profile-chip">
                {formatDateSGT(record.window_start)} — {formatDateSGT(record.window_end)}
              </span>
              <span className="profile-chip">最近评估 {formatSGT(record.created_at)}</span>
            </div>
            {record.doctor_profile && (
              <>
                <h2 className="profile-headline">
                  {record.doctor_profile.headline ?? record.doctor_profile.profileSummary.slice(0, 30)}
                </h2>
                {record.doctor_profile.prescriptionStyle && (
                  <p className="profile-prescription-style">
                    {record.doctor_profile.prescriptionStyle}
                  </p>
                )}
                <p className="profile-summary">{record.doctor_profile.profileSummary}</p>
              </>
            )}
            <p className="profile-trigger-note">
              通过 GitHub Actions → <strong>Evaluate Doctors</strong> → Run workflow 触发，输入医生邮箱或 UUID。历史记录保留，每次运行追加。
            </p>
          </div>

          {/* Profile sections */}
          {record.doctor_profile && (
            <>
              <StrengthsCard profile={record.doctor_profile} />
              <FieldCompletenessCard profile={record.doctor_profile} />
              <AiThemesCard profile={record.doctor_profile} />
              <GapsCard profile={record.doctor_profile} />
              <GuidanceCard profile={record.doctor_profile} />
            </>
          )}
        </>
      )}
    </div>
  );
}
