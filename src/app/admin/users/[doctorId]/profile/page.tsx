import Link from "next/link";
import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  computeDoctorProfile,
  findFlaggedCases,
  LOW_SAMPLE_THRESHOLD,
  type DoctorProfileSnapshot,
  type FlaggedCase,
  type FlaggedCasesResult,
  type PrescriptionCluster,
  type RuleKey,
} from "@/lib/analytics/doctorProfile";
import { DoctorSubNav } from "../DoctorSubNav";

type RouteContext = {
  params: Promise<{ doctorId: string }>;
};

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatSGT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function pctStr(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

// ─── Header strip (aggregates) ────────────────────────────────────────────────

function SignalRow({ label, rate }: { label: string; rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <div className="profile-signal-row">
      <span className="profile-signal-label">{label}</span>
      <div className="profile-signal-bar-wrap">
        <div className="profile-signal-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="profile-signal-pct">{pctStr(rate)}</span>
    </div>
  );
}

function HeaderStrip({ snapshot }: { snapshot: DoctorProfileSnapshot }) {
  return (
    <div className="profile-section profile-strip">
      <SignalRow label="辨证警示触发率" rate={snapshot.criticalRiskRate} />
      <SignalRow label="非临床信息出现率" rate={snapshot.nonClinicalRate} />
      <SignalRow label="风险有实质内容率" rate={snapshot.realCautionsRate} />
    </div>
  );
}

// ─── Flagged case rows ────────────────────────────────────────────────────────

const RULE_ORDER: RuleKey[] = [
  "criticalRisk",
  "nonClinical",
  "needsReviewHigh",
  "physicalExamShort",
  "currentIllnessShort",
];

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
        <div key={c.id} className="profile-flag-row">
          <span className="profile-flag-name">{c.displayName}</span>
          <span className="profile-flag-evidence">{c.evidence}</span>
          <span className="profile-flag-date">{c.date}</span>
          <Link
            href={`/?viewAs=${doctorId}`}
            className="profile-flag-link"
            title="在医生工作台中查看"
          >
            查看
          </Link>
        </div>
      ))}
    </div>
  );
}

function ClusterGroup({
  cluster,
  doctorId,
}: {
  cluster: PrescriptionCluster;
  doctorId: string;
}) {
  return (
    <div className="profile-cluster-group">
      <div className="profile-cluster-head">
        <span className="profile-cluster-label">{cluster.label}</span>
        <span className="profile-cluster-n">{cluster.n} 例处方高度相似</span>
      </div>
      <div className="profile-cluster-body">
        <Link href={`/?viewAs=${doctorId}`} className="profile-flag-link">
          在工作台中查看病案
        </Link>
      </div>
    </div>
  );
}

// ─── Main flagged section ─────────────────────────────────────────────────────

function FlaggedSection({
  result,
  doctorId,
  totalAnalyzed,
}: {
  result: FlaggedCasesResult;
  doctorId: string;
  totalAnalyzed: number;
}) {
  const byRule = new Map<RuleKey, FlaggedCase[]>(RULE_ORDER.map((k) => [k, []]));
  for (const c of result.flagged) {
    byRule.get(c.ruleKey)?.push(c);
  }

  const hasAnyFlags = result.flagged.length > 0 || result.clusters.length > 0;
  const isLowSample = totalAnalyzed < LOW_SAMPLE_THRESHOLD;

  return (
    <div className="profile-section">
      <div className="profile-section__head">
        待关注病案
        {isLowSample && (
          <span className="profile-section__head-note">
            {" "}（样本不足 {LOW_SAMPLE_THRESHOLD} 例，仅显示绝对信号）
          </span>
        )}
      </div>
      <div className="profile-flags">
        {!hasAnyFlags && (
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

        {result.clusters.length > 0 && (
          <div className="profile-cluster-wrap">
            <div className="profile-cluster-section-head">处方高度重复（AI 分析）</div>
            {result.clusters.map((cluster, i) => (
              <ClusterGroup key={i} cluster={cluster} doctorId={doctorId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DoctorProfilePage({ params }: RouteContext) {
  const { doctorId } = await params;
  const admin = getServiceRoleClient();

  const [userResult, snapshot, flagResult] = await Promise.all([
    admin.auth.admin.getUserById(doctorId),
    computeDoctorProfile(admin, doctorId),
    findFlaggedCases(admin, doctorId),
  ]);

  const email = userResult.data?.user?.email ?? doctorId;

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">
            <Link href="/admin/users" className="admin-back-link">
              ← 用户列表
            </Link>
          </p>
          <h1>{email}</h1>
          <p className="admin-meta">{snapshot.totalAnalyzed} 条已分析病案</p>
        </div>
        <div className="admin-header-actions">
          <Link className="secondary-button" href={`/?viewAs=${doctorId}`}>
            预览医生工作台
          </Link>
        </div>
      </div>

      <DoctorSubNav doctorId={doctorId} />

      {snapshot.totalAnalyzed === 0 ? (
        <div className="admin-empty" style={{ marginTop: 24 }}>
          <p>该医生暂无已分析病案，无法生成评估快照。</p>
        </div>
      ) : (
        <div className="profile-wrap">
          <HeaderStrip snapshot={snapshot} />
          <FlaggedSection
            result={flagResult}
            doctorId={doctorId}
            totalAnalyzed={snapshot.totalAnalyzed}
          />
          <p className="profile-meta">
            数据范围：{formatSGT(snapshot.oldestAnalyzedAt)} — {formatSGT(snapshot.latestAnalyzedAt)}
            {" · "}生成于 {formatSGT(snapshot.computedAt)} SGT
          </p>
        </div>
      )}
    </main>
  );
}
