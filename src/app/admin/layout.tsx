import "./admin.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthStatus, getDevBypassDoctorEmail, isAdminDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BRANDING } from "@/lib/branding";
import AdminNav from "./AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const bypassEmail = getDevBypassDoctorEmail();
  let userEmail = bypassEmail;

  if (!bypassEmail) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    userEmail = user.email ?? "";
  }

  const authStatus = await getAuthStatus(userEmail);
  if (authStatus === "expired") {
    redirect("/auth/signout?reason=session_expired");
  }
  if (authStatus !== "ok" || !(await isAdminDoctorEmail(userEmail))) {
    redirect("/?reason=not_admin");
  }

  const Icon = BRANDING.icon;

  return (
    <div className="admin-body">
      <header className="admin-bar">
        <Link href="/" className="admin-bar-brand">
          <Icon size={16} strokeWidth={2.25} />
          {BRANDING.name}
        </Link>
        <span className="admin-bar-sep" aria-hidden>·</span>
        <span className="admin-bar-section">后台</span>
        <AdminNav />
      </header>

      {children}

      <footer className="admin-footer">
        {BRANDING.name} · 后台管理
      </footer>
    </div>
  );
}
