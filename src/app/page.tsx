import { redirect } from "next/navigation";
import { getDevBypassDoctorEmail, isAllowedDoctorEmail, isAdminDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import packageJson from "../../package.json";
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

  const revision = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  const buildLabel = `v${packageJson.version} · ${revision}`;
  const activeModel = process.env.DEEPSEEK_MODEL_ANALYZE || process.env.DEEPSEEK_MODEL_FAST || "deepseek-v4-flash";
  const isAdmin = await isAdminDoctorEmail(userEmail);

  return (
    <Workbench
      userEmail={userEmail || "已登录账号"}
      buildLabel={buildLabel}
      isDevBypass={isDevBypass}
      activeModel={activeModel}
      isAdmin={isAdmin}
    />
  );
}
