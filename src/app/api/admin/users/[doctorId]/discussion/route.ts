import { NextResponse } from "next/server";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";

type RouteContext = { params: Promise<{ doctorId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  // 1. Admin auth guard (invariant 3)
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  // 2. Extract doctorId
  const { doctorId } = await context.params;
  const admin = getServiceRoleClient();

  // 3. Fetch pre-computed weekly discussion agenda
  const { data, error } = await admin
    .from("doctor_discussion_agenda")
    .select("items, computed_at")
    .eq("doctor_id", doctorId)
    .maybeSingle();

  if (error) {
    return apiError(500, "INTERNAL_ERROR", "读取讨论议题失败。");
  }

  const cacheHeaders = {
    "Cache-Control": "private, max-age=3600",
  };

  if (!data) {
    return NextResponse.json(
      { items: [], computedAt: null },
      { headers: cacheHeaders },
    );
  }

  return NextResponse.json(
    { items: data.items ?? [], computedAt: data.computed_at },
    { headers: cacheHeaders },
  );
}
