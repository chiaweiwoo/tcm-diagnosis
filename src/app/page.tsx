import { redirect } from "next/navigation";
import { isAllowedDoctorEmail } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Workbench from "./workbench";

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!isAllowedDoctorEmail(user.email)) {
    redirect("/auth/signout?reason=unauthorized");
  }

  return <Workbench userEmail={user.email ?? "已登录账号"} />;
}
