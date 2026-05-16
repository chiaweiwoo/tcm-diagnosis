import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAdminDoctorEmail } from "@/lib/auth";
import { apiError } from "@/lib/apiResponses";
import type { StructuredCaseForm } from "@/lib/forms/caseSchema";

type SampleRow = {
  id: string;
  label: string;
  form_data: StructuredCaseForm;
  notes: string | null;
  sort_order: number;
};

export async function GET(_request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !(await isAdminDoctorEmail(user.email))) {
    return apiError(403, "UNAUTHORIZED", "仅管理员可访问。");
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    return apiError(500, "INTERNAL_ERROR", "服务配置缺失。");
  }

  const url = new URL(`${supabaseUrl}/rest/v1/assessment_samples`);
  url.searchParams.set("select", "id,label,form_data,notes,sort_order");
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("order", "sort_order.asc");

  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return apiError(500, "INTERNAL_ERROR", "读取样本失败。");
  }

  const samples = (await response.json()) as SampleRow[];
  return NextResponse.json({ samples });
}
