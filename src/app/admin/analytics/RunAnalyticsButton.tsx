"use client";

import { useState } from "react";

export default function RunAnalyticsButton() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/admin/analytics/run", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        doctorsProcessed?: number;
        doctorsFailed?: number;
      };
      if (!res.ok) throw new Error("请求失败");
      setLastResult(
        `完成：${data.doctorsProcessed ?? 0} 位医生已更新${data.doctorsFailed ? `，${data.doctorsFailed} 位失败` : ""}`,
      );
    } catch {
      setLastResult("运行失败，请稍后重试。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="run-analytics-wrap">
      <button
        className="run-assessment-btn"
        onClick={handleRun}
        disabled={running}
      >
        {running && <span className="run-btn-spinner" />}
        {running ? "运行中…" : "运行统计"}
      </button>
      {lastResult && <span className="run-analytics-result">{lastResult}</span>}
    </div>
  );
}
