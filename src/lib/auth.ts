export const SESSION_MAX_AGE_DAYS = 3;

type DoctorAllowlistRecord = {
  email: string;
  is_active?: boolean | null;
  is_admin?: boolean | null;
  last_signin_at?: string | null;
};

export type AuthStatus = "ok" | "deactivated" | "expired" | "not_allowed";

function assertDevBypassIsLocalOnly() {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "development") {
    throw new Error("DEV_AUTH_BYPASS must not be enabled outside local development.");
  }
}

export function normalizeDoctorEmail(email?: string | null) {
  assertDevBypassIsLocalOnly();
  return email?.trim().toLowerCase() ?? "";
}

export function getDevBypassDoctorEmail() {
  assertDevBypassIsLocalOnly();

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

async function fetchAllowlistRecord(email: string): Promise<DoctorAllowlistRecord | null> {
  const config = getSupabaseAdminConfig();
  if (!config) return null;

  try {
    const url = new URL(config.baseUrl);
    url.searchParams.set("select", "email,is_active,is_admin,last_signin_at");
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

/**
 * Full auth status check — covers is_active, 3-day session expiry, and allowlist membership.
 * Use this at every page-level guard to get the right redirect reason.
 */
export async function getAuthStatus(email?: string | null): Promise<AuthStatus> {
  const normalized = normalizeDoctorEmail(email);
  if (!normalized) return "not_allowed";

  const record = await fetchAllowlistRecord(normalized);

  if (!record) {
    // Fall back to env allowlist (no expiry enforcement for env-list entries)
    return parseEnvAllowlist().includes(normalized) ? "ok" : "not_allowed";
  }

  if (record.is_active === false) return "deactivated";

  if (record.last_signin_at) {
    const ageMs = Date.now() - new Date(record.last_signin_at).getTime();
    if (ageMs > SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return "expired";
  }

  return "ok";
}

/** Checks allowlist membership and is_active only. Does NOT enforce session expiry — use getAuthStatus() for full page-level guards. */
export async function isAllowedDoctorEmail(email?: string | null) {
  const normalized = normalizeDoctorEmail(email);
  if (!normalized) return false;

  const record = await fetchAllowlistRecord(normalized);
  if (record) {
    return record.is_active !== false;
  }

  return parseEnvAllowlist().includes(normalized);
}

export async function isAdminDoctorEmail(email?: string | null) {
  const normalized = normalizeDoctorEmail(email);
  if (!normalized) return false;

  const record = await fetchAllowlistRecord(normalized);
  if (!record || record.is_active === false || record.is_admin !== true) return false;

  if (record.last_signin_at) {
    const ageMs = Date.now() - new Date(record.last_signin_at).getTime();
    if (ageMs > SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return false;
  }

  return true;
}
