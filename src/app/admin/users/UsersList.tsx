"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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
          <span>邮箱</span>
          <span>角色</span>
          <span>最近分析</span>
        </div>

        {filtered.length === 0 ? (
          <div className="admin-empty">
            <p>无匹配结果</p>
          </div>
        ) : (
          filtered.map((doc) =>
            doc.doctorId ? (
              <Link
                key={doc.email}
                href={`/admin/users/${doc.doctorId}`}
                className="users-row users-row--link"
              >
                <span className="users-row__email">{doc.email}</span>
                <span>
                  {doc.isAdmin ? (
                    <span className="status-pill user-role-admin">管理员</span>
                  ) : (
                    <span className="status-pill">医生</span>
                  )}
                </span>
                <span className="users-row__date">{formatSGT(doc.lastActive)}</span>
              </Link>
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
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
