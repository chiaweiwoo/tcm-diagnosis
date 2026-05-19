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

  const strengths = array("strengths")
    .map((item) => {
      const row = asRecord(item);
      return { text: asString(row.text) || asString(row.strength) };
    })
    .filter((item) => item.text);

  const gaps = array("gaps")
    .map((item) => {
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
    })
    .filter((item) => item.field || item.evidence || item.guidanceHint);

  const rawGuidance = array("guidancePoints");
  const guidancePoints = rawGuidance
    .map((item) => {
      if (typeof item === "string") return { text: item };
      const row = asRecord(item);
      return { text: asString(row.text) };
    })
    .filter((item) => item.text);

  const keyObservations = array("keyObservations").filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );

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
    profileSummary: asString(raw.profileSummary) || "暂无可展示的画像摘要。",
    keyObservations,
    patientDistribution,
    fieldCompleteness,
    aiRecurringThemes,
    strengths,
    gaps,
    guidancePoints,
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
// Time-series bar chart — consultation count by week
// ---------------------------------------------------------------------------

const BAR_W = 16;
const BAR_GAP = 5;
const CHART_H = 72;
const N_WEEKS = 16;

/** Return the Monday (SGT) of the ISO week containing a UTC timestamp string. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  // Shift to SGT (+8h) before computing Monday
  d.setTime(d.getTime() + 8 * 60 * 60 * 1000);
  const day = d.getUTCDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMon);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`; // sortable key = Monday date
}

/** Format "2025-05-19" → "5/19" */
function shortDate(key: string): string {
  const [, m, d] = key.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

function buildWeekBuckets(dates: string[]): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = weekKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Last N_WEEKS mondays ending this week
  const now = new Date();
  now.setTime(now.getTime() + 8 * 60 * 60 * 1000);
  const thisDay = now.getUTCDay();
  const diffToMon = thisDay === 0 ? -6 : 1 - thisDay;
  now.setUTCDate(now.getUTCDate() + diffToMon);

  const buckets = [];
  for (let i = N_WEEKS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const key = `${d.getUTCFullYear()}-${mm}-${dd}`;
    buckets.push({ key, label: shortDate(key), count: counts.get(key) ?? 0 });
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
      .catch(() => {/* silently skip — chart is non-critical */})
      .finally(() => setLoading(false));
  }, [doctorId]);

  const buckets = useMemo(() => buildWeekBuckets(dates), [dates]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const totalInRange = buckets.reduce((s, b) => s + b.count, 0);

  const chartW = N_WEEKS * (BAR_W + BAR_GAP) - BAR_GAP;

  return (
    <div className="profile-card profile-card--brand">
      <h3 className="profile-card-title">
        <BarChart2 size={15} /> 病案趋势
        <HelpTip text="近16周每周分析病案数（新加坡时区）" />
        <span className="profile-ts-total">共 {totalInRange} 例</span>
      </h3>
      {loading ? (
        <p className="profile-empty">加载中…</p>
      ) : (
        <div className="profile-ts-wrap">
          <svg
            className="profile-ts-svg"
            viewBox={`0 0 ${chartW} ${CHART_H + 24}`}
            aria-label="每周病案数柱状图"
          >
            {buckets.map((b, i) => {
              const x = i * (BAR_W + BAR_GAP);
              const barH = b.count === 0 ? 2 : Math.max(4, (b.count / maxCount) * CHART_H);
              const y = CHART_H - barH;
              const isCurrentWeek = i === N_WEEKS - 1;
              return (
                <g key={b.key}>
                  <rect
                    x={x}
                    y={y}
                    width={BAR_W}
                    height={barH}
                    rx={3}
                    className={`profile-ts-bar ${b.count === 0 ? "profile-ts-bar--empty" : ""} ${isCurrentWeek ? "profile-ts-bar--current" : ""}`}
                  >
                    <title>{`${b.label}：${b.count} 例`}</title>
                  </rect>
                  {/* count label on bar if > 0 */}
                  {b.count > 0 && barH > 18 && (
                    <text
                      x={x + BAR_W / 2}
                      y={y + 12}
                      textAnchor="middle"
                      className="profile-ts-count-label"
                    >
                      {b.count}
                    </text>
                  )}
                  {/* x-axis label — every 4th week + last */}
                  {(i % 4 === 0 || i === N_WEEKS - 1) && (
                    <text
                      x={x + BAR_W / 2}
                      y={CHART_H + 16}
                      textAnchor="middle"
                      className="profile-ts-xlabel"
                    >
                      {b.label}
                    </text>
                  )}
                </g>
              );
            })}
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
          <Lightbulb size={15} /> AI关注的主题
          <HelpTip text="AI 在医生病案输出中反复出现的关注点" />
        </h3>
        <p className="profile-empty">本期暂无明显重复主题</p>
      </div>
    );
  }

  return (
    <div className="profile-card profile-card--gold">
      <h3 className="profile-card-title">
        <Lightbulb size={15} /> AI关注的主题
        <HelpTip text="AI 在医生病案输出中反复出现的关注点" />
      </h3>
      <div className="profile-theme-cloud">
        {profile.aiRecurringThemes.map((item) => (
          <span
            key={item.theme}
            className={`profile-theme-chip ${themeChipSize(item.frequency)}`}
            title={item.frequency}
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
  return (
    <div className="profile-card profile-card--sage">
      <h3 className="profile-card-title">
        <Sparkles size={15} /> 可取之处
        <HelpTip text="通过确定性信号识别的记录习惯亮点" />
      </h3>
      {profile.strengths.length === 0 ? (
        <p className="profile-empty">本期暂未识别到有据可查的突出优势</p>
      ) : (
        <div className="profile-list">
          {profile.strengths.map((item, index) => (
            <div key={index} className="profile-list-row">
              <span className="profile-list-main">{item.text}</span>
            </div>
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
  return (
    <div className="profile-card profile-card--tan">
      <h3 className="profile-card-title">
        <Compass size={15} /> 差距识别
        <HelpTip text="医生填写率 < 70% 且 AI 多次（≥30%）提醒补充的字段" />
      </h3>
      {profile.gaps.length === 0 ? (
        <p className="profile-empty">本期暂无符合双证据规则的差距</p>
      ) : (
        <div className="profile-list">
          {profile.gaps.map((item, index) => (
            <div key={index} className="profile-list-row">
              <span className="profile-list-main">{item.evidence || item.field}</span>
              <span className="profile-list-sub">
                输入 {formatRate(item.inputRate)} · AI提醒 {formatRate(item.aiAskRate)}
              </span>
              {item.guidanceHint && (
                <span className="profile-list-hint">💬 {item.guidanceHint}</span>
              )}
            </div>
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
  return (
    <div className="profile-card profile-card--ink">
      <h3 className="profile-card-title">
        <MessageSquare size={15} /> 对话参考
        <HelpTip text="面向管理员的对话建议，可在沟通中使用" />
      </h3>
      {profile.guidancePoints.length === 0 ? (
        <p className="profile-empty">本期暂无具体对话建议</p>
      ) : (
        <div className="profile-list">
          {profile.guidancePoints.map((item, index) => (
            <div key={index} className="profile-list-row">
              <span className="profile-list-main">{item.text}</span>
            </div>
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
              <span className="profile-chip">{record.consultation_count} 例样本</span>
              <span className="profile-chip">
                {formatDateSGT(record.window_start)} — {formatDateSGT(record.window_end)}
              </span>
              <span className="profile-chip">最近评估 {formatSGT(record.created_at)}</span>
            </div>
            <h2 className="profile-headline">画像摘要</h2>
            <p className="profile-summary">{profile.profileSummary}</p>
            {profile.keyObservations.length > 0 && (
              <ul className="profile-observations">
                {profile.keyObservations.map((obs, i) => (
                  <li key={i}>{obs}</li>
                ))}
              </ul>
            )}
          </div>

          <TimeSeriesCard doctorId={doctorId} />

          {profile.patientDistribution && profile.patientDistribution.total > 0 && (
            <PatientDistributionCard distribution={profile.patientDistribution} />
          )}

          <div className="profile-cards-grid">
            <AiThemesCard profile={profile} />
            <StrengthsCard profile={profile} />
            <GapsCard profile={profile} />
            <GuidanceCard profile={profile} />
          </div>
        </>
      )}
    </div>
  );
}
