"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Eye, EyeOff, ZoomIn } from "lucide-react";
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

function DiscussionPanel({
  agenda,
  onRetry,
}: {
  agenda: { items: DiscussionItem[]; computedAt: string | null } | "loading" | "error";
  onRetry: () => void;
}) {
  if (agenda === "loading") {
    return (
      <div className="disc-panel">
        <div className="disc-panel-head">
          <span className="disc-panel-title">讨论清单 · 加载中...</span>
        </div>
        <div className="disc-grid">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="disc-shimmer-card">
              <div className="disc-shimmer-line" style={{ width: "85%" }} />
              <div className="disc-shimmer-line" style={{ width: "60%", background: "#e6f4ec" }} />
              <div className="disc-shimmer-line" style={{ width: "95%", height: 35 }} />
              <div className="disc-shimmer-line" style={{ width: "70%", marginTop: "auto" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (agenda === "error") {
    return (
      <div className="disc-panel">
        <div className="disc-panel-head">
          <span className="disc-panel-title" style={{ color: "var(--error, #B91C1C)" }}>加载失败</span>
        </div>
        <div className="disc-panel-empty">
          加载讨论议题失败。{" "}
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
      </div>
    );
  }

  const { items, computedAt } = agenda;

  const formattedDate = computedAt
    ? new Date(computedAt).toLocaleString("zh-SG", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div className="disc-panel">
      <div className="disc-panel-head">
        <span className="disc-panel-title">讨论清单 · 近14天病案</span>
        {computedAt && (
          <span className="disc-panel-meta">生成于 {formattedDate} SGT</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="disc-panel-empty">
          近期病案不足，暂无讨论议题。
        </div>
      ) : (
        <div className="disc-grid">
          {items.map((item, idx) => (
            <div key={idx} className="disc-card">
              <div className="disc-q">{item.question}</div>
              {item.caseAnchor && (
                <div className="disc-anchor">
                  <span className="dot" />
                  <span>{item.caseAnchor}</span>
                  {item.caseGroup && <span> · {item.caseGroup}</span>}
                </div>
              )}
              {item.reasoning && <div className="disc-reason">{item.reasoning}</div>}
              {item.followUp && (
                <div className="disc-follow">
                  <b>💬 </b>
                  {item.followUp}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UsersList({ doctors }: { doctors: DoctorRow[] }) {
  const [query, setQuery] = useState("");
  const [openDoctorId, setOpenDoctorId] = useState<string | null>(null);
  const [agendas, setAgendas] = useState<
    Record<string, { items: DiscussionItem[]; computedAt: string | null } | "loading" | "error">
  >({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter((d) => d.email.toLowerCase().includes(q));
  }, [doctors, query]);

  const handleToggleDiscussion = async (e: React.MouseEvent, doctorId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (openDoctorId === doctorId) {
      setOpenDoctorId(null);
      return;
    }

    setOpenDoctorId(doctorId);

    if (!agendas[doctorId]) {
      setAgendas((prev) => ({ ...prev, [doctorId]: "loading" }));
      try {
        const res = await fetch(`/api/admin/users/${doctorId}/discussion`);
        if (!res.ok) throw new Error("failed to fetch");
        const data = (await res.json()) as { items: DiscussionItem[]; computedAt: string | null };
        setAgendas((prev) => ({ ...prev, [doctorId]: data }));
      } catch (err) {
        setAgendas((prev) => ({ ...prev, [doctorId]: "error" }));
      }
    }
  };

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
                <div className="users-row" style={openDoctorId === doc.doctorId ? { background: "var(--bg, #FAFAF8)" } : undefined}>
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
                    <Link
                      href={`/?viewAs=${doc.doctorId}`}
                      className="users-row__action-btn"
                      title="以该医生身份预览工作台（只读）"
                    >
                      <Eye size={16} />
                    </Link>
                    <button
                      className={`disc-toggle ${openDoctorId === doc.doctorId ? "active" : ""}`}
                      onClick={(e) => void handleToggleDiscussion(e, doc.doctorId!)}
                      title={openDoctorId === doc.doctorId ? "收起讨论议题" : "查看讨论议题"}
                      aria-expanded={openDoctorId === doc.doctorId}
                    >
                      <ZoomIn size={15} />
                    </button>
                  </span>
                </div>

                <div className={`disc-panel-container ${openDoctorId === doc.doctorId ? "expanded" : ""}`}>
                  <div style={{ minHeight: 0, overflow: "hidden" }}>
                    {agendas[doc.doctorId] && (
                      <DiscussionPanel
                        agenda={agendas[doc.doctorId]}
                        onRetry={() => {
                          setAgendas((prev) => {
                            const next = { ...prev };
                            delete next[doc.doctorId!];
                            return next;
                          });
                          setTimeout(() => {
                            const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;
                            void handleToggleDiscussion(fakeEvent, doc.doctorId!);
                          }, 50);
                        }}
                      />
                    )}
                  </div>
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
                      title="未注册，无法查看讨论议题"
                    >
                      <ZoomIn size={15} />
                    </span>
                  </span>
                </div>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
