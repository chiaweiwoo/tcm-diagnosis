import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAuthStatus, getDevBypassDoctorEmail, isAllowedDoctorEmail, isAdminDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPreviewDoctorById } from "@/lib/viewAs";
import Workbench from "./workbench";

type HomeProps = {
  searchParams: Promise<{ viewAs?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { viewAs } = await searchParams;
  const bypassEmail = getDevBypassDoctorEmail();
  let userEmail = bypassEmail;
  let isDevBypass = false;

  if (bypassEmail) {
    if (!(await isAllowedDoctorEmail(bypassEmail))) {
      redirect("/login?reason=dev_bypass_invalid");
    }
    isDevBypass = true;
  } else {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/login");
    }

    const authStatus = await getAuthStatus(user.email);
    if (authStatus === "expired") {
      redirect("/auth/signout?reason=session_expired");
    }
    if (authStatus !== "ok") {
      redirect("/auth/signout?reason=unauthorized");
    }

    userEmail = user.email ?? "";
  }

  const isAdmin = await isAdminDoctorEmail(userEmail);
  let viewAsTarget: { doctorId: string; email: string } | undefined;

  if (viewAs) {
    if (!isAdmin) {
      redirect("/");
    }

    const target = await getPreviewDoctorById(viewAs);
    if (!target) {
      redirect("/admin/users");
    }

    viewAsTarget = {
      doctorId: target.id,
      email: target.email,
    };
  }

  return (
    <Suspense>
      <Workbench isAdmin={isAdmin} viewAs={viewAsTarget} />
    </Suspense>
  );
}
