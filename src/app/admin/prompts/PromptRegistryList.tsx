"use client";

import { useState } from "react";
import type { FamilyView, VersionView } from "./types";

const SOURCE_LABELS: Record<string, string> = {
  latest: "默认 (latest)",
  env: "环境变量覆盖",
  cli: "CLI 参数覆盖",
  manual: "代码覆盖",
  "env-invalid-fallback": "环境变量无效 · 已回退",
  archived: "已停用",
};

function formatSgt(isoDate: string): string {
  return new Date(isoDate).toLocaleString("zh-CN", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="prompt-copy-btn" onClick={handleCopy} title="复制提示词">
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function parseHistoricalCommit(contents: string): { sha: string; date: string } | null {
  const m = contents.match(/historicalCommit\s*=\s*\{\s*sha:\s*"([^"]+)"[^}]*date:\s*"([^"]+)"/);
  return m ? { sha: m[1], date: m[2] } : null;
}

function VersionCard({ entry, isActiveVersion }: { entry: VersionView; isActiveVersion: boolean }) {
  const [expanded, setExpanded] = useState(isActiveVersion);
  const { meta } = entry;
  const historical = entry.isArchive ? parseHistoricalCommit(entry.contents) : null;

  return (
    <div className={`prompt-version-card${isActiveVersion ? " prompt-version-card--active" : ""}`}>
      <div className="prompt-version-header" onClick={() => setExpanded((v) => !v)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}>
        <div className="prompt-version-title">
          <span className="prompt-version-tag">{entry.version}</span>
          {isActiveVersion && <span className="prompt-badge prompt-badge--active">当前版本</span>}
          {entry.isArchive && <span className="prompt-badge prompt-badge--history">历史存档</span>}
          {!entry.currentlyInTree && !entry.isArchive && <span className="prompt-badge prompt-badge--deleted">已删除</span>}
          {entry.commitCount > 1 && (
            <span className="prompt-badge prompt-badge--warn" title={`此版本文件被修改过 ${entry.commitCount} 次（违反不可变原则）`}>
              ⚠ 修改过 {entry.commitCount} 次
            </span>
          )}
        </div>
        {meta && <div className="prompt-meta-summary">{meta.summary}</div>}
        <div className="prompt-version-commits">
          {historical ? (
            <span className="prompt-commit-info">
              原始提交：{historical.date} · {historical.sha.slice(0, 7)}
            </span>
          ) : (
            <span className="prompt-commit-info">
              首次提交：{formatSgt(entry.firstCommit.isoDate)} · {entry.firstCommit.sha.slice(0, 7)} · {entry.firstCommit.author}
            </span>
          )}
          {entry.commitCount > 1 && !entry.isArchive && (
            <span className="prompt-commit-info">
              最近修改：{formatSgt(entry.lastCommit.isoDate)} · {entry.lastCommit.sha.slice(0, 7)}
            </span>
          )}
        </div>
        <div className="prompt-commit-message">
          {entry.firstCommit.message}
        </div>
        <span className="prompt-version-chevron">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="prompt-version-body">
          {meta ? (
            <div className="prompt-change-notes">
              <span className="prompt-change-notes-label">改动说明</span>
              <p className="prompt-meta-motivation">{meta.motivation}</p>
              {meta.futureIdeas.length > 0 && (
                <div className="prompt-meta-future">
                  <span className="prompt-meta-future-label">未来方向</span>
                  <ul className="prompt-meta-future-list">
                    {meta.futureIdeas.map((idea, i) => <li key={i}>{idea}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : entry.firstCommit.body ? (
            <div className="prompt-change-notes">
              <span className="prompt-change-notes-label">改动说明（来自提交记录）</span>
              <pre className="prompt-change-notes-body">{entry.firstCommit.body}</pre>
            </div>
          ) : null}
          <div className="prompt-source-header">
            <span className="prompt-source-label">提示词内容</span>
            <CopyButton text={entry.contents} />
          </div>
          <pre className="prompt-source-code">{entry.contents}</pre>
        </div>
      )}
    </div>
  );
}

function ArchiveSection({ versions }: { versions: VersionView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="prompt-archive-section">
      <div
        className="prompt-archive-toggle"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
      >
        <span className="prompt-badge prompt-badge--archived">历史版本 · {versions.length} 个</span>
        <span className="prompt-archive-chevron">{open ? "▲" : "▼"}</span>
      </div>
      {open && versions.map((entry) => (
        <VersionCard
          key={entry.version}
          entry={entry}
          isActiveVersion={false}
        />
      ))}
    </div>
  );
}

function FamilyAccordion({ family }: { family: FamilyView }) {
  const [open, setOpen] = useState(family.isActive);

  return (
    <div className={`prompt-family${family.isActive ? "" : " prompt-family--archived"}`}>
      <div
        className="prompt-family-header"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
      >
        <div className="prompt-family-title">
          <span className="prompt-family-name">{family.family}</span>
          {!family.isActive && <span className="prompt-badge prompt-badge--archived">已停用</span>}
          <span className={`prompt-source-chip prompt-source-chip--${family.source.replace(/-/g, "_")}`}>
            {SOURCE_LABELS[family.source] ?? family.source}
          </span>
        </div>
        <div className="prompt-family-meta">
          {family.isActive && (
            <>
              <span>当前版本：<strong>{family.activeVersion}</strong></span>
              <span className="prompt-family-env">环境变量：<code>{family.envVarName}</code></span>
            </>
          )}
          {family.callers.length > 0 && (
            <span className="prompt-family-callers">调用方：{family.callers.join(" · ")}</span>
          )}
        </div>
        <span className="prompt-family-chevron">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="prompt-family-body">
          {family.versions.length === 0 ? (
            <p className="prompt-empty">此系列无版本记录</p>
          ) : (() => {
            const live = family.versions.filter((v) => !v.isArchive);
            const archive = family.versions.filter((v) => v.isArchive);
            return (
              <>
                {live.map((entry) => (
                  <VersionCard
                    key={entry.version}
                    entry={entry}
                    isActiveVersion={family.isActive && entry.version === family.activeVersion}
                  />
                ))}
                {archive.length > 0 && (
                  <ArchiveSection versions={archive} />
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function PromptRegistryList({ families }: { families: FamilyView[] }) {
  return (
    <div className="prompt-registry-list">
      {families.map((f) => (
        <FamilyAccordion key={f.family} family={f} />
      ))}
    </div>
  );
}
