import "./admin.css";
import { redirect } from "next/navigation";
import { getDevBypassDoctorEmail, isAdminDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const bypassEmail = getDevBypassDoctorEmail();
  let userEmail = bypassEmail;

  if (!bypassEmail) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    userEmail = user.email ?? "";
  }

  if (!(await isAdminDoctorEmail(userEmail))) {
    redirect("/?reason=not_admin");
  }

  return <>{children}</>;
}
