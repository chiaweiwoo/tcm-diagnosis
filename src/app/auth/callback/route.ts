import { NextResponse } from "next/server";
import { isAllowedDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;
  const redirectTo = new URL("/", origin);

  if (!code) {
    return NextResponse.redirect(new URL("/login?reason=oauth_error", origin));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?reason=oauth_error", origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedDoctorEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?reason=unauthorized", origin));
  }

  return NextResponse.redirect(redirectTo);
}
