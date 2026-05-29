"use client";

import { useEffect, useState } from "react";

type NudgeTheme = {
  key: string;
  weight: number; // 0–1, computed server-side from counts
  examples: string[];
};

type NudgeData = {
  themes: NudgeTheme[];
  computedAt: string | null;
};

export default function RiskNudgePanel({ viewAsDoctorId }: { viewAsDoctorId?: string }) {
  const [nudge, setNudge] = useState<NudgeData | null | "loading">("loading");

  useEffect(() => {
    fetch("/api/me/nudge", {
      cache: "no-store",
      headers: viewAsDoctorId ? { "X-View-As": viewAsDoctorId } : undefined,
    })
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json() as Promise<NudgeData>;
      })
      .then((data) => setNudge(data))
      .catch(() => setNudge(null));
  }, [viewAsDoctorId]);

  // Loading shimmer
  if (nudge === "loading") {
    return (
      <div className="risk-nudge-loading">
        <div className="shimmer-line shimmer-line--title" />
        <div className="shimmer-line" />
        <div className="shimmer-line shimmer-line--short" />
        <div className="shimmer-line" style={{ marginTop: 6 }} />
        <div className="shimmer-line shimmer-line--short" />
      </div>
    );
  }

  // Error or no data
  if (!nudge || nudge.themes.length === 0) {
    return (
      <div className="risk-nudge-card">
        <div className="risk-nudge-header">
          <span
            className="risk-nudge-header__title"
            title="这里汇总近期病案中 AI 反复提示的临床注意事项，帮助回顾常见风险点。仅供参考，不构成诊疗建议。"
          >
            ⚠️ AI 反复提醒的风险点
          </span>
          <div className="risk-nudge-header__desc">
            这里汇总近期病案中 AI 反复提示的临床注意事项，帮助回顾常见风险点。仅供参考，不构成诊疗建议。
          </div>
        </div>
        <div className="risk-nudge-empty">
          暂无足够的近期病案数据
          <br />
          <span>分析足够病案后将在此显示</span>
        </div>
      </div>
    );
  }

  return (
    <div className="risk-nudge-card">
      <div className="risk-nudge-header">
        <span
          className="risk-nudge-header__title"
          title="这里汇总近期病案中 AI 反复提示的临床注意事项，帮助回顾常见风险点。仅供参考，不构成诊疗建议。"
        >
          ⚠️ AI 反复提醒的风险点
        </span>
        <div className="risk-nudge-header__desc">
          这里汇总近期病案中 AI 反复提示的临床注意事项，帮助回顾常见风险点。仅供参考，不构成诊疗建议。
        </div>
      </div>

      <div className="risk-nudge-list">
        {nudge.themes.map((theme, i) => (
          <div key={i} className="risk-nudge-row">
            {/* Row label + bar. Popup appears on row hover. */}
            <div className="risk-nudge-row__label">{theme.key}</div>
            <div className="risk-nudge-bar-track">
              <div
                className="risk-nudge-bar-fill"
                style={{ width: `${Math.round(theme.weight * 100)}%` }}
              />
            </div>

            {/* Hover popup — shows examples */}
            {theme.examples.length > 0 && (
              <div className="risk-nudge-popup" role="tooltip">
                <div className="risk-nudge-popup__label">示例：</div>
                <ul className="risk-nudge-popup__list">
                  {theme.examples.map((ex, j) => (
                    <li key={j}>{ex}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
