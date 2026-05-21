import type { SupabaseClient } from "@supabase/supabase-js";

export type ConsultationRecord = {
  id: string;
  doctor_id: string;
  doctor_email: string;
  consultation_name: string | null;
  case_id: string | null;
  case_id_updated_at: string | null;
  related_case_id: string | null;
  related_case_id_updated_at: string | null;
  ai_feedback: string | null;
  ai_feedback_updated_at: string | null;
  form_data: unknown | null;
  analysis_result: unknown | null;
  analysis_raw: unknown | null;
  model_meta: unknown | null;
  analysis_status: "draft" | "analyzed";
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
};

type ConsultationPatch = Partial<
  Pick<
    ConsultationRecord,
    | "consultation_name"
    | "case_id"
    | "case_id_updated_at"
    | "related_case_id"
    | "related_case_id_updated_at"
    | "ai_feedback"
    | "ai_feedback_updated_at"
    | "form_data"
    | "analysis_result"
    | "analysis_raw"
    | "model_meta"
    | "analysis_status"
    | "analyzed_at"
  >
>;

/**
 * When isDevBypass=true the caller uses a service-role client (no session JWT).
 * Pass doctorEmail so the query filters explicitly — RLS is bypassed but we still
 * scope to the right doctor.
 *
 * When isDevBypass=false the caller uses the user-scoped session client and RLS
 * on doctor_id=auth.uid() handles isolation — no extra filter needed.
 */
type DbOpts = { doctorEmail?: string };

function dbError(error: { message?: string } | null) {
  return new Error(error?.message ?? "Database error");
}

const LIST_COLUMNS =
  "id,doctor_id,doctor_email,consultation_name,case_id,case_id_updated_at,related_case_id,related_case_id_updated_at,ai_feedback,ai_feedback_updated_at,form_data,analysis_status,created_at,updated_at,analyzed_at";

export async function listConsultations(
  client: SupabaseClient,
  opts: DbOpts = {},
): Promise<ConsultationRecord[]> {
  const base = client
    .from("consultations")
    .select(LIST_COLUMNS)
    .order("updated_at", { ascending: false });

  const { data, error } = await (opts.doctorEmail
    ? base.eq("doctor_email", opts.doctorEmail)
    : base);

  if (error) throw dbError(error);
  return (data ?? []) as ConsultationRecord[];
}

export async function getConsultation(
  client: SupabaseClient,
  id: string,
  opts: DbOpts = {},
): Promise<ConsultationRecord | null> {
  const base = client.from("consultations").select("*").eq("id", id);
  const { data, error } = await (opts.doctorEmail
    ? base.eq("doctor_email", opts.doctorEmail)
    : base).maybeSingle();

  if (error) throw dbError(error);
  return data as ConsultationRecord | null;
}

export async function createConsultation(
  client: SupabaseClient,
  input: {
    doctorId: string;
    doctorEmail: string;
    consultationName?: string | null;
    caseId?: string | null;
    relatedCaseId?: string | null;
    formData?: unknown;
  },
): Promise<ConsultationRecord> {
  const { data, error } = await client
    .from("consultations")
    .insert({
      doctor_id: input.doctorId,
      doctor_email: input.doctorEmail,
      consultation_name: input.consultationName ?? null,
      case_id: input.caseId ?? null,
      case_id_updated_at: input.caseId ? new Date().toISOString() : null,
      related_case_id: input.relatedCaseId ?? null,
      related_case_id_updated_at: input.relatedCaseId ? new Date().toISOString() : null,
      form_data: input.formData ?? null,
      analysis_status: "draft",
    })
    .select()
    .single();

  if (error) throw dbError(error);
  return data as ConsultationRecord;
}

export async function updateConsultation(
  client: SupabaseClient,
  id: string,
  patch: ConsultationPatch,
  opts: DbOpts = {},
): Promise<ConsultationRecord> {
  const base = client
    .from("consultations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  const { data, error } = await (opts.doctorEmail
    ? base.eq("doctor_email", opts.doctorEmail)
    : base).select().single();

  if (error) throw dbError(error);
  return data as ConsultationRecord;
}

export async function deleteConsultation(
  client: SupabaseClient,
  id: string,
  opts: DbOpts = {},
): Promise<void> {
  const base = client.from("consultations").delete().eq("id", id);
  const { error } = await (opts.doctorEmail
    ? base.eq("doctor_email", opts.doctorEmail)
    : base);

  if (error) throw dbError(error);
}
