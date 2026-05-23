import Link from "next/link";
import { Suspense } from "react";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { ConsultationTable } from "./ConsultationTable";
import { DoctorTabs } from "./DoctorTabs";
import { EvaluationPanel } from "./EvaluationPanel";
import type { StructuredCaseForm } from "@/lib/forms/caseSchema";

type RouteContext = {
  params: Promise<{ doctorId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

type ConsultationRow = {
  id: string;
  doctor_email: string;
  consultation_name: string | null;
  case_id: string | null;
  related_case_id: string | null;
  form_data: StructuredCaseForm | null;
  created_at: string;
};

async function loadData(doctorId: string): Promise<{ email: string; records: ConsultationRow[] }> {
  const admin = getServiceRoleClient();

  const [userResult, recordsResult] = await Promise.all([
    admin.auth.admin.getUserById(doctorId),
    admin
      .from("consultations")
      .select("id,doctor_email,consultation_name,case_id,related_case_id,form_data,analysis_status,created_at")
      .eq("doctor_id", doctorId)
      .order("created_at", { ascending: false }),
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

export default async function DoctorPage({ params, searchParams }: RouteContext) {
  const { doctorId } = await params;
  const { tab = "profile" } = await searchParams;
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
          <p className="admin-meta">{records.length} 条病案记录</p>
        </div>
        <div className="admin-header-actions">
          <Link className="secondary-button" href={`/?viewAs=${doctorId}`}>
            预览医生工作台
          </Link>
        </div>
      </div>

      <Suspense>
        <DoctorTabs doctorId={doctorId} />
      </Suspense>

      {tab === "records" && (
        <>
          {records.length === 0 ? (
            <div className="admin-empty">
              <p>该医生暂无病案记录。</p>
            </div>
          ) : (
            <ConsultationTable
              rows={records.map((rec) => ({
                id: rec.id,
                displayName: buildDisplayName(rec),
                prescriptionType: rec.form_data
                  ? (Array.isArray(rec.form_data.prescriptionType)
                      ? rec.form_data.prescriptionType.join("、")
                      : rec.form_data.prescriptionType)
                  : "—",
                caseId: rec.case_id ?? null,
                relatedCaseId: rec.related_case_id ?? null,
                date: formatSGT(rec.created_at),
              }))}
            />
          )}
        </>
      )}

      {tab === "profile" && (
        <Suspense fallback={<div className="eval-loading">加载中…</div>}>
          <EvaluationPanel doctorId={doctorId} />
        </Suspense>
      )}
    </main>
  );
}
