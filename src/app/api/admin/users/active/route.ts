import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail, normalizeDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可修改用户状态。");
  }

  let body: { email?: unknown; isActive?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; isActive?: unknown };
  } catch {
    return apiError(400, "INVALID_INPUT", "请求格式无效。");
  }

  const email = typeof body.email === "string" ? normalizeDoctorEmail(body.email) : "";
  const isActive = typeof body.isActive === "boolean" ? body.isActive : null;

  if (!email || isActive === null) {
    return apiError(400, "INVALID_INPUT", "缺少必要参数。");
  }

  if (email === normalizeDoctorEmail(user.email)) {
    return apiError(400, "CANNOT_TOGGLE_SELF", "不能修改自己的账号状态。");
  }

  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("doctor_allowlist")
    .update({ is_active: isActive })
    .eq("email", email);

  if (error) {
    return apiError(500, "INTERNAL_ERROR", "更新失败，请稍后再试。");
  }

  return NextResponse.json({ ok: true, isActive });
}
