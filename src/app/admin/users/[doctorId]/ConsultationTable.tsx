"use client";

import { useEffect, useMemo, useState } from "react";

type ConsultationRow = {
  id: string;
  displayName: string;
  prescriptionType: string;
  date: string;
};

const PAGE_SIZE = 15;

export function ConsultationTable({ rows }: { rows: ConsultationRow[] }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.displayName, row.prescriptionType, row.date].some((value) => value.toLowerCase().includes(keyword)),
    );
  }, [query, rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageIds = slice.map((row) => row.id);
  const selectedOnPage = pageIds.filter((id) => selectedIds.includes(id));
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(0);
  }, [query]);

  function toggleRow(id: string) {
    setFeedback(null);
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  function togglePageSelection() {
    setFeedback(null);
    setSelectedIds((current) => {
      if (allOnPageSelected) {
        return current.filter((id) => !pageIds.includes(id));
      }
      const merged = new Set([...current, ...pageIds]);
      return [...merged];
    });
  }

  async function handleBulkCopy() {
    if (selectedIds.length === 0) return;
    setCopying(true);
    setFeedback(null);

    let results: Array<{ id: string; ok: boolean }>;
    try {
      results = await Promise.all(
        selectedIds.map(async (id) => {
          const res = await fetch(`/api/consultations/${id}/clone`, { method: "POST" });
          return { id, ok: res.ok };
        }),
      );
    } catch {
      setCopying(false);
      setFeedback({ kind: "error", text: "批量拷贝失败，请稍后重试。" });
      return;
    }

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      setFeedback({
        kind: "error",
        text: `已拷贝 ${results.length - failed.length} 条，另有 ${failed.length} 条失败，请稍后重试。`,
      });
    } else {
      setFeedback({ kind: "success", text: `已拷贝 ${results.length} 条病案到你的工作台草稿。` });
    }
    setCopying(false);
    setSelectedIds([]);
  }

  return (
    <div className="ctable-wrap">
      <div className="ctable-toolbar">
        <label className="ctable-search">
          <span className="ctable-search__label">搜索病例</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="可搜索姓名格式、主诉、类型、日期"
            className="ctable-search__input"
          />
        </label>

        <div className="ctable-toolbar__actions">
          <span className="ctable-selection-note">
            已选 {selectedIds.length} 条 / 共 {filteredRows.length} 条
          </span>
          <button
            type="button"
            className="secondary-button ctable-copy-btn"
            onClick={handleBulkCopy}
            disabled={copying || selectedIds.length === 0}
          >
            {copying ? "拷贝中…" : "拷贝已选病例"}
          </button>
        </div>
      </div>

      {feedback ? (
        <div className={`ctable-feedback ctable-feedback--${feedback.kind}`}>{feedback.text}</div>
      ) : null}

      {filteredRows.length === 0 ? (
        <div className="ctable-empty">没有匹配的病例，请换个关键词试试。</div>
      ) : (
        <>
          <div className="ctable-desktop">
            <table className="ctable">
              <thead>
                <tr>
                  <th className="ctable-th ctable-th--checkbox">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={togglePageSelection}
                      aria-label="选择当前页全部病例"
                    />
                  </th>
                  <th className="ctable-th ctable-th--name">病例</th>
                  <th className="ctable-th ctable-th--type">类型</th>
                  <th className="ctable-th ctable-th--date">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((row) => {
                  const checked = selectedIds.includes(row.id);
                  return (
                    <tr key={row.id} className={`ctable-row${checked ? " is-selected" : ""}`}>
                      <td className="ctable-td ctable-td--checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`选择病例 ${row.displayName}`}
                        />
                      </td>
                      <td className="ctable-td ctable-td--name">{row.displayName}</td>
                      <td className="ctable-td ctable-td--type">{row.prescriptionType}</td>
                      <td className="ctable-td ctable-td--date">{row.date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ctable-mobile-list">
            {slice.map((row) => {
              const checked = selectedIds.includes(row.id);
              return (
                <label key={row.id} className={`ctable-mobile-card${checked ? " is-selected" : ""}`}>
                  <div className="ctable-mobile-card__top">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`选择病例 ${row.displayName}`}
                    />
                    <span className="ctable-mobile-card__name">{row.displayName}</span>
                  </div>
                  <div className="ctable-mobile-card__meta">
                    <span>{row.prescriptionType}</span>
                    <span>{row.date}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}

      {filteredRows.length > PAGE_SIZE && (
        <div className="ctable-pagination">
          <button
            className="ctable-page-btn"
            onClick={() => setPage((current) => current - 1)}
            disabled={safePage === 0}
          >
            ← 上一页
          </button>
          <span className="ctable-page-info">
            第 {safePage + 1} / {totalPages} 页 · 共 {filteredRows.length} 条
          </span>
          <button
            className="ctable-page-btn"
            onClick={() => setPage((current) => current + 1)}
            disabled={safePage >= totalPages - 1}
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
}
