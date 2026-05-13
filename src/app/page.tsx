import { redirect } from "next/navigation";
import { isAllowedDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import packageJson from "../../package.json";
import Workbench from "./workbench";

export default async function Home() {
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

  const revision = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  const buildLabel = `v${packageJson.version} · ${revision}`;

  return <Workbench userEmail={user.email ?? "已登录账号"} buildLabel={buildLabel} />;
}
