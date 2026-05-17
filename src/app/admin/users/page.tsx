import Link from "next/link";
import { getServiceRoleClient } from "@/lib/supabase/server";

type DoctorRow = {
  doctorId: string | null;
  email: string;
  isAdmin: boolean;
  consultationCount30d: number;
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

  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  return Promise.all(
    (allowlistResult.data ?? []).map(async (row) => {
      const email = row.email.toLowerCase();
      const doctorId = emailToId.get(email) ?? null;

      if (!doctorId) {
        return {
          doctorId: null,
          email,
          isAdmin: row.is_admin ?? false,
          consultationCount30d: 0,
          lastActive: null,
        };
      }

      const [countResult, lastResult] = await Promise.all([
        admin
          .from("consultations")
          .select("*", { count: "exact", head: true })
          .eq("doctor_id", doctorId)
          .gte("analyzed_at", windowStart),
        admin
          .from("consultations")
          .select("analyzed_at")
          .eq("doctor_id", doctorId)
          .not("analyzed_at", "is", null)
          .order("analyzed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        doctorId,
        email,
        isAdmin: row.is_admin ?? false,
        consultationCount30d: countResult.count ?? 0,
        lastActive: lastResult.data?.analyzed_at ?? null,
      };
    }),
  );
}

function formatSGT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function UsersPage() {
  const doctors = await loadDoctors();

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>用户列表</h1>
          <p className="admin-meta">所有已启用的医生账户，含近30天病案统计</p>
        </div>
      </div>

      {doctors.length === 0 ? (
        <div className="admin-empty">
          <p>
            暂无用户。请使用 <code>allowlist:add</code> 脚本添加医生。
          </p>
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>角色</th>
              <th>近30天病案</th>
              <th>最近分析</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {doctors.map((doc) => (
              <tr key={doc.email}>
                <td>{doc.email}</td>
                <td>
                  {doc.isAdmin ? (
                    <span className="status-pill user-role-admin">管理员</span>
                  ) : (
                    <span className="status-pill">医生</span>
                  )}
                </td>
                <td>{doc.consultationCount30d}</td>
                <td>{formatSGT(doc.lastActive)}</td>
                <td>
                  {doc.doctorId ? (
                    <Link
                      href={`/admin/users/${doc.doctorId}`}
                      className="secondary-button compact-button"
                    >
                      查看病案 →
                    </Link>
                  ) : (
                    <span className="admin-meta">未注册</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
