"use client";

import { useState } from "react";

export function CloneButton({ consultationId }: { consultationId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleClone() {
    setLoading(true);
    try {
      const res = await fetch(`/api/consultations/${consultationId}/clone`, { method: "POST" });
      if (!res.ok) throw new Error("拷贝失败");
      setDone(true);
    } catch {
      alert("拷贝失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="clone-done-badge">已拷贝 ✓</span>;
  }

  return (
    <button className="secondary-button compact-button" onClick={handleClone} disabled={loading}>
      {loading ? "拷贝中…" : "拷贝此病案"}
    </button>
  );
}
