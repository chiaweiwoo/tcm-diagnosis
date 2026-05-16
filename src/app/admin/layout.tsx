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
        <nav className="admin-bar-nav">
          <Link href="/admin/assessments" className="admin-bar-link">评估记录</Link>
          <Link href="/admin/activity" className="admin-bar-link">用户活动</Link>
          <Link href="/admin/examples" className="admin-bar-link">样本库</Link>
          <Link href="/admin/usage" className="admin-bar-link">Token 用量</Link>
        </nav>
      </header>
      {children}
    </>
  );
}
