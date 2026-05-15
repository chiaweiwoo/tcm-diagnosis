import "./admin.css";
import Link from "next/link";
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

  return (
    <>
      <header className="admin-bar">
        <Link href="/" className="admin-bar-brand">临床复核伙伴</Link>
        <span className="admin-bar-sep">/</span>
        <span className="admin-bar-label">后台管理</span>
      </header>
      {children}
    </>
  );
}
