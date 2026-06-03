"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import type { DoctorRow } from "./page";
import { ProfileOverlay, type ProfileData } from "./ProfileOverlay";

function formatSGT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function Sparkline({ counts }: { counts: number[] }) {
  const max = Math.max(...counts, 1);
  const todayDow = new Date().getDay(); // 0=Sun … 6=Sat
  const items: React.ReactNode[] = [];
  counts.forEach((c, i) => {
    const dow = ((todayDow - (29 - i)) % 7 + 7) % 7;
    items.push(
      <div
        key={i}
        className={`spark-bar${c === 0 ? " spark-bar--zero" : ""}`}
        style={{ height: c === 0 ? "2px" : `${Math.max(Math.round((c / max) * 100), 15)}%` }}
        title={`${c} 条`}
      />
    );
    // dotted separator after every Sunday bar (between Sun and Mon)
    if (dow === 0 && i < 29) {
      items.push(<div key={`sep-${i}`} className="spark-week-sep" />);
    }
  });
  return <div className="spark-wrap">{items}</div>;
}

export function UsersList({
  doctors,
  currentDoctorId,
}: {
  doctors: DoctorRow[];
  currentDoctorId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [confirmPreviewId, setConfirmPreviewId] = useState<string | null>(null);
  const [overlayDoctorId, setOverlayDoctorId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<
    Record<string, ProfileData | "loading" | "error">
  >({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter((d) => d.email.toLowerCase().includes(q));
  }, [doctors, query]);

  // Close confirm popup on outside click
  useEffect(() => {
    if (!confirmPreviewId) return;
    const handler = () => setConfirmPreviewId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [confirmPreviewId]);

  const handleRowClick = async (doctorId: string) => {
    setOverlayDoctorId(doctorId);
    if (!profiles[doctorId]) {
      setProfiles((prev) => ({ ...prev, [doctorId]: "loading" }));
      try {
        const res = await fetch(`/api/admin/users/${doctorId}/profile`);
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as ProfileData;
        setProfiles((prev) => ({ ...prev, [doctorId]: data }));
      } catch {
        setProfiles((prev) => ({ ...prev, [doctorId]: "error" }));
      }
    }
  };

  const overlayDoctor = overlayDoctorId
    ? doctors.find((d) => d.doctorId === overlayDoctorId) ?? null
    : null;

  return (
    <div>
      <div className="users-toolbar">
        <input
          className="users-search-input"
          type="search"
          placeholder="搜索邮箱…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <span className="users-count">
          {filtered.length} / {doctors.length} 位医生
        </span>
      </div>

      <div className="users-list">
        <div className="users-list-head">
          <span className="users-head__email">邮箱</span>
          <span className="users-head__spark">近30天</span>
          <span className="users-head__role">角色</span>
          <span className="users-head__date">最近分析</span>
          <span className="users-head__actions">操作</span>
        </div>

        {filtered.length === 0 ? (
          <div className="admin-empty">
            <p>无匹配结果</p>
          </div>
        ) : (
          filtered.map((doc) =>
            doc.doctorId ? (
              <div key={doc.email} className="users-row-wrap">
                <div
                  className="users-row users-row--clickable"
                  onClick={() => void handleRowClick(doc.doctorId!)}
                >
                  <span className="users-row__email">{doc.email}</span>
                  <span className="users-row__spark">
                    <Sparkline counts={doc.dailyCounts} />
                  </span>
                  <span>
                    {doc.isAdmin ? (
                      <span className="status-pill user-role-admin">管理员</span>
                    ) : (
                      <span className="status-pill">医生</span>
                    )}
                  </span>
                  <span className="users-row__date">{formatSGT(doc.lastActive)}</span>
                  <span className="users-row__actions">
                    {doc.doctorId !== currentDoctorId && (
                      <span className="eye-confirm-wrap">
                        <button
                          className={`users-row__action-btn${confirmPreviewId === doc.doctorId ? " eye-btn--active" : ""}`}
                          title="以该医生身份预览工作台（只读）"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmPreviewId(
                              confirmPreviewId === doc.doctorId ? null : doc.doctorId
                            );
                          }}
                        >
                          <Eye size={16} />
                        </button>
                        {confirmPreviewId === doc.doctorId && (
                          <div className="eye-confirm-popup" onClick={(e) => e.stopPropagation()}>
                            <span className="eye-confirm-label">进入只读预览</span>
                            <Link href={`/?viewAs=${doc.doctorId}`} className="eye-confirm-ok">
                              确认
                            </Link>
                            <button
                              className="eye-confirm-cancel"
                              onClick={() => setConfirmPreviewId(null)}
                            >
                              取消
                            </button>
                          </div>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <div key={doc.email} className="users-row-wrap">
                <div className="users-row users-row--inactive">
                  <span className="users-row__email">{doc.email}</span>
                  <span className="users-row__spark" />
                  <span>
                    {doc.isAdmin ? (
                      <span className="status-pill user-role-admin">管理员</span>
                    ) : (
                      <span className="status-pill">医生</span>
                    )}
                  </span>
                  <span className="users-row__date">
                    <span className="users-unregistered">未注册</span>
                  </span>
                  <span className="users-row__actions">
                    <span
                      className="users-row__action-btn users-row__action-btn--disabled"
                      title="未注册，无法预览"
                    >
                      <EyeOff size={16} />
                    </span>
                  </span>
                </div>
              </div>
            )
          )
        )}
      </div>

      {overlayDoctorId && overlayDoctor && (
        <ProfileOverlay
          doctorId={overlayDoctorId}
          doctorEmail={overlayDoctor.email}
          data={profiles[overlayDoctorId] ?? "loading"}
          isSelf={overlayDoctorId === currentDoctorId}
          onClose={() => setOverlayDoctorId(null)}
        />
      )}
    </div>
  );
}
