export type ActivityLog = {
  id: number;
  doctor_email: string;
  event_type: "login" | "organize" | "analyze";
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type DoctorActivitySummary = {
  email: string;
  lastActive: string;
  lastLogin: string | null;
  loginCount: number;
  organizeCount: number;
  analyzeCount: number;
  thisMonthCount: number;
};

function getConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return {
    baseUrl: `${supabaseUrl}/rest/v1/activity_logs`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  };
}

export async function listActivityLogs(limit = 300): Promise<ActivityLog[]> {
  const config = getConfig();
  if (!config) return [];

  const url = new URL(config.baseUrl);
  url.searchParams.set("select", "id,doctor_email,event_type,metadata,created_at");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, { headers: config.headers, cache: "no-store" });
  if (!response.ok) return [];
  return (await response.json()) as ActivityLog[];
}

export function computeDoctorSummaries(logs: ActivityLog[]): DoctorActivitySummary[] {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const byEmail = new Map<string, ActivityLog[]>();
  for (const log of logs) {
    const bucket = byEmail.get(log.doctor_email) ?? [];
    bucket.push(log);
    byEmail.set(log.doctor_email, bucket);
  }

  return Array.from(byEmail.entries())
    .map(([email, events]) => {
      const sorted = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const logins = sorted.filter((e) => e.event_type === "login");
      return {
        email,
        lastActive: sorted[0]?.created_at ?? "",
        lastLogin: logins[0]?.created_at ?? null,
        loginCount: logins.length,
        organizeCount: events.filter((e) => e.event_type === "organize").length,
        analyzeCount: events.filter((e) => e.event_type === "analyze").length,
        thisMonthCount: events.filter((e) => e.created_at >= monthStart).length,
      };
    })
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}
