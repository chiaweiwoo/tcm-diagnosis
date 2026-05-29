import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { getDevBypassDoctorEmail } from "@/lib/auth";
import { UsersList } from "./UsersList";

export type DoctorRow = {
  doctorId: string | null;
  email: string;
  isAdmin: boolean;
  lastActive: string | null;
  dailyCounts: number[]; // 30 entries: index 0 = 30 days ago, index 29 = today (SGT)
};

function sgtDayStr(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

function buildDailyCounts(doctorId: string, sparkMap: Map<string, Map<string, number>>): number[] {
  const now = Date.now();
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 24 * 60 * 60 * 1000);
    return sparkMap.get(doctorId)?.get(sgtDayStr(d)) ?? 0;
  });
}

async function loadDoctors(): Promise<DoctorRow[]> {
  const admin = getServiceRoleClient();

  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [allowlistResult, usersResult, sparkResult] = await Promise.all([
    admin
      .from("doctor_allowlist")
      .select("email,is_admin,is_active")
      .eq("is_active", true)
      .order("email"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin
      .from("consultations")
      .select("doctor_id,analyzed_at")
      .not("analyzed_at", "is", null)
      .gte("analyzed_at", windowStart.toISOString()),
  ]);

  if (allowlistResult.error || usersResult.error) return [];

  // Build sparkline map: doctorId -> SGT day string -> count
  const sparkMap = new Map<string, Map<string, number>>();
  for (const row of sparkResult.data ?? []) {
    if (!row.doctor_id || !row.analyzed_at) continue;
    const day = sgtDayStr(new Date(row.analyzed_at));
    if (!sparkMap.has(row.doctor_id)) sparkMap.set(row.doctor_id, new Map());
    const m = sparkMap.get(row.doctor_id)!;
    m.set(day, (m.get(day) ?? 0) + 1);
  }

  const emailToId = new Map(
    usersResult.data.users.map((u) => [u.email?.toLowerCase() ?? "", u.id]),
  );

  return Promise.all(
    (allowlistResult.data ?? []).map(async (row) => {
      const email = row.email.toLowerCase();
      const doctorId = emailToId.get(email) ?? null;

      if (!doctorId) {
        return {
          doctorId: null,
          email,
          isAdmin: row.is_admin ?? false,
          lastActive: null,
          dailyCounts: Array(30).fill(0) as number[],
        };
      }

      const lastResult = await admin
        .from("consultations")
        .select("analyzed_at")
        .eq("doctor_id", doctorId)
        .not("analyzed_at", "is", null)
        .order("analyzed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        doctorId,
        email,
        isAdmin: row.is_admin ?? false,
        lastActive: lastResult.data?.analyzed_at ?? null,
        dailyCounts: buildDailyCounts(doctorId, sparkMap),
      };
    }),
  );
}

async function getCurrentDoctorId(): Promise<string | null> {
  const bypassEmail = getDevBypassDoctorEmail();
  if (bypassEmail) {
    const admin = getServiceRoleClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    return data?.users.find((u) => u.email?.toLowerCase() === bypassEmail.toLowerCase())?.id ?? null;
  }
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export default async function UsersPage() {
  const [doctors, currentDoctorId] = await Promise.all([loadDoctors(), getCurrentDoctorId()]);

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>用户列表</h1>
          <p className="admin-meta">所有已启用的医生账户</p>
        </div>
      </div>

      {doctors.length === 0 ? (
        <div className="admin-empty">
          <p>
            暂无用户。请使用 <code>allowlist:add</code> 脚本添加医生。
          </p>
        </div>
      ) : (
        <UsersList doctors={doctors} currentDoctorId={currentDoctorId} />
      )}
    </main>
  );
}
