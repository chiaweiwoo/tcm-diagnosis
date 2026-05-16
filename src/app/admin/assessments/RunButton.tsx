"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunButton() {
  const [running, setRunning] = useState(false);
  const router = useRouter();

  async function handleRun() {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/admin/assessment-jobs", { method: "POST" });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (data.jobId) {
        router.push(`/admin/assessments/${data.jobId}`);
      } else {
        alert(data.error ?? "运行失败");
        setRunning(false);
      }
    } catch {
      alert("请求失败，请重试。");
      setRunning(false);
    }
  }

  return (
    <button
      className="run-assessment-btn"
      onClick={() => void handleRun()}
      disabled={running}
    >
      {running ? (
        <>
          <span className="run-btn-spinner" aria-hidden />
          运行中…（约 60 秒）
        </>
      ) : (
        "▶ 运行新评估"
      )}
    </button>
  );
}
