import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { isAllowedDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activityLog";

export async function GET(request: NextRequest) {
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

  if (!(await isAllowedDoctorEmail(user?.email))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?reason=unauthorized", origin));
  }

  // Log login event — non-blocking, never fails the auth flow
  if (user?.email) {
    const email = user.email;
    const userAgent = request.headers.get("user-agent") ?? undefined;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      undefined;

    after(() =>
      logActivity({
        doctorEmail: email,
        eventType: "login",
        metadata: {
          ...(userAgent ? { user_agent: userAgent } : {}),
          ...(ip ? { ip } : {}),
        },
      }),
    );
  }

  return NextResponse.redirect(redirectTo);
}
