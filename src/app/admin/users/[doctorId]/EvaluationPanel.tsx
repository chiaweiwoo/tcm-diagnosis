"use client";

import { useEffect, useState } from "react";
import { Compass, Lightbulb, MessageSquare, Sparkles, Users } from "lucide-react";
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
// Help tooltip
// ---------------------------------------------------------------------------

function HelpTip({ text }: { text: string }) {
  return (
    <span className="profile-help-tip" title={text} aria-label={text}>
      ?
    </span>
  );
}

// ---------------------------------------------------------------------------
// Patient distribution card (new)
// ---------------------------------------------------------------------------

function PatientDistributionCard({ distribution }: { distribution: PatientDistribution }) {
  const { sex, ageBuckets, prescriptionTypes, total } = distribution;

  const sexItems = [
    { label: "男", count: sex.male, cls: "profile-dist-bar--male" },
    { label: "女", count: sex.female, cls: "profile-dist-bar--female" },
  ];

  return (
    <div className="profile-card profile-card--teal">
      <h3 className="profile-card-title">
        <Users size={15} /> 病案分布
        <HelpTip text="该医生最近窗口内病案的患者画像分布" />
      </h3>
      <div className="profile-dist-grid">
        <div className="profile-dist-section">
          <span className="profile-dist-label">性别</span>
          <div className="profile-dist-bars">
            {sexItems.map((item) => (
              <div key={item.label} className="profile-dist-row">
                <span className="profile-dist-name">{item.label}</span>
                <div className="profile-dist-track">
                  <div
                    className={`profile-dist-fill ${item.cls}`}
                    style={{ width: total > 0 ? `${Math.round((item.count / total) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="profile-dist-count">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="profile-dist-section">
          <span className="profile-dist-label">年龄</span>
          <div className="profile-dist-bars">
            {ageBuckets.filter((b) => b.count > 0).map((b) => (
              <div key={b.label} className="profile-dist-row">
                <span className="profile-dist-name">{b.label}</span>
                <div className="profile-dist-track">
                  <div
                    className="profile-dist-fill profile-dist-bar--age"
                    style={{ width: total > 0 ? `${Math.round((b.count / total) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="profile-dist-count">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="profile-dist-section">
          <span className="profile-dist-label">处方</span>
          <div className="profile-dist-bars">
            {prescriptionTypes.map((p) => (
              <div key={p.type} className="profile-dist-row">
                <span className="profile-dist-name">{p.type}</span>
                <div className="profile-dist-track">
                  <div
                    className="profile-dist-fill profile-dist-bar--rx"
                    style={{ width: total > 0 ? `${Math.round((p.count / total) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="profile-dist-count">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
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
            <p className="profile-trigger-note">
              通过 GitHub Actions → <strong>Evaluate Doctors</strong> → Run workflow 触发，输入医生邮箱或 UUID。历史记录保留，每次运行追加。
            </p>
          </div>

          {profile.patientDistribution && profile.patientDistribution.total > 0 && (
            <PatientDistributionCard distribution={profile.patientDistribution} />
          )}
          <AiThemesCard profile={profile} />
          <StrengthsCard profile={profile} />
          <GapsCard profile={profile} />
          <GuidanceCard profile={profile} />
        </>
      )}
    </div>
  );
}
