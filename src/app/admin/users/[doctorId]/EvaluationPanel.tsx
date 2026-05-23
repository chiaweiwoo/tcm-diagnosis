"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart2, Compass, Lightbulb, MessageSquare, Sparkles, Users } from "lucide-react";
import type { DoctorProfile, PatientDistribution } from "@/lib/analytics/evaluation";

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
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
  const array = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []);

  const fieldCompleteness = array("fieldCompleteness")
    .map((item) => {
      const row = asRecord(item);
      const ratio = parseLegacyRatio(asString(row.presentIn));
      return {
        field: asString(row.field),
        label: asString(row.label) || asString(row.field),
        filled: asNumber(row.filled) || ratio.filled,
        total: asNumber(row.total) || ratio.total,
        rate: asNumber(row.rate) || ratio.rate,
      };
    })
    .filter((item) => item.label);

  const aiRecurringThemes = array("aiRecurringThemes")
    .map((item) => {
      const row = asRecord(item);
      return {
        theme: asString(row.theme),
        frequency: asString(row.frequency),
        caseNumbers: asCaseNumbers(row.caseNumbers),
      };
    })
    .filter((item) => item.theme);

  function normalizeScored(key: string): Array<{ text: string; score: number }> {
    return array(key).map((item, i, arr) => {
      const fallback = Math.round(80 - (i / Math.max(arr.length - 1, 1)) * 40);
      if (typeof item === "string") return { text: item, score: fallback };
      const row = asRecord(item);
      return {
        text: asString(row.text) || asString(row.strength),
        score: typeof row.score === "number" ? row.score : fallback,
      };
    }).filter((item) => item.text);
  }

  const strengths = normalizeScored("strengths");

  const gaps = array("gaps")
    .map((item, i, arr) => {
      const row = asRecord(item);
      const ratio = parseLegacyRatio(asString(row.presentIn) || asString(row.frequency));
      const fallback = Math.round(80 - (i / Math.max(arr.length - 1, 1)) * 40);
      return {
        field: asString(row.field) || asString(row.gap),
        inputRate: asNumber(row.inputRate) || ratio.rate,
        aiAskRate: asNumber(row.aiAskRate),
        evidence: asString(row.evidence),
        caseNumbers: asCaseNumbers(row.caseNumbers),
        guidanceHint: asString(row.guidanceHint),
        score: typeof row.score === "number" ? row.score : fallback,
      };
    })
    .filter((item) => item.field || item.evidence || item.guidanceHint);

  const guidancePoints = normalizeScored("guidancePoints");

  const keyObservations: Array<{ text: string; score: number }> = array("keyObservations").map((item, i, arr) => {
    const fallback = Math.round(80 - (i / Math.max(arr.length - 1, 1)) * 40);
    if (typeof item === "string") return { text: item, score: fallback };
    const row = asRecord(item);
    return {
      text: asString(row.text),
      score: typeof row.score === "number" ? row.score : fallback,
    };
  }).filter((item) => item.text);

  function draftStrings(key: string): string[] {
    return array(key).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  function draftToScored(items: string[]): Array<{ text: string; score: number }> {
    return items.map((text, i, arr) => ({ text, score: Math.round(80 - (i / Math.max(arr.length - 1, 1)) * 40) }));
  }

  const draftMainCaseTypes = draftStrings("mainCaseTypes");
  const draftTreatmentStyle = draftStrings("treatmentStyle");
  const draftRiskThemes = draftStrings("aiMedicalRiskThemes");
  const draftDiscussion = draftStrings("discussionDirections");
  const draftConversation = draftStrings("conversationReference");

  // patientDistribution — only present in v1.3+
  const pdRaw = raw.patientDistribution;
  let patientDistribution: PatientDistribution | null = null;
  if (pdRaw && typeof pdRaw === "object") {
    const pd = pdRaw as Record<string, unknown>;
    const sexRaw = asRecord(pd.sex);
    const ageBuckets = Array.isArray(pd.ageBuckets)
      ? (pd.ageBuckets as unknown[]).map((b) => {
          const br = asRecord(b);
          return {
            label: asString(br.label),
            range: asString(br.range),
            count: asNumber(br.count),
          };
        })
      : [];
    const prescriptionTypes = Array.isArray(pd.prescriptionTypes)
      ? (pd.prescriptionTypes as unknown[]).map((p) => {
          const pr = asRecord(p);
          return { type: asString(pr.type), count: asNumber(pr.count) };
        })
      : [];
    patientDistribution = {
      sex: { male: asNumber(sexRaw.male), female: asNumber(sexRaw.female) },
      ageBuckets,
      prescriptionTypes,
      total: asNumber(pd.total),
    };
  }

  return {
    profileSummary: asString(raw.profileSummary) || asString(raw.clinicalSummary) || "暂无可展示的画像摘要。",
    keyObservations: keyObservations.length
      ? keyObservations
      : draftToScored([...draftMainCaseTypes, ...draftTreatmentStyle]),
    patientDistribution,
    fieldCompleteness,
    aiRecurringThemes: aiRecurringThemes.length
      ? aiRecurringThemes
      : draftRiskThemes.map((theme) => ({ theme, frequency: "", caseNumbers: [] })),
    strengths: strengths.length ? strengths : draftToScored(draftStrings("strengths")),
    gaps: gaps.length
      ? gaps
      : draftDiscussion.map((text, index, arr) => ({
          field: `discussion_${index + 1}`,
          inputRate: 0,
          aiAskRate: 0,
          evidence: text,
          caseNumbers: [],
          guidanceHint: "",
          score: Math.round(80 - (index / Math.max(arr.length - 1, 1)) * 40),
        })),
    guidancePoints: guidancePoints.length ? guidancePoints : draftToScored(draftConversation),
  };
}

function formatRate(rate: number) {
  return `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Help tooltip — uses data-tooltip for CSS-driven tooltip
// ---------------------------------------------------------------------------

function HelpTip({ text }: { text: string }) {
  return (
    <span className="profile-help-tip" data-tooltip={text} aria-label={text}>
      ?
    </span>
  );
}

// ---------------------------------------------------------------------------
// Score bar row — full-width proportional bar (label · bar · number)
// ---------------------------------------------------------------------------

function ProfileListItem({
  text,
  score,
  cardClass,
  hint,
}: {
  text: string;
  score: number;
  cardClass: string;
  hint?: string;
}) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="profile-list-row">
      <div className={`profile-list-item-line ${cardClass}`}>
        <span className="profile-list-main">{text}</span>
        <span className="profile-score-track" aria-label={`AI 信号强度：${pct}`}>
          <span className="profile-score-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="profile-score-value">{pct}</span>
      </div>
      {hint && <span className="profile-list-hint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG donut chart
// ---------------------------------------------------------------------------

const DONUT_R = 38;
const DONUT_C = 2 * Math.PI * DONUT_R;

type DonutSegment = { label: string; count: number; color: string };

function DonutChart({ segments, title, displayTotal }: {
  segments: DonutSegment[];
  title: string;
  displayTotal: number;
}) {
  const segTotal = segments.reduce((s, seg) => s + seg.count, 0);
  let deg = -90;

  return (
    <div className="profile-donut">
      <p className="profile-donut-title">{title}</p>
      <svg className="profile-donut-svg" viewBox="0 0 100 100" aria-hidden="true">
        {/* Track */}
        <circle cx={50} cy={50} r={DONUT_R} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={11} />
        {segTotal > 0 && segments.map((seg, i) => {
          if (seg.count === 0) return null;
          const fraction = seg.count / segTotal;
          const segLen = Math.max(0, fraction * DONUT_C - 1.5);
          const rotation = deg;
          deg += fraction * 360;
          return (
            <circle
              key={i}
              cx={50} cy={50} r={DONUT_R}
              fill="none"
              stroke={seg.color}
              strokeWidth={11}
              strokeDasharray={`${segLen} ${DONUT_C}`}
              style={{ transform: `rotate(${rotation}deg)`, transformOrigin: "50px 50px" }}
            />
          );
        })}
        <text x={50} y={46} textAnchor="middle" fontSize={17} fontWeight={700} fill="#1A1A1A">{displayTotal}</text>
        <text x={50} y={60} textAnchor="middle" fontSize={9} fill="#6B6B6B">例</text>
      </svg>
      <div className="profile-donut-legend">
        {segments.filter((s) => s.count > 0).map((seg, i) => (
          <div key={i} className="profile-donut-legend-item">
            <span className="profile-donut-dot" style={{ background: seg.color }} />
            <span className="profile-donut-name">{seg.label}</span>
            <span className="profile-donut-count">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time-series bar chart — daily consultation count, past 30 days
// ---------------------------------------------------------------------------

const TS_BAR_W   = 11;   // bar width px
const TS_GAP     = 3;    // gap between bars
const TS_STEP    = TS_BAR_W + TS_GAP;   // 14 px per day
const TS_N       = 30;   // days shown
const TS_H       = 72;   // chart area height
const TS_TOP_H    = 16;   // extra space at the top for count annotations
const TS_XLBL_H  = 20;   // x-axis label area
const TS_W       = TS_N * TS_STEP - TS_GAP;  // total chart width

type DayBucket = { key: string; label: string; count: number; isToday: boolean; isMonday: boolean };

function tsDayKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function buildDayBuckets(dates: string[]): DayBucket[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = tsDayKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const nowMs = Date.now() + 8 * 3600_000;
  const todayD = new Date(nowMs);
  const todayKey = `${todayD.getUTCFullYear()}-${String(todayD.getUTCMonth() + 1).padStart(2, "0")}-${String(todayD.getUTCDate()).padStart(2, "0")}`;

  const buckets: DayBucket[] = [];
  for (let i = TS_N - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 86_400_000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const key = `${d.getUTCFullYear()}-${mm}-${dd}`;
    buckets.push({
      key,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      count: counts.get(key) ?? 0,
      isToday: key === todayKey,
      isMonday: d.getUTCDay() === 1,
    });
  }
  return buckets;
}

function TimeSeriesCard({ doctorId }: { doctorId: string }) {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/analytics/evaluate/${doctorId}/timeseries`)
      .then((r) => r.ok ? r.json() as Promise<{ dates: string[] }> : Promise.reject())
      .then((j) => setDates(j.dates))
      .catch(() => { /* non-critical */ })
      .finally(() => setLoading(false));
  }, [doctorId]);

  const buckets = useMemo(() => buildDayBuckets(dates), [dates]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="profile-card profile-card--subtle">
      <h3 className="profile-card-title">
        <BarChart2 size={15} /> 近期记录背景
        <HelpTip text="近期每日记录节奏，仅作为阅读背景。" />
      </h3>
      {loading ? (
        <p className="profile-empty">加载中…</p>
      ) : (
        <div className="profile-ts-wrap">
          <svg
            className="profile-ts-svg"
            viewBox={`0 ${-TS_TOP_H} ${TS_W} ${TS_TOP_H + TS_H + TS_XLBL_H}`}
            aria-label="近30天每日病案数柱状图"
          >
            {/* Baseline */}
            <line x1={0} y1={TS_H} x2={TS_W} y2={TS_H} className="profile-ts-baseline" />

            {buckets.map((b, i) => {
              const x   = i * TS_STEP;
              const barH = b.count === 0 ? 2 : Math.max(3, Math.round((b.count / maxCount) * TS_H));
              const y   = TS_H - barH;
              const sepX = x - TS_GAP / 2;   // separator sits in the gap before this bar

              return (
                <g key={b.key}>
                  {/* Week boundary: dotted vertical line before Monday */}
                  {b.isMonday && i > 0 && (
                    <>
                      <line
                        x1={sepX} y1={0}
                        x2={sepX} y2={TS_H}
                        className="profile-ts-sep"
                      />
                      {/* Monday date label below the separator */}
                      <text
                        x={x + TS_BAR_W / 2}
                        y={TS_H + 14}
                        textAnchor="middle"
                        className="profile-ts-xlabel"
                      >
                        {b.label}
                      </text>
                    </>
                  )}

                  {/* Bar */}
                  <rect
                    x={x}
                    y={y}
                    width={TS_BAR_W}
                    height={barH}
                    rx={b.count === 0 ? 1 : 2}
                    className={[
                      "profile-ts-bar",
                      b.count === 0  ? "profile-ts-bar--empty"   : "",
                      b.isToday      ? "profile-ts-bar--today"   : "",
                    ].join(" ")}
                  >
                    <title>{`${b.label}：${b.count} 例`}</title>
                  </rect>

                  {/* Count annotation above the bar */}
                  {b.count > 0 && (
                    <text
                      x={x + TS_BAR_W / 2}
                      y={y - 4}
                      textAnchor="middle"
                      fontSize={9}
                      fill={b.isToday ? "#9B2226" : "#6B6B6B"}
                      fontWeight={b.isToday ? 700 : 500}
                    >
                      {b.count}
                    </text>
                  )}
                </g>
              );
            })}

            {/* "今" label under today */}
            {(() => {
              const todayIdx = buckets.length - 1;
              const x = todayIdx * TS_STEP + TS_BAR_W / 2;
              return (
                <text x={x} y={TS_H + 14} textAnchor="middle" className="profile-ts-xlabel profile-ts-xlabel--today">
                  今
                </text>
              );
            })()}
          </svg>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient distribution card — 3 donut charts
// ---------------------------------------------------------------------------

const AGE_COLORS = ["#3B7A7A", "#5BA0A0", "#8CC8C8", "#B3DADA"];
const RX_COLORS  = ["#7B6FA0", "#9B2226", "#B07555", "#5C7B5C"];

function PatientDistributionCard({ distribution }: { distribution: PatientDistribution }) {
  const { sex, ageBuckets, prescriptionTypes, total } = distribution;

  const sexSegments: DonutSegment[] = [
    { label: "男", count: sex.male,   color: "#5B8DB8" },
    { label: "女", count: sex.female, color: "#C27B8E" },
  ];

  const ageSegments: DonutSegment[] = ageBuckets
    .filter((b) => b.count > 0)
    .map((b, i) => ({ label: b.label, count: b.count, color: AGE_COLORS[i % AGE_COLORS.length] }));

  const rxSegments: DonutSegment[] = prescriptionTypes.map((p, i) => ({
    label: p.type,
    count: p.count,
    color: RX_COLORS[i % RX_COLORS.length],
  }));

  return (
    <div className="profile-card profile-card--teal">
      <h3 className="profile-card-title">
        <Users size={15} /> 病案分布
        <HelpTip text="该医生最近窗口内病案的患者画像分布" />
      </h3>
      <div className="profile-donuts">
        <DonutChart segments={sexSegments} title="性别" displayTotal={total} />
        <DonutChart segments={ageSegments} title="年龄" displayTotal={total} />
        <DonutChart segments={rxSegments}  title="处方" displayTotal={total} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clinical observations
// ---------------------------------------------------------------------------

function ClinicalObservationCard({ profile }: { profile: DoctorProfile }) {
  const sorted = [...profile.keyObservations].sort((a, b) => b.score - a.score);
  return (
    <div className="profile-card profile-card--sage">
      <h3 className="profile-card-title">
        <Sparkles size={15} /> 临床观察
        <HelpTip text="根据近期病案整理出的主要病例类型与诊疗风格。" />
      </h3>
      {sorted.length === 0 ? (
        <p className="profile-empty">本期暂无明确临床观察</p>
      ) : (
        <div className="profile-list">
          {sorted.map((item, index) => (
            <ProfileListItem key={index} text={item.text} score={item.score} cardClass="profile-score-bar--sage" />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI themes chip cloud
// ---------------------------------------------------------------------------

function themeChipSize(frequency: string): string {
  const match = frequency.match(/\((\d+)%\)/);
  if (!match) return "profile-theme-chip--sm";
  const pct = parseInt(match[1], 10);
  if (pct >= 50) return "profile-theme-chip--lg";
  if (pct >= 30) return "profile-theme-chip--md";
  return "profile-theme-chip--sm";
}

function AiThemesCard({ profile }: { profile: DoctorProfile }) {
  if (profile.aiRecurringThemes.length === 0) {
    return (
      <div className="profile-card profile-card--gold">
        <h3 className="profile-card-title">
          <Lightbulb size={15} /> 反复提醒的风险点
          <HelpTip text="系统在近期病案中反复提示、值得医生留意的医学风险。" />
        </h3>
        <p className="profile-empty">本期暂无明显重复风险点</p>
      </div>
    );
  }

  return (
    <div className="profile-card profile-card--gold">
      <h3 className="profile-card-title">
        <Lightbulb size={15} /> 反复提醒的风险点
        <HelpTip text="系统在近期病案中反复提示、值得医生留意的医学风险。" />
      </h3>
      <div className="profile-theme-cloud">
        {profile.aiRecurringThemes.map((item) => (
          <span
            key={item.theme}
            className="profile-theme-chip"
          >
            {item.theme}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strengths
// ---------------------------------------------------------------------------

function StrengthsCard({ profile }: { profile: DoctorProfile }) {
  const sorted = [...profile.strengths].sort((a, b) => b.score - a.score);
  return (
    <div className="profile-card profile-card--sage">
      <h3 className="profile-card-title">
        <Sparkles size={15} /> 可取之处
        <HelpTip text="近期病案中值得肯定、可以延续的临床工作特点。" />
      </h3>
      {sorted.length === 0 ? (
        <p className="profile-empty">本期暂未识别到有据可查的突出优势</p>
      ) : (
        <div className="profile-list">
          {sorted.map((item, index) => (
            <ProfileListItem key={index} text={item.text} score={item.score} cardClass="profile-score-bar--sage" />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

function GapsCard({ profile }: { profile: DoctorProfile }) {
  const sorted = [...profile.gaps].sort((a, b) => b.score - a.score);
  return (
    <div className="profile-card profile-card--tan">
      <h3 className="profile-card-title">
        <Compass size={15} /> 可讨论方向
        <HelpTip text="适合在复盘中温和讨论的临床或记录习惯方向。" />
      </h3>
      {sorted.length === 0 ? (
        <p className="profile-empty">本期暂无明确可讨论方向</p>
      ) : (
        <div className="profile-list">
          {sorted.map((item, index) => (
            <ProfileListItem
              key={index}
              text={item.evidence || item.field}
              score={item.score}
              cardClass="profile-score-bar--tan"
              hint={item.guidanceHint || undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

function GuidanceCard({ profile }: { profile: DoctorProfile }) {
  const sorted = [...profile.guidancePoints].sort((a, b) => b.score - a.score);
  return (
    <div className="profile-card profile-card--ink">
      <h3 className="profile-card-title">
        <MessageSquare size={15} /> 沟通提示
        <HelpTip text="面向医生复盘时可直接使用的温和沟通话术。" />
      </h3>
      {sorted.length === 0 ? (
        <p className="profile-empty">本期暂无具体沟通提示</p>
      ) : (
        <div className="profile-list">
          {sorted.map((item, index) => (
            <ProfileListItem key={index} text={item.text} score={item.score} cardClass="profile-score-bar--ink" />
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
              <span className="profile-chip">
                {formatDateSGT(record.window_start)} — {formatDateSGT(record.window_end)}
              </span>
              <span className="profile-chip">最近评估 {formatSGT(record.created_at)}</span>
            </div>
            <h2 className="profile-headline">画像摘要</h2>
            <p className="profile-summary">{profile.profileSummary}</p>
          </div>

          <section className="profile-section">
            <h2 className="profile-section-title">描述性分析</h2>
            <TimeSeriesCard doctorId={doctorId} />
            <div className="profile-cards-grid profile-cards-grid--two">
              <ClinicalObservationCard profile={profile} />
              <AiThemesCard profile={profile} />
            </div>
          </section>

          <section className="profile-section">
            <h2 className="profile-section-title">复盘与沟通</h2>
            <div className="profile-cards-grid profile-cards-grid--two">
              <StrengthsCard profile={profile} />
              <GapsCard profile={profile} />
            </div>
            <GuidanceCard profile={profile} />
          </section>
        </>
      )}
    </div>
  );
}
