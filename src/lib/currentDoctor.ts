import { getDevBypassDoctorEmail, normalizeDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
