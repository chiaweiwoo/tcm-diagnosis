"use client";

import { Activity, AlertTriangle, BookOpen, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";

type MyProfileData = {
  profileSummary: string;
  keyObservations: Array<{ text: string; score: number }>;
  treatmentStyle: Array<{ text: string; score: number }>;
  aiRecurringThemes: Array<{ theme: string; frequency: string }>;
  evaluatedAt: string;
};

function formatEvalDate(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function MyProfilePanel() {
  const [profile, setProfile] = useState<MyProfileData | null | "loading">("loading");

  useEffect(() => {
    fetch("/api/me/profile", { cache: "default" })
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json() as Promise<{ profile: MyProfileData | null }>;
      })
      .then((data) => setProfile(data.profile))
      .catch(() => setProfile(null));
  }, []);

  if (profile === "loading") {
    return (
      <div className="my-profile-loading">
        <div className="shimmer-line shimmer-line--title" />
        <div className="shimmer-line" />
        <div className="shimmer-line shimmer-line--short" />
        <div className="shimmer-line" style={{ marginTop: 6 }} />
        <div className="shimmer-line shimmer-line--short" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="sidebar-empty">
        尚无画像数据
        <br />
        <span style={{ fontSize: 11, display: "block", marginTop: 4 }}>
          管理员生成后将在此显示
        </span>
      </div>
    );
  }

  const sortedObs = [...profile.keyObservations].sort((a, b) => b.score - a.score);
  const sortedStyle = [...profile.treatmentStyle].sort((a, b) => b.score - a.score);

  return (
    <div className="my-profile-panel">
      {profile.profileSummary && (
        <p className="my-profile-summary">{profile.profileSummary}</p>
      )}

      {sortedObs.length > 0 && (
        <div className="my-profile-card">
          <div className="my-profile-card__header">
            <BookOpen size={12} />
            临床观察
          </div>
          <ul className="my-profile-card__list">
            {sortedObs.map((item, i) => (
              <li key={i} className="my-profile-card__item">{item.text}</li>
            ))}
          </ul>
        </div>
      )}

      {sortedStyle.length > 0 && (
        <div className="my-profile-card">
          <div className="my-profile-card__header">
            <Stethoscope size={12} />
            治疗风格
          </div>
          <ul className="my-profile-card__list">
            {sortedStyle.map((item, i) => (
              <li key={i} className="my-profile-card__item">{item.text}</li>
            ))}
          </ul>
        </div>
      )}

      {profile.aiRecurringThemes.length > 0 && (
        <div className="my-profile-card my-profile-card--risk">
          <div className="my-profile-card__header">
            <AlertTriangle size={12} style={{ color: "#D89B42" }} />
            <span style={{ color: "#92400E" }}>AI 反复提醒的风险</span>
          </div>
          <ul className="my-profile-card__list">
            {profile.aiRecurringThemes.map((item, i) => (
              <li key={i} className="my-profile-card__item">{item.theme}</li>
            ))}
          </ul>
        </div>
      )}

      {profile.evaluatedAt && (
        <div className="my-profile-eval-time">
          <Activity size={10} style={{ display: "inline", marginRight: 3 }} />
          更新于 {formatEvalDate(profile.evaluatedAt)}
        </div>
      )}
    </div>
  );
}
