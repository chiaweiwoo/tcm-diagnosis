type DoctorAllowlistRecord = {
  email: string;
  is_active?: boolean | null;
};

export function normalizeDoctorEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}

export function getDevBypassDoctorEmail() {
  if (process.env.NODE_ENV !== "development") {
    return "";
  }

  if (process.env.DEV_AUTH_BYPASS !== "true") {
    return "";
  }

  return normalizeDoctorEmail(process.env.DEV_AUTH_EMAIL);
}

function parseEnvAllowlist() {
  return (process.env.ALLOWED_DOCTOR_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return {
    baseUrl: `${supabaseUrl}/rest/v1/doctor_allowlist`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  };
}

async function fetchAllowlistRecord(email: string) {
  const config = getSupabaseAdminConfig();
  if (!config) return null;

  try {
    const url = new URL(config.baseUrl);
    url.searchParams.set("select", "email,is_active");
    url.searchParams.set("email", `eq.${email}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url, {
      headers: config.headers,
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const records = (await response.json()) as DoctorAllowlistRecord[];
    return records[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchAllowlistEmails() {
  const config = getSupabaseAdminConfig();
  if (!config) return null;

  try {
    const url = new URL(config.baseUrl);
    url.searchParams.set("select", "email");
    url.searchParams.set("is_active", "eq.true");
    url.searchParams.set("order", "email.asc");

    const response = await fetch(url, {
      headers: config.headers,
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const records = (await response.json()) as Array<{ email?: string | null }>;
    return records
      .map((record) => normalizeDoctorEmail(record.email))
      .filter(Boolean);
  } catch {
    return null;
  }
}

export async function getAllowedDoctorEmails() {
  return (await fetchAllowlistEmails()) ?? parseEnvAllowlist();
}

export async function isAllowedDoctorEmail(email?: string | null) {
  const normalized = normalizeDoctorEmail(email);
  if (!normalized) return false;

  const record = await fetchAllowlistRecord(normalized);
  if (record) {
    return record.is_active !== false;
  }

  return parseEnvAllowlist().includes(normalized);
}
