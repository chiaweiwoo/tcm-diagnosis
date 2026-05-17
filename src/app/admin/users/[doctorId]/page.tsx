import Link from "next/link";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { CloneButton } from "./CloneButton";
import type { StructuredCaseForm } from "@/lib/forms/caseSchema";

type RouteContext = { params: Promise<{ doctorId: string }> };

type ConsultationRow = {
  id: string;
  doctor_email: string;
  consultation_name: string | null;
  form_data: StructuredCaseForm | null;
  analysis_status: "draft" | "analyzed";
  updated_at: string;
};

async function loadData(doctorId: string): Promise<{ email: string; records: ConsultationRow[] }> {
  const admin = getServiceRoleClient();

  const [userResult, recordsResult] = await Promise.all([
    admin.auth.admin.getUserById(doctorId),
    admin
      .from("consultations")
      .select(
        "id,doctor_email,consultation_name,form_data,analysis_status,updated_at",
      )
      .eq("doctor_id", doctorId)
      .order("updated_at", { ascending: false }),
  ]);

  const email = userResult.data?.user?.email ?? doctorId;
  return { email, records: (recordsResult.data ?? []) as ConsultationRow[] };
}

function buildDisplayName(c: ConsultationRow): string {
  if (c.consultation_name) return c.consultation_name;
  if (c.form_data) {
    const { patientSex, patientAge, chiefComplaint } = c.form_data;
    const parts = [
      patientSex,
      patientAge ? `${patientAge}岁` : null,
      chiefComplaint || null,
    ].filter(Boolean) as string[];
    if (parts.length) return parts.join(" ");
  }
  return "未命名病案";
}

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

export default async function DoctorConsultationsPage({ params }: RouteContext) {
  const { doctorId } = await params;
  const { email, records } = await loadData(doctorId);

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
          <p className="admin-meta">
            只读模式 · {records.length} 条病案记录
          </p>
        </div>
        <div className="admin-readonly-banner">
          正在以只读模式查看 {email} 的记录
        </div>
      </div>

      {records.length === 0 ? (
        <div className="admin-empty">
          <p>该医生暂无病案记录。</p>
        </div>
      ) : (
        <div className="consultation-list">
          {records.map((rec) => (
            <div key={rec.id} className="consultation-card">
              <div className="consultation-card__header">
                <span className="consultation-card__name">{buildDisplayName(rec)}</span>
                <span
                  className={`status-pill ${rec.analysis_status === "analyzed" ? "done" : "raw"}`}
                >
                  {rec.analysis_status === "analyzed" ? "已分析" : "草稿"}
                </span>
                <span className="consultation-card__date">{formatSGT(rec.updated_at)}</span>
              </div>

              {rec.form_data && (
                <div className="consultation-card__fields">
                  <div className="consultation-field">
                    <span className="consultation-field__label">主诉</span>
                    <span className="consultation-field__value">
                      {rec.form_data.chiefComplaint}
                    </span>
                  </div>
                  <div className="consultation-field">
                    <span className="consultation-field__label">诊断</span>
                    <span className="consultation-field__value">{rec.form_data.diagnosis}</span>
                  </div>
                  <div className="consultation-field">
                    <span className="consultation-field__label">证型</span>
                    <span className="consultation-field__value">{rec.form_data.pattern}</span>
                  </div>
                  <div className="consultation-field">
                    <span className="consultation-field__label">类型</span>
                    <span className="consultation-field__value">
                      {Array.isArray(rec.form_data.prescriptionType)
                        ? rec.form_data.prescriptionType.join("、")
                        : rec.form_data.prescriptionType}
                    </span>
                  </div>
                </div>
              )}

              <div className="consultation-card__actions">
                <CloneButton consultationId={rec.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
