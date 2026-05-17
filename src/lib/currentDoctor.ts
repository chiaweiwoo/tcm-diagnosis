import { getDevBypassDoctorEmail, normalizeDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function getCurrentDoctorEmail() {
  const devBypassEmail = getDevBypassDoctorEmail();
  if (devBypassEmail) {
    return devBypassEmail;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = normalizeDoctorEmail(user?.email);

  if (!email) {
    throw new Error("Unauthorized");
  }

  return email;
}

/**
 * Returns the authenticated doctor's UUID and email.
 *
 * Production: reads id + email from the session JWT.
 * Dev bypass: resolves UUID from auth.users via admin API (allowlist is tiny),
 *   then returns a service-role-backed context so RLS-gated queries work locally.
 *
 * isDevBypass=true → caller must use getServiceRoleClient() + explicit email filter
 *   (no session JWT means auth.uid() is null, so the user-scoped client can't see any rows).
 */
export async function getCurrentDoctor(): Promise<{
  id: string;
  email: string;
  isDevBypass: boolean;
}> {
  const devBypassEmail = getDevBypassDoctorEmail();
  if (devBypassEmail) {
    const admin = getServiceRoleClient();
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error("Unauthorized");
    const user = data.users.find(
      (u) => u.email?.toLowerCase() === devBypassEmail.toLowerCase(),
    );
    if (!user) throw new Error("Unauthorized");
    return { id: user.id, email: devBypassEmail, isDevBypass: true };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !user?.email) throw new Error("Unauthorized");
  const email = normalizeDoctorEmail(user.email);
  if (!email) throw new Error("Unauthorized");
  return { id: user.id, email, isDevBypass: false };
}
