export type ConsultationRecord = {
  id: string;
  doctor_email: string;
  consultation_name: string | null;
  draft: string;
  organized_case: unknown | null;
  analysis_result: unknown | null;
  analysis_raw: unknown | null;
  validation_result: unknown | null;
  model_meta: unknown | null;
  analysis_status: "draft" | "ready" | "stale";
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
};

type ConsultationPatch = Partial<
  Pick<
    ConsultationRecord,
    | "consultation_name"
    | "draft"
    | "organized_case"
    | "analysis_result"
    | "analysis_raw"
    | "validation_result"
    | "model_meta"
    | "analysis_status"
    | "analyzed_at"
  >
>;

function getSupabaseRestConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase service configuration is missing.");
  }

  return {
    baseUrl: `${supabaseUrl}/rest/v1/consultations`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
  };
}

async function readRestError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string; details?: string };
    return body.message || body.details || response.statusText;
  } catch {
    return response.statusText;
  }
}

function requireSingleRecord(records: ConsultationRecord[]) {
  const record = records[0];
  if (!record) {
    throw new Error("Consultation record was not returned by Supabase.");
  }
  return record;
}

export async function listConsultations(doctorEmail: string) {
  const { baseUrl, headers } = getSupabaseRestConfig();
  const url = new URL(baseUrl);
  url.searchParams.set("doctor_email", `eq.${doctorEmail}`);
  url.searchParams.set(
    "select",
    "id,doctor_email,consultation_name,draft,analysis_status,created_at,updated_at,analyzed_at",
  );
  url.searchParams.set("order", "updated_at.desc");

  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readRestError(response));
  }
  return (await response.json()) as ConsultationRecord[];
}

export async function getConsultation(id: string, doctorEmail: string) {
  const { baseUrl, headers } = getSupabaseRestConfig();
  const url = new URL(baseUrl);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("doctor_email", `eq.${doctorEmail}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readRestError(response));
  }
  return ((await response.json()) as ConsultationRecord[])[0] ?? null;
}

export async function createConsultation(input: {
  doctorEmail: string;
  consultationName?: string | null;
  draft: string;
}) {
  const { baseUrl, headers } = getSupabaseRestConfig();
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      doctor_email: input.doctorEmail,
      consultation_name: input.consultationName || null,
      draft: input.draft,
      analysis_status: "draft",
    }),
  });

  if (!response.ok) {
    throw new Error(await readRestError(response));
  }
  return requireSingleRecord((await response.json()) as ConsultationRecord[]);
}

export async function updateConsultation(id: string, doctorEmail: string, patch: ConsultationPatch) {
  const { baseUrl, headers } = getSupabaseRestConfig();
  const url = new URL(baseUrl);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("doctor_email", `eq.${doctorEmail}`);

  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(await readRestError(response));
  }
  return requireSingleRecord((await response.json()) as ConsultationRecord[]);
}

export async function deleteConsultation(id: string, doctorEmail: string) {
  const { baseUrl, headers } = getSupabaseRestConfig();
  const url = new URL(baseUrl);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("doctor_email", `eq.${doctorEmail}`);

  const response = await fetch(url, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  });

  if (!response.ok) {
    throw new Error(await readRestError(response));
  }
}
