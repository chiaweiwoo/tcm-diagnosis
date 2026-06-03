"use client";

import React, { useState, useMemo, useEffect, useRef, useTransition } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
    if (dow === 0 && i < 29) {
      items.push(<div key={`sep-${i}`} className="spark-week-sep" />);
    }
  });
  return <div className="spark-wrap">{items}</div>;
}

const GMAIL_REGEX = /^[a-z0-9._%+\-]+@gmail\.com$/;

function AddUserForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function validate(v: string) {
    const normalized = v.trim().toLowerCase();
    if (!normalized) return "请输入 Gmail 地址。";
    if (!GMAIL_REGEX.test(normalized)) return "仅接受 @gmail.com 邮箱地址。";
    return "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    const validationError = validate(normalized);
    if (validationError) { setError(validationError); return; }
    setError("");

    startTransition(async () => {
      const res = await fetch("/api/admin/users/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "添加失败，请稍后再试。");
        return;
      }
      setEmail("");
      setOpen(false);
      onAdded();
    });
  }

  if (!open) {
    return (
      <button className="add-user-btn" onClick={() => setOpen(true)}>
        <UserPlus size={15} />
        添加医生
      </button>
    );
  }

  return (
    <form className="add-user-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        ref={inputRef}
        className="add-user-input"
        type="email"
        placeholder="doctor@gmail.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(""); }}
        disabled={isPending}
      />
      <button className="add-user-submit" type="submit" disabled={isPending}>
        {isPending ? "添加中…" : "确认添加"}
      </button>
      <button
        className="add-user-cancel"
        type="button"
        onClick={() => { setOpen(false); setEmail(""); setError(""); }}
        disabled={isPending}
      >
        取消
      </button>
      {error && <span className="add-user-error">{error}</span>}
    </form>
  );
}

type ActiveConfirmState = { email: string; targetActive: boolean } | null;

export function UsersList({
  doctors: initialDoctors,
  adminEmail,
}: {
  doctors: DoctorRow[];
  adminEmail: string;
}) {
  const router = useRouter();
  const [doctors, setDoctors] = useState(initialDoctors);
  const [query, setQuery] = useState("");
  const [confirmPreviewId, setConfirmPreviewId] = useState<string | null>(null);
  const [activeConfirm, setActiveConfirm] = useState<ActiveConfirmState>(null);
  const [overlayDoctorId, setOverlayDoctorId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<
    Record<string, ProfileData | "loading" | "error">
  >({});
  const [activeError, setActiveError] = useState("");

  // Keep local state in sync if server re-renders (router.refresh)
  useEffect(() => { setDoctors(initialDoctors); }, [initialDoctors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter((d) => d.email.toLowerCase().includes(q));
  }, [doctors, query]);

  useEffect(() => {
    if (!confirmPreviewId) return;
    const handler = () => setConfirmPreviewId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [confirmPreviewId]);

  useEffect(() => {
    if (!activeConfirm) return;
    const handler = () => setActiveConfirm(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [activeConfirm]);

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

  const handleToggleActive = async (email: string, isActive: boolean) => {
    setActiveConfirm(null);
    setActiveError("");
    const res = await fetch("/api/admin/users/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, isActive }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setActiveError(data.error ?? "操作失败，请稍后再试。");
      return;
    }
    // Optimistic update
    setDoctors((prev) =>
      prev.map((d) => (d.email === email ? { ...d, isActive } : d))
    );
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
        <AddUserForm onAdded={() => router.refresh()} />
      </div>

      {activeError && (
        <div className="users-error-banner">{activeError}</div>
      )}

      <div className="users-list">
        <div className="users-list-head">
          <span className="users-head__email">邮箱</span>
          <span className="users-head__spark">近30天</span>
          <span className="users-head__role">角色</span>
          <span className="users-head__status">状态</span>
          <span className="users-head__date">最近分析</span>
          <span className="users-head__actions">操作</span>
        </div>

        {filtered.length === 0 ? (
          <div className="admin-empty">
            <p>无匹配结果</p>
          </div>
        ) : (
          filtered.map((doc) => {
            const isSelf = doc.email === adminEmail;
            const isClickable = doc.doctorId != null && doc.isActive;

            return (
              <div key={doc.email} className="users-row-wrap">
                <div
                  className={[
                    "users-row",
                    doc.doctorId && doc.isActive ? "users-row--clickable" : "",
                    !doc.isActive ? "users-row--deactivated" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (isClickable) void handleRowClick(doc.doctorId!);
                  }}
                >
                  <span className="users-row__email">{doc.email}</span>
                  <span className="users-row__spark">
                    {doc.isActive ? <Sparkline counts={doc.dailyCounts} /> : null}
                  </span>
                  <span>
                    {doc.isAdmin ? (
                      <span className="status-pill user-role-admin">管理员</span>
                    ) : (
                      <span className="status-pill">医生</span>
                    )}
                  </span>

                  {/* 状态 column */}
                  <span className="users-row__status">
                    {isSelf ? (
                      <span className="status-pill status-pill--active">已启用</span>
                    ) : (
                      <span
                        className={`status-pill ${doc.isActive ? "status-pill--active" : "status-pill--off"} status-pill--clickable`}
                        title={doc.isActive ? "点击停用" : "点击启用"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveError("");
                          setActiveConfirm({ email: doc.email, targetActive: !doc.isActive });
                        }}
                      >
                        {doc.isActive ? "已启用" : "已停用"}
                      </span>
                    )}

                    {/* Confirm popup anchored to this row */}
                    {activeConfirm?.email === doc.email && (
                      <div
                        className="active-confirm-popup"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="active-confirm-msg">
                          {activeConfirm.targetActive
                            ? "恢复启用后该医生可立即重新登录。"
                            : "停用后该医生立即失去登录权限；已登录会话在下次请求时自动登出。历史病案保留不变，可随时重新启用。"}
                        </span>
                        <div className="active-confirm-actions">
                          <button
                            className="active-confirm-ok"
                            onClick={() =>
                              void handleToggleActive(activeConfirm.email, activeConfirm.targetActive)
                            }
                          >
                            确认
                          </button>
                          <button
                            className="active-confirm-cancel"
                            onClick={() => setActiveConfirm(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </span>

                  <span className="users-row__date">{formatSGT(doc.lastActive)}</span>

                  <span className="users-row__actions">
                    {doc.doctorId && doc.email !== adminEmail && doc.isActive && (
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
                    {(!doc.doctorId || !doc.isActive) && doc.email !== adminEmail && (
                      <span
                        className="users-row__action-btn users-row__action-btn--disabled"
                        title={!doc.doctorId ? "未注册，无法预览" : "已停用，无法预览"}
                      >
                        <EyeOff size={16} />
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {overlayDoctorId && overlayDoctor && (
        <ProfileOverlay
          doctorId={overlayDoctorId}
          doctorEmail={overlayDoctor.email}
          data={profiles[overlayDoctorId] ?? "loading"}
          isSelf={overlayDoctorId === (doctors.find((d) => d.email === adminEmail)?.doctorId ?? "")}
          onClose={() => setOverlayDoctorId(null)}
        />
      )}
    </div>
  );
}
