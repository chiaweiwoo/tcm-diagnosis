import { getServiceRoleClient } from "@/lib/supabase/server";
import { UsersList } from "./UsersList";

export type DoctorRow = {
  doctorId: string | null;
  email: string;
  isAdmin: boolean;
  lastActive: string | null;
};

async function loadDoctors(): Promise<DoctorRow[]> {
  const admin = getServiceRoleClient();

  const [allowlistResult, usersResult] = await Promise.all([
    admin
      .from("doctor_allowlist")
      .select("email,is_admin,is_active")
      .eq("is_active", true)
      .order("email"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (allowlistResult.error || usersResult.error) return [];

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
      };
    }),
  );
}

export default async function UsersPage() {
  const doctors = await loadDoctors();

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
        <UsersList doctors={doctors} />
      )}
    </main>
  );
}
