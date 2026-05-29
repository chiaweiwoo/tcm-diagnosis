import Link from "next/link";
import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  computeDoctorProfile,
  LOW_SAMPLE_THRESHOLD,
  type DoctorProfileSnapshot,
} from "@/lib/analytics/doctorProfile";
import { DoctorSubNav } from "../DoctorSubNav";

type RouteContext = {
  params: Promise<{ doctorId: string }>;
};

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

function SignalRow({
  label,
  rate,
}: {
  label: string;
  rate: number;
}) {
  const pct = Math.round(rate * 100);
  return (
    <div className="profile-signal-row">
      <span className="profile-signal-label">{label}</span>
      <div className="profile-signal-bar-wrap">
        <div
          className="profile-signal-bar"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="profile-signal-pct">{pctStr(rate)}</span>
    </div>
  );
}

function ProfileView({ snapshot }: { snapshot: DoctorProfileSnapshot }) {
  const isLowSample = snapshot.totalAnalyzed < LOW_SAMPLE_THRESHOLD;

  // Max chars for each field — used to scale the bars
  const maxChars = Math.max(...snapshot.fields.map((f) => f.avgChars), 1);

  return (
    <div className="profile-wrap">
      {isLowSample && (
        <div className="profile-low-sample">
          <strong>样本量偏少（N={snapshot.totalAnalyzed}）</strong>
          — 以下指标仅供参考，建议积累至 {LOW_SAMPLE_THRESHOLD} 例已分析病案后再做判断。
        </div>
      )}

      {/* Quality signals */}
      <div className="profile-section">
        <div className="profile-section__head">质量信号</div>
        <div className="profile-signal-rows">
          <SignalRow label="辨证警示触发率" rate={snapshot.criticalRiskRate} />
          <SignalRow label="非临床信息出现率" rate={snapshot.nonClinicalRate} />
          <SignalRow label="风险与提醒有实质内容率" rate={snapshot.realCautionsRate} />
        </div>
      </div>

      {/* AI response depth */}
      <div className="profile-section">
        <div className="profile-section__head">AI响应深度（平均条目数 · 空白率）</div>
        <table className="profile-depth-table">
          <thead>
            <tr>
              <th>分区</th>
              <th>平均</th>
              <th>空白率</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.sections.map((s) => {
              const zeroRatePct = s.zeroRate * 100;
              const isHighZeroRate = zeroRatePct >= 30;
              return (
                <tr key={s.sectionTitle}>
                  <td>
                    {s.sectionTitle}
                    {s.groupTitle && (
                      <span className="profile-depth-group">（{s.groupTitle}）</span>
                    )}
                  </td>
                  <td>{s.mean}</td>
                  <td
                    className={`profile-zerorate${isHighZeroRate ? " profile-zerorate--high" : ""}`}
                  >
                    {zeroRatePct.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Input completeness */}
      <div className="profile-section">
        <div className="profile-section__head">输入完整度（平均字数）</div>
        <table className="profile-field-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>平均字数</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.fields.map((f) => {
              const barWidth = Math.min((f.avgChars / maxChars) * 100, 100);
              const isLow = f.field === "physicalExam" && f.avgChars < 20;
              return (
                <tr key={f.field}>
                  <td>{f.label}</td>
                  <td>
                    <div className="profile-field-chars">
                      <div className="profile-field-bar-wrap">
                        <div
                          className="profile-field-bar"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className={isLow ? "profile-field-low" : ""}>
                        {f.avgChars}字
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="profile-meta">
        数据范围：{formatSGT(snapshot.oldestAnalyzedAt)} — {formatSGT(snapshot.latestAnalyzedAt)}
        {" · "}生成于 {formatSGT(snapshot.computedAt)} SGT
      </p>
    </div>
  );
}

export default async function DoctorProfilePage({ params }: RouteContext) {
  const { doctorId } = await params;
  const admin = getServiceRoleClient();

  const [userResult, snapshot] = await Promise.all([
    admin.auth.admin.getUserById(doctorId),
    computeDoctorProfile(admin, doctorId),
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
        <ProfileView snapshot={snapshot} />
      )}
    </main>
  );
}
