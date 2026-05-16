"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { BRANDING } from "@/lib/branding";
import "../workbench.css";

const reasonMessages: Record<string, string> = {
  unauthorized: "此账号未获授权，请改用允许名单内的 Google 账号登录。",
  oauth_error: "Google 登录未完成，请稍后再试。",
  dev_bypass_invalid: "本地开发旁路邮箱未通过允许名单校验，请检查 DEV_AUTH_EMAIL 配置。",
};

export default function LoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reasonMessage, setReasonMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    window.setTimeout(() => {
      setReasonMessage(reason ? reasonMessages[reason] ?? "" : "");
    }, 0);

    if (reason === "unauthorized") {
      void createBrowserSupabaseClient().auth.signOut();
    }
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

  const Icon = BRANDING.icon;

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">
            <Icon size={20} />
          </span>
          <div className="login-brand-text-group">
            <span className="login-brand-text">{BRANDING.name}</span>
            <span className="login-brand-sub">{BRANDING.subtitle}</span>
          </div>
        </div>

        <p className="login-intro">使用已授权的 Google 账号进入工作台。仅开放给指定医生名单。</p>

        {(reasonMessage || errorMessage) ? (
          <div className="login-error">
            <strong>{reasonMessage ? "登录受限" : "登录失败"}</strong>
            <span>{reasonMessage || errorMessage}</span>
          </div>
        ) : null}

        <button
          className="login-button"
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
        >
          <ShieldCheck size={17} />
          {isSubmitting ? "跳转中..." : "使用 Google 账号登录"}
        </button>

        <p className="login-footnote">
          <ShieldCheck size={13} />
          登录成功后将再次校验邮箱白名单。
        </p>
      </div>
    </main>
  );
}
