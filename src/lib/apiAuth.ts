import { type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";

/**
 * Gate for /api/organize and /api/analyze.
 *
 * Allows the request if EITHER:
 *   1. X-Assessment-Key header matches ASSESSMENT_API_KEY env var (CLI / assess:run)
 *   2. A valid Supabase session cookie is present (doctor via browser)
 *
 * Returns a 401 Response if neither condition is met, or null if authorized.
 * Usage: const denied = await requireApiAuth(request); if (denied) return denied;
 */
export async function requireApiAuth(request: NextRequest): Promise<Response | null> {
  // Path 1: internal CLI with shared secret
  const expectedKey = process.env.ASSESSMENT_API_KEY;
  if (expectedKey && request.headers.get("X-Assessment-Key") === expectedKey) {
    return null;
  }

  // Path 2: logged-in doctor via browser session cookie
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return null;
  } catch {
    // fall through to 401
  }

  return apiError(401, "UNAUTHORIZED", "请先登录后再使用。");
}
