"use client";

import { useState } from "react";
import { CloneButton } from "./CloneButton";

type ConsultationRow = {
  id: string;
  displayName: string;
  prescriptionType: string;
  analysis_status: "draft" | "analyzed";
  date: string;
};

const PAGE_SIZE = 15;

export function ConsultationTable({ rows }: { rows: ConsultationRow[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="ctable-wrap">
      <table className="ctable">
        <thead>
          <tr>
            <th className="ctable-th ctable-th--name">病案</th>
            <th className="ctable-th ctable-th--type">类型</th>
            <th className="ctable-th ctable-th--status">状态</th>
            <th className="ctable-th ctable-th--date">更新时间</th>
            <th className="ctable-th ctable-th--action"></th>
          </tr>
        </thead>
        <tbody>
          {slice.map((row) => (
            <tr key={row.id} className="ctable-row">
              <td className="ctable-td ctable-td--name">{row.displayName}</td>
              <td className="ctable-td ctable-td--type">{row.prescriptionType}</td>
              <td className="ctable-td ctable-td--status">
                <span className={`status-pill ${row.analysis_status === "analyzed" ? "done" : "raw"}`}>
                  {row.analysis_status === "analyzed" ? "已分析" : "草稿"}
                </span>
              </td>
              <td className="ctable-td ctable-td--date">{row.date}</td>
              <td className="ctable-td ctable-td--action">
                <CloneButton consultationId={row.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="ctable-pagination">
          <button
            className="ctable-page-btn"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 0}
          >
            ← 上一页
          </button>
          <span className="ctable-page-info">
            第 {page + 1} / {totalPages} 页 · 共 {rows.length} 条
          </span>
          <button
            className="ctable-page-btn"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages - 1}
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
}
