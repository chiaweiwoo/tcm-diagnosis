import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  const admin = getServiceRoleClient();

  const [allowlistResult, usersResult] = await Promise.all([
    admin
      .from("doctor_allowlist")
      .select("email,is_admin,is_active")
      .eq("is_active", true)
      .order("email"),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (allowlistResult.error) {
    return apiError(500, "INTERNAL_ERROR", "无法读取用户列表。");
  }
  if (usersResult.error) {
    return apiError(500, "INTERNAL_ERROR", "无法读取用户数据。");
  }

  const emailToId = new Map(
    usersResult.data.users.map((u) => [u.email?.toLowerCase() ?? "", u.id]),
  );

  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const doctors = await Promise.all(
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

  return NextResponse.json({ doctors });
}
