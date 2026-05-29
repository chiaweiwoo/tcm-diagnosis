"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import type { DoctorRow } from "./page";

function formatSGT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function UsersList({ doctors }: { doctors: DoctorRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter((d) => d.email.toLowerCase().includes(q));
  }, [doctors, query]);

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
              <div key={doc.email} className="users-row">
                <Link
                  href={`/admin/users/${doc.doctorId}`}
                  className="users-row__email users-row__email--link"
                  title="查看医生详情与画像"
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
                <span className="users-row__actions">
                  <Link
                    href={`/?viewAs=${doc.doctorId}`}
                    className="users-row__action-btn"
                    title="以该医生身份预览工作台（只读）"
                  >
                    <Eye size={16} />
                  </Link>
                </span>
              </div>
            ) : (
              <div key={doc.email} className="users-row users-row--inactive">
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
                <span className="users-row__actions">
                  <span
                    className="users-row__action-btn users-row__action-btn--disabled"
                    title="未注册，无法预览"
                  >
                    <EyeOff size={16} />
                  </span>
                </span>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
