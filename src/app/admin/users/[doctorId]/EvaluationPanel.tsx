"use client";

import { useState, useEffect } from "react";
import type { DoctorProfile } from "@/lib/analytics/evaluation";

type EvaluationRecord = {
  id: string;
  window_start: string;
  window_end: string;
  consultation_count: number;
  doctor_profile: DoctorProfile | null;
  model: string | null;
  created_at: string;
} | null;

const COMPLETENESS_LABEL: Record<string, string> = {
  high: "完整",
  medium: "中等",
  low: "偏简",
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

export function EvaluationPanel({ doctorId }: { doctorId: string }) {
  const [record, setRecord] = useState<EvaluationRecord>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function fetchEvaluation() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics/evaluate/${doctorId}`);
      if (!res.ok) throw new Error("读取失败");
      const json = await res.json() as { evaluation: EvaluationRecord };
      setRecord(json.evaluation);
    } catch {
      setError("读取评估记录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function runEvaluation() {
    setRunning(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/analytics/evaluate/${doctorId}`, {
        method: "POST",
      });
      const json = await res.json() as { message?: string; evaluation?: EvaluationRecord };
      if (!res.ok) {
        throw new Error(json.message ?? "评估失败");
      }
      if (json.evaluation) setRecord(json.evaluation);
      else await fetchEvaluation();
      setSuccessMsg("评估完成。");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "评估失败，请稍后重试。");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    fetchEvaluation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  if (loading) {
    return <div className="eval-loading">加载中…</div>;
  }

  return (
    <div className="eval-panel">
      <div className="eval-toolbar">
        <div>
          {record ? (
            <span className="eval-meta">
              评估窗口：最近 14 天
              （{formatDateSGT(record.window_start)} — {formatDateSGT(record.window_end)}）
              · 最近评估：{formatSGT(record.created_at)}
              · {record.consultation_count} 条病案
            </span>
          ) : (
            <span className="eval-meta">暂无评估记录</span>
          )}
        </div>
        <button
          className="secondary-button compact-button"
          onClick={runEvaluation}
          disabled={running}
        >
          {running ? "评估中…" : record ? "重新评估（近 14 天）" : "开始评估（近 14 天）"}
        </button>
      </div>

      {error && <div className="eval-error">{error}</div>}
      {successMsg && <div className="eval-success">{successMsg}</div>}

      {!record && !error && (
        <div className="admin-empty">
          <p>暂无评估记录。点击"开始评估"对该医生的近 14 天病案进行分析。</p>
        </div>
      )}

      {record?.doctor_profile && (
        <DoctorProfileSection profile={record.doctor_profile} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Doctor Profile
// ---------------------------------------------------------------------------

function DoctorProfileSection({ profile }: { profile: DoctorProfile }) {
  return (
    <div className="eval-section">
      <div className="eval-profile-summary">
        <p>{profile.profileSummary}</p>
      </div>

      <div className="eval-profile-grid">
        <div className="eval-profile-card">
          <span className="eval-profile-label">处方风格</span>
          <span className="eval-profile-value">{profile.prescriptionStyle}</span>
        </div>
        <div className="eval-profile-card">
          <span className="eval-profile-label">记录完整度</span>
          <span className="eval-profile-value">
            {COMPLETENESS_LABEL[profile.inputCompleteness] ?? profile.inputCompleteness}
          </span>
        </div>
        {profile.weakFields.length > 0 && (
          <div className="eval-profile-card">
            <span className="eval-profile-label">偏简字段</span>
            <span className="eval-profile-value">{profile.weakFields.join("、")}</span>
          </div>
        )}
      </div>

      {profile.gaps.length > 0 && (
        <div className="eval-block">
          <h3 className="eval-block-title">差距识别</h3>
          <div className="eval-gap-list">
            {profile.gaps.map((g, i) => (
              <div key={i} className="eval-gap-row">
                <div className="eval-gap-desc">
                  <strong>{g.gap}</strong>
                  <span className="eval-gap-freq">{g.frequency}</span>
                </div>
                <div className="eval-gap-hint">💬 {g.guidanceHint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile.guidancePoints.length > 0 && (
        <div className="eval-block">
          <h3 className="eval-block-title">对话参考建议</h3>
          <ul className="eval-list">
            {profile.guidancePoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
