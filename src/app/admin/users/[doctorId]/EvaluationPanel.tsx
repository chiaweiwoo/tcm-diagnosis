"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Compass, Lightbulb, MessageSquare, Sparkles } from "lucide-react";
import type { DoctorProfile } from "@/lib/analytics/evaluation";

// Triggered via GitHub Actions (Evaluate Doctors -> Run workflow).
// This panel is read-only. Pass doctor email or UUID as workflow input.

type EvaluationRecord = {
  id: string;
  window_start: string;
  window_end: string;
  consultation_count: number;
  doctor_profile: unknown;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asCaseNumbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function parseLegacyRatio(value: string): { filled: number; total: number; rate: number } {
  const match = value.match(/^(\d+)\/(\d+)$/);
  if (!match) return { filled: 0, total: 0, rate: 0 };
  const filled = Number(match[1]);
  const total = Number(match[2]);
  return { filled, total, rate: total > 0 ? filled / total : 0 };
}

function normalizeProfile(value: unknown): DoctorProfile {
  const raw = asRecord(value);
  const array = (key: string) => Array.isArray(raw[key]) ? raw[key] as unknown[] : [];

  const fieldCompleteness = array("fieldCompleteness").map((item) => {
    const row = asRecord(item);
    const ratio = parseLegacyRatio(asString(row.presentIn));
    return {
      field: asString(row.field),
      label: asString(row.label) || asString(row.field),
      filled: asNumber(row.filled) || ratio.filled,
      total: asNumber(row.total) || ratio.total,
      rate: asNumber(row.rate) || ratio.rate,
    };
  }).filter((item) => item.label);

  const aiRecurringThemes = array("aiRecurringThemes").map((item) => {
    const row = asRecord(item);
    return {
      theme: asString(row.theme),
      frequency: asString(row.frequency),
      caseNumbers: asCaseNumbers(row.caseNumbers),
    };
  }).filter((item) => item.theme);

  const strengths = array("strengths").map((item) => {
    const row = asRecord(item);
    return {
      text: asString(row.text) || asString(row.strength),
      caseNumbers: asCaseNumbers(row.caseNumbers),
    };
  }).filter((item) => item.text);

  const gaps = array("gaps").map((item) => {
    const row = asRecord(item);
    const ratio = parseLegacyRatio(asString(row.presentIn) || asString(row.frequency));
    return {
      field: asString(row.field) || asString(row.gap),
      inputRate: asNumber(row.inputRate) || ratio.rate,
      aiAskRate: asNumber(row.aiAskRate),
      evidence: asString(row.evidence),
      caseNumbers: asCaseNumbers(row.caseNumbers),
      guidanceHint: asString(row.guidanceHint),
    };
  }).filter((item) => item.field || item.evidence || item.guidanceHint);

  const oldGuidance = array("guidancePoints")
    .filter((item): item is string => typeof item === "string")
    .map((text) => ({ text, caseNumbers: [] }));

  const guidancePoints = array("guidancePoints").map((item) => {
    const row = asRecord(item);
    return {
      text: asString(row.text),
      caseNumbers: asCaseNumbers(row.caseNumbers),
    };
  }).filter((item) => item.text);

  return {
    profileSummary: asString(raw.profileSummary) || "暂无可展示的画像摘要。",
    fieldCompleteness,
    aiRecurringThemes,
    strengths,
    gaps,
    guidancePoints: guidancePoints.length ? guidancePoints : oldGuidance,
  };
}

function formatRate(rate: number) {
  return `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%`;
}

function caseText(caseNumbers: number[]) {
  return caseNumbers.length > 0 ? `案例 ${caseNumbers.join("、")}` : "未标注案例";
}

function barFillClass(rate: number) {
  if (rate >= 0.7) return "profile-bar-fill--strong";
  if (rate >= 0.3) return "profile-bar-fill--mid";
  return "profile-bar-fill--weak";
}

function FieldCompletenessCard({ profile }: { profile: DoctorProfile }) {
  return (
    <div className="profile-card profile-card--mist">
      <h3 className="profile-card-title">
        <ClipboardList size={15} /> 字段完整度
      </h3>
      {profile.fieldCompleteness.length === 0 ? (
        <p className="profile-empty">暂无字段完整度数据</p>
      ) : (
        <div className="profile-bar-list">
          {profile.fieldCompleteness.map((field) => (
            <div key={field.field || field.label} className="profile-bar-row">
              <span className="profile-bar-label">{field.label}</span>
              <div className="profile-bar-track">
                <div
                  className={`profile-bar-fill ${barFillClass(field.rate)}`}
                  style={{ width: formatRate(field.rate) }}
                />
              </div>
              <span className="profile-bar-fraction">{field.filled}/{field.total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AiThemesCard({ profile }: { profile: DoctorProfile }) {
  return (
    <div className="profile-card profile-card--gold">
      <h3 className="profile-card-title">
        <Lightbulb size={15} /> AI反复提到的主题
      </h3>
      <ProfileList
        emptyText="本期暂无明显重复主题"
        items={profile.aiRecurringThemes.map((item) => ({
          main: item.theme,
          sub: `${item.frequency} · ${caseText(item.caseNumbers)}`,
        }))}
      />
    </div>
  );
}

function StrengthsCard({ profile }: { profile: DoctorProfile }) {
  return (
    <div className="profile-card profile-card--sage">
      <h3 className="profile-card-title">
        <Sparkles size={15} /> 可取之处
      </h3>
      <ProfileList
        emptyText="本期暂未识别到有据可查的突出优势"
        items={profile.strengths.map((item) => ({
          main: item.text,
          sub: caseText(item.caseNumbers),
        }))}
      />
    </div>
  );
}

function GapsCard({ profile }: { profile: DoctorProfile }) {
  return (
    <div className="profile-card profile-card--tan">
      <h3 className="profile-card-title">
        <Compass size={15} /> 差距识别
      </h3>
      <ProfileList
        emptyText="本期暂无符合双证据规则的差距"
        items={profile.gaps.map((item) => ({
          main: item.evidence || item.field,
          sub: `${item.field} · 输入 ${formatRate(item.inputRate)} · AI提醒 ${formatRate(item.aiAskRate)} · ${caseText(item.caseNumbers)}`,
          hint: item.guidanceHint,
        }))}
      />
    </div>
  );
}

function GuidanceCard({ profile }: { profile: DoctorProfile }) {
  return (
    <div className="profile-card profile-card--ink">
      <h3 className="profile-card-title">
        <MessageSquare size={15} /> 对话参考
      </h3>
      <ProfileList
        emptyText="本期暂无具体对话建议"
        items={profile.guidancePoints.map((item) => ({
          main: item.text,
          sub: caseText(item.caseNumbers),
        }))}
      />
    </div>
  );
}

function ProfileList({
  items,
  emptyText,
}: {
  items: Array<{ main: string; sub?: string; hint?: string }>;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="profile-empty">{emptyText}</p>;
  }

  return (
    <div className="profile-list">
      {items.map((item, index) => (
        <div key={index} className="profile-list-row">
          <span className="profile-list-main">{item.main}</span>
          {item.sub && <span className="profile-list-sub">{item.sub}</span>}
          {item.hint && <span className="profile-list-hint">💬 {item.hint}</span>}
        </div>
      ))}
    </div>
  );
}

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

  const profile = record?.doctor_profile ? normalizeProfile(record.doctor_profile) : null;

  return (
    <div className="profile-panel">
      {error && <div className="eval-error">{error}</div>}

      {!record && !error && (
        <div className="admin-empty">
          <p>暂无评估记录。请通过 GitHub Actions 触发首次评估。</p>
        </div>
      )}

      {record && profile && (
        <>
          <div className="profile-hero">
            <div className="profile-hero-chips">
              <span className="profile-chip">{record.consultation_count} 例样本</span>
              <span className="profile-chip">
                {formatDateSGT(record.window_start)} — {formatDateSGT(record.window_end)}
              </span>
              <span className="profile-chip">最近评估 {formatSGT(record.created_at)}</span>
            </div>
            <h2 className="profile-headline">画像摘要</h2>
            <p className="profile-summary">{profile.profileSummary}</p>
            <p className="profile-trigger-note">
              通过 GitHub Actions → <strong>Evaluate Doctors</strong> → Run workflow 触发，输入医生邮箱或 UUID。历史记录保留，每次运行追加。
            </p>
          </div>

          <FieldCompletenessCard profile={profile} />
          <AiThemesCard profile={profile} />
          <StrengthsCard profile={profile} />
          <GapsCard profile={profile} />
          <GuidanceCard profile={profile} />
        </>
      )}
    </div>
  );
}
