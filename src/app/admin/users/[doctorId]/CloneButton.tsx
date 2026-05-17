"use client";

import { useState } from "react";

export function CloneButton({ consultationId }: { consultationId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleClone() {
    setLoading(true);
    try {
      const res = await fetch(`/api/consultations/${consultationId}/clone`, { method: "POST" });
      if (!res.ok) throw new Error("克隆失败");
      setDone(true);
    } catch {
      alert("克隆失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="clone-done-badge">已克隆 ✓</span>;
  }

  return (
    <button className="secondary-button compact-button" onClick={handleClone} disabled={loading}>
      {loading ? "克隆中…" : "克隆此病案"}
    </button>
  );
}
