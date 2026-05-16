import { redirect } from "next/navigation";
import { getDevBypassDoctorEmail, isAllowedDoctorEmail, isAdminDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Workbench from "./workbench";

export default async function Home() {
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

    if (!(await isAllowedDoctorEmail(user.email))) {
      redirect("/auth/signout?reason=unauthorized");
    }

    userEmail = user.email ?? "";
  }

  const isAdmin = await isAdminDoctorEmail(userEmail);

  return <Workbench isAdmin={isAdmin} />;
}
