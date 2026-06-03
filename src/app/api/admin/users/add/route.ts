import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

const GMAIL_REGEX = /^[a-z0-9._%+\-]+@gmail\.com$/;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可添加用户。");
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return apiError(400, "INVALID_INPUT", "请求格式无效。");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !GMAIL_REGEX.test(email)) {
    return apiError(400, "INVALID_INPUT", "请输入有效的 Gmail 地址（@gmail.com）。");
  }

  const admin = getServiceRoleClient();

  const { data: existing } = await admin
    .from("doctor_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return apiError(409, "CONFLICT", "该邮箱已在名单中。");
  }

  const { error } = await admin
    .from("doctor_allowlist")
    .insert({ email, is_active: true, is_admin: false, note: "added via admin UI" });

  if (error) {
    return apiError(500, "INTERNAL_ERROR", "添加失败，请稍后再试。");
  }

  return NextResponse.json({ ok: true, email });
}
