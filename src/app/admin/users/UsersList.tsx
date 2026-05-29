"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Eye, EyeOff, ClipboardList, X } from "lucide-react";
import type { DoctorRow } from "./page";

type DiscussionItem = {
  question: string;
  caseAnchor: string | null;
  caseGroup: string | null;
  reasoning: string;
  followUp: string | null;
  n: number;
};

function formatSGT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function DiscussionOverlay({
  doctorEmail,
  agenda,
  onClose,
  onRetry,
}: {
  doctorEmail: string;
  agenda: { items: DiscussionItem[]; computedAt: string | null } | "loading" | "error";
  onClose: () => void;
  onRetry: () => void;
}) {
  const formattedDate =
    agenda !== "loading" && agenda !== "error" && agenda.computedAt
      ? new Date(agenda.computedAt).toLocaleString("zh-SG", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <div className="disc-overlay-backdrop" onClick={onClose}>
      <div className="disc-overlay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="disc-overlay-head">
          <div className="disc-overlay-head-left">
            <ClipboardList size={14} />
            <span className="disc-overlay-title">研讨清单 · 近14天病案</span>
            <span className="disc-overlay-email">{doctorEmail}</span>
          </div>
          <button className="disc-overlay-close" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        {formattedDate && (
          <div className="disc-overlay-meta">生成于 {formattedDate} SGT</div>
        )}

        <div className="disc-overlay-desc">
          <span className="disc-overlay-desc-goal">督导目标：</span>识别该医生近期反复出现的诊疗模式，引导其说明临床思路——目的不是评判对错，而是及早发现思维盲点，防止习惯性偏差影响疗效。每项议题均来自近14天真实病案，附有案例依据与建议跟进问法。
        </div>

        <div className="disc-overlay-body">
          {agenda === "loading" && (
            <div className="disc-overlay-shimmer-wrap">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="disc-shimmer-row">
                  <div className="disc-shimmer-line" style={{ width: "70%", height: 14 }} />
                  <div className="disc-shimmer-line" style={{ width: "40%", height: 11, background: "#e6f4ec" }} />
                  <div className="disc-shimmer-line" style={{ width: "88%", height: 30 }} />
                  <div className="disc-shimmer-line" style={{ width: "60%", height: 26, background: "#e9f6f6" }} />
                </div>
              ))}
            </div>
          )}

          {agenda === "error" && (
            <div className="disc-panel-empty">
              加载失败。{" "}
              <button
                onClick={onRetry}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--brand, #9B2226)",
                  textDecoration: "underline",
                  cursor: "pointer",
                  font: "inherit",
                  padding: 0,
                }}
              >
                重试
              </button>
            </div>
          )}

          {agenda !== "loading" && agenda !== "error" && (
            agenda.items.length === 0 ? (
              <div className="disc-panel-empty">近期病案不足，暂无研讨议题。</div>
            ) : (
              <ol className="disc-overlay-list">
                {agenda.items.map((item, idx) => (
                  <li key={idx} className="disc-overlay-item">
                    <div className="disc-overlay-item-num">{idx + 1}</div>
                    <div className="disc-overlay-item-body">
                      <div className="disc-q disc-overlay-q">{item.question}</div>
                      {item.caseAnchor && (
                        <div className="disc-anchor">
                          <span className="dot" />
                          <span>{item.caseAnchor}</span>
                          {item.caseGroup && <span> · {item.caseGroup}</span>}
                        </div>
                      )}
                      {item.reasoning && (
                        <div className="disc-reason">{item.reasoning}</div>
                      )}
                      {item.followUp && (
                        <div className="disc-follow">
                          <b>💬 </b>
                          {item.followUp}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function UsersList({ doctors }: { doctors: DoctorRow[] }) {
  const [query, setQuery] = useState("");
  const [overlayDoctorId, setOverlayDoctorId] = useState<string | null>(null);
  const [agendas, setAgendas] = useState<
    Record<string, { items: DiscussionItem[]; computedAt: string | null } | "loading" | "error">
  >({});
  const [confirmPreviewId, setConfirmPreviewId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter((d) => d.email.toLowerCase().includes(q));
  }, [doctors, query]);

  // Close overlay on Escape
  useEffect(() => {
    if (!overlayDoctorId) return;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverlayDoctorId(null);
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [overlayDoctorId]);

  // Close confirm popup on outside click
  useEffect(() => {
    if (!confirmPreviewId) return;
    const handler = () => setConfirmPreviewId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [confirmPreviewId]);

  const handleOpenDiscussion = async (e: React.MouseEvent, doctorId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOverlayDoctorId(doctorId);

    if (!agendas[doctorId]) {
      setAgendas((prev) => ({ ...prev, [doctorId]: "loading" }));
      try {
        const res = await fetch(`/api/admin/users/${doctorId}/discussion`);
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as { items: DiscussionItem[]; computedAt: string | null };
        setAgendas((prev) => ({ ...prev, [doctorId]: data }));
      } catch {
        setAgendas((prev) => ({ ...prev, [doctorId]: "error" }));
      }
    }
  };

  const handleRetryDiscussion = (doctorId: string) => {
    setAgendas((prev) => {
      const next = { ...prev };
      delete next[doctorId];
      return next;
    });
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {} } as React.MouseEvent;
      void handleOpenDiscussion(fakeEvent, doctorId);
    }, 50);
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
                <div className="users-row">
                  <Link
                    href={`/admin/users/${doc.doctorId}`}
                    className="users-row__email users-row__email--link"
                    title="查看医生病案记录"
                  >
                    {doc.email}
                  </Link>
                  <span>
                    {doc.isAdmin ? (
                      <span className="status-pill user-role-admin">管理员</span>
                    ) : (
                      <span className="status-pill">医生</span>
                    )}
                  </span>
                  <span className="users-row__date">{formatSGT(doc.lastActive)}</span>
                  <span className="users-row__actions" style={{ gap: 8 }}>
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
                    <button
                      className="disc-toggle"
                      onClick={(e) => void handleOpenDiscussion(e, doc.doctorId!)}
                      title="查看研讨清单"
                    >
                      <ClipboardList size={15} />
                    </button>
                  </span>
                </div>
              </div>
            ) : (
              <div key={doc.email} className="users-row-wrap">
                <div className="users-row users-row--inactive">
                  <span className="users-row__email">{doc.email}</span>
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
                  <span className="users-row__actions" style={{ gap: 8 }}>
                    <span
                      className="users-row__action-btn users-row__action-btn--disabled"
                      title="未注册，无法预览"
                    >
                      <EyeOff size={16} />
                    </span>
                    <span
                      className="disc-toggle users-row__action-btn--disabled"
                      title="未注册，无法查看研讨清单"
                    >
                      <ClipboardList size={15} />
                    </span>
                  </span>
                </div>
              </div>
            )
          )
        )}
      </div>

      {overlayDoctorId && overlayDoctor && (
        <DiscussionOverlay
          doctorEmail={overlayDoctor.email}
          agenda={agendas[overlayDoctorId] ?? "loading"}
          onClose={() => setOverlayDoctorId(null)}
          onRetry={() => handleRetryDiscussion(overlayDoctorId)}
        />
      )}
    </div>
  );
}
