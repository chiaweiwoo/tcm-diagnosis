"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { DoctorProfileSnapshot, FlaggedCase, PrescriptionCluster, RuleKey } from "@/lib/analytics/doctorProfile";

export type ProfileData = {
  snapshot: DoctorProfileSnapshot;
  flagged: FlaggedCase[];
  clusters: PrescriptionCluster[];
};

const RULE_ORDER: RuleKey[] = [
  "criticalRisk",
  "nonClinical",
  "needsReviewHigh",
  "physicalExamShort",
  "currentIllnessShort",
];

const LOW_SAMPLE_THRESHOLD = 20;

function SignalRow({ label, rate }: { label: string; rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <div className="profile-signal-row">
      <span className="profile-signal-label">{label}</span>
      <div className="profile-signal-bar-wrap">
        <div className="profile-signal-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="profile-signal-pct">{(rate * 100).toFixed(1)}%</span>
    </div>
  );
}

function FlagGroup({
  ruleKey,
  cases,
  doctorId,
}: {
  ruleKey: RuleKey;
  cases: FlaggedCase[];
  doctorId: string;
}) {
  if (cases.length === 0) return null;
  const isCritical = ruleKey === "criticalRisk";
  return (
    <div className={`profile-flag-group${isCritical ? " profile-flag-group--critical" : ""}`}>
      <div className="profile-flag-head">
        <span className="profile-flag-label">{cases[0].ruleLabel}</span>
        <span className="profile-flag-count">{cases.length} 条</span>
      </div>
      {cases.map((c) => (
        <div
          key={c.id}
          className="profile-flag-row profile-flag-row--clickable"
          onClick={() => window.open(`/?viewAs=${doctorId}`, "_blank")}
          title="在新标签页中查看医生工作台"
        >
          <span className="profile-flag-date">{c.date}</span>
          <span className="profile-flag-name">{c.displayName}</span>
          <span className="profile-flag-evidence">{c.evidence}</span>
        </div>
      ))}
    </div>
  );
}

function ClusterGroup({ cluster }: { cluster: PrescriptionCluster }) {
  return (
    <div className="profile-cluster-group">
      <div className="profile-cluster-head">
        <span className="profile-cluster-label">{cluster.label}</span>
        <span className="profile-cluster-n">{cluster.n} 例处方高度相似</span>
      </div>
    </div>
  );
}

function ProfileBody({
  doctorId,
  data,
}: {
  doctorId: string;
  data: ProfileData | "loading" | "error";
}) {
  if (data === "loading") {
    return (
      <div className="profile-overlay-shimmer">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="profile-overlay-shimmer-row">
            <div className="profile-overlay-shimmer-line" style={{ width: "55%", height: 13 }} />
            <div className="profile-overlay-shimmer-line" style={{ width: "80%", height: 11 }} />
            <div className="profile-overlay-shimmer-line" style={{ width: "40%", height: 11 }} />
          </div>
        ))}
      </div>
    );
  }

  if (data === "error") {
    return <div className="profile-overlay-empty">加载失败，请关闭后重试。</div>;
  }

  const { snapshot, flagged, clusters } = data;

  if (snapshot.totalAnalyzed === 0) {
    return <div className="profile-overlay-empty">该医生暂无已分析病案。</div>;
  }

  const byRule = new Map<RuleKey, FlaggedCase[]>(RULE_ORDER.map((k) => [k, []]));
  for (const c of flagged) {
    byRule.get(c.ruleKey)?.push(c);
  }
  const hasFlags = flagged.length > 0 || clusters.length > 0;
  const isLowSample = snapshot.totalAnalyzed < LOW_SAMPLE_THRESHOLD;

  return (
    <div className="profile-overlay-body">
      <div className="profile-overlay-section-head">质量信号</div>
      <div className="profile-strip">
        <SignalRow label="辨证警示触发率" rate={snapshot.criticalRiskRate} />
        <SignalRow label="非临床信息出现率" rate={snapshot.nonClinicalRate} />
        <SignalRow label="风险有实质内容率" rate={snapshot.realCautionsRate} />
      </div>

      <div className="profile-overlay-section-head" style={{ marginTop: 20 }}>
        待关注病案
        {isLowSample && (
          <span className="profile-section__head-note">
            {" "}（样本不足 {LOW_SAMPLE_THRESHOLD} 例，仅显示绝对信号）
          </span>
        )}
      </div>
      <div className="profile-flags">
        {!hasFlags && (
          <div className="profile-flags-empty">暂未发现需要关注的信号。</div>
        )}
        {RULE_ORDER.map((ruleKey) => (
          <FlagGroup
            key={ruleKey}
            ruleKey={ruleKey}
            cases={byRule.get(ruleKey) ?? []}
            doctorId={doctorId}
          />
        ))}
        {clusters.length > 0 && (
          <div className="profile-cluster-wrap">
            <div className="profile-cluster-section-head">处方高度重复（AI 分析）</div>
            {clusters.map((c, i) => (
              <ClusterGroup key={i} cluster={c} />
            ))}
          </div>
        )}
      </div>

      <p className="profile-meta">
        数据范围：{fmtDate(snapshot.oldestAnalyzedAt)} — {fmtDate(snapshot.latestAnalyzedAt)}
        {" · "}{snapshot.totalAnalyzed} 条已分析
      </p>
    </div>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function ProfileOverlay({
  doctorId,
  doctorEmail,
  data,
  onClose,
}: {
  doctorId: string;
  doctorEmail: string;
  data: ProfileData | "loading" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="profile-overlay-backdrop" onClick={onClose}>
      <div className="profile-overlay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-overlay-head">
          <div className="profile-overlay-head-left">
            <span className="profile-overlay-title">评估快照</span>
            <span className="profile-overlay-email">{doctorEmail}</span>
          </div>
          <button className="profile-overlay-close" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <ProfileBody doctorId={doctorId} data={data} />
      </div>
    </div>
  );
}
