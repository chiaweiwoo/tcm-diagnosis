"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import "../workbench.css";

const reasonMessages: Record<string, string> = {
  unauthorized: "此账号未获授权，请改用允许名单内的 Google 账号登录。",
  oauth_error: "Google 登录未完成，请稍后再试。",
};

export default function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reasonMessage, setReasonMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    setReasonMessage(reason ? reasonMessages[reason] ?? "" : "");
  }, []);

  async function handleGoogleSignIn() {
    setIsSubmitting(true);
    setErrorMessage("");

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErrorMessage("无法发起 Google 登录，请稍后再试。");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-head">
          <div>
            <p className="eyebrow">安全访问</p>
            <h1>医生登录</h1>
            <p className="hero-copy">使用已授权的 Google 账号进入工作台。当前阶段仅开放给指定医生名单。</p>
          </div>
        </div>
      </section>

      <section className="notice-bar">
        <ShieldCheck size={18} />
        <span>仅允许白名单内账号登录，未获授权的账号将被自动拒绝。</span>
      </section>

      <section className="panel login-panel">
        <div className="login-copy">
          <ShieldCheck size={20} />
          <div>
            <h2>Google OAuth</h2>
            <p>登录成功后，系统会再次校验邮箱是否在允许名单中。未通过者不会进入工作台。</p>
          </div>
        </div>

        {reasonMessage ? (
          <div className="blocked-box">
            <strong>登录受限</strong>
            <span>{reasonMessage}</span>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="blocked-box">
            <strong>登录失败</strong>
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={isSubmitting}>
          <ShieldCheck size={18} />
          {isSubmitting ? "跳转中..." : "使用 Google 登录"}
        </button>
      </section>
    </main>
  );
}
