import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason");
  const origin = url.origin;
  const supabase = await createServerSupabaseClient();

  await supabase.auth.signOut();

  const loginUrl = new URL("/login", origin);
  if (reason) {
    loginUrl.searchParams.set("reason", reason);
  }

  return NextResponse.redirect(loginUrl);
}
