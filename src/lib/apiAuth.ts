import { type NextRequest } from "next/server";
import { getAuthStatus } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/apiResponses";

/**
 * Auth result for /api/organize and /api/analyze.
 *
 * ok=true:
 *   - isCli=true  → request came from assess:run CLI (X-Assessment-Key). doctorEmail is null.
 *   - isCli=false → request came from a logged-in doctor. doctorEmail is set.
 *
 * ok=false:
 *   - response is a 401 to return immediately.
 *
 * Usage:
 *   const auth = await requireApiAuth(request);
 *   if (!auth.ok) return auth.response;
 *   // auth.doctorEmail, auth.isCli available
 */
export type ApiAuthResult =
  | { ok: true;  doctorEmail: string | null; isCli: boolean }
  | { ok: false; response: Response };

export async function requireApiAuth(request: NextRequest): Promise<ApiAuthResult> {
  // Path 1: internal CLI with shared secret
  const expectedKey = process.env.ASSESSMENT_API_KEY;
  if (expectedKey && request.headers.get("X-Assessment-Key") === expectedKey) {
    return { ok: true, doctorEmail: null, isCli: true };
  }

  // Path 2: logged-in doctor via browser session cookie
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const status = await getAuthStatus(user.email);
      if (status === "deactivated") {
        return { ok: false, response: apiError(401, "UNAUTHORIZED", "账号已停用，请联系管理员。") };
      }
      if (status === "expired") {
        return { ok: false, response: apiError(401, "UNAUTHORIZED", "会话已过期，请重新登录。") };
      }
      if (status !== "ok") {
        return { ok: false, response: apiError(401, "UNAUTHORIZED", "账号无访问权限。") };
      }
      return { ok: true, doctorEmail: user.email ?? null, isCli: false };
    }
  } catch {
    // fall through to 401
  }

  return { ok: false, response: apiError(401, "UNAUTHORIZED", "请先登录后再使用。") };
}
