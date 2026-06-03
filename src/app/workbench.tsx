"use client";

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
  Save,
  Search,
  LayoutDashboard,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StructuredCaseForm, structuredCaseSchema, PRESCRIPTION_TYPES, SEX_VALUES } from "@/lib/forms/caseSchema";
import { AnalysisResult, ensureAnalysisResult, normalizePrescriptionType } from "@/lib/ai/analysisResult";
import { BRANDING } from "@/lib/branding";
import RiskNudgePanel from "./RiskNudgePanel";
import { ViewAsBanner } from "./ViewAsBanner";
import "./workbench.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiMeta = {
  model?: string;
  promptVersion?: string;
  durationSeconds?: number;
  repairedJson?: boolean;
  cloned_from_doctor_email?: string;
};

type ConsultationSummary = {
  id: string;
  consultation_name: string | null;
  case_id: string | null;
  case_id_updated_at: string | null;
  related_case_id: string | null;
  related_case_id_updated_at: string | null;
  form_data: unknown | null;
  analysis_status: "draft" | "analyzed";
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
};

type ConsultationRecord = ConsultationSummary & {
  ai_feedback: string | null;
  ai_feedback_updated_at: string | null;
  analysis_result: unknown | null;
  analysis_raw: unknown | null;
  model_meta: ApiMeta | null;
  analysis_stale: boolean | null;
};

type ToastState = { message: string; tone: "success" | "error" | "info" };

type FormErrors = Partial<Record<keyof StructuredCaseForm, string>>;

type SaveStatus = "new" | "unsaved" | "saving" | "saved";

type ViewAsPreview = {
  doctorId: string;
  email: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof StructuredCaseForm)[] = [
  "patientAge", "prescriptionType", "chiefComplaint", "currentIllness",
  "pastHistory", "physicalExam", "diagnosis", "pattern", "prescription",
];

const EMPTY_FORM: StructuredCaseForm = {
  consultationName: "",
  prescriptionType: "方药",
  patientAge: "",
  patientSex: "女",
  chiefComplaint: "",
  currentIllness: "",
  pastHistory: "",
  physicalExam: "",
  diagnosis: "",
  pattern: "",
  prescription: "",
};

const EMPTY_FORM_SNAPSHOT = JSON.stringify(EMPTY_FORM);

function snapshotForm(form: StructuredCaseForm) {
  return JSON.stringify(form);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

type ApiErrorBody = {
  code?: string;
  error?: string;
};

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || "请求失败，请稍后重试。";
  } catch {
    return "请求失败，请稍后重试。";
  }
}

function buildRequestHeaders(viewAsDoctorId?: string, init?: HeadersInit) {
  const headers = new Headers(init);
  if (viewAsDoctorId) {
    headers.set("X-View-As", viewAsDoctorId);
  }
  return headers;
}

async function apiAnalyze(form: StructuredCaseForm, viewAsDoctorId?: string): Promise<{
  result: AnalysisResult;
  raw: unknown;
  model: string;
  promptVersion: string;
  repairedJson: boolean;
}> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: buildRequestHeaders(viewAsDoctorId, { "Content-Type": "application/json" }),
    body: JSON.stringify({ form }),
  });
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try { body = (await response.json()) as ApiErrorBody; } catch { /* ignore */ }
    throw new Error(body.error || "请求失败，请稍后重试。");
  }
  return response.json() as Promise<{
    result: AnalysisResult;
    raw: unknown;
    model: string;
    promptVersion: string;
    repairedJson: boolean;
  }>;
}

async function apiListConsultations(viewAsDoctorId?: string): Promise<ConsultationSummary[]> {
  const response = await fetch("/api/consultations", {
    cache: "no-store",
    headers: buildRequestHeaders(viewAsDoctorId),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = (await response.json()) as { records: ConsultationSummary[] };
  return data.records;
}

async function apiGetConsultation(id: string, viewAsDoctorId?: string): Promise<ConsultationRecord> {
  const response = await fetch(`/api/consultations/${id}`, {
    cache: "no-store",
    headers: buildRequestHeaders(viewAsDoctorId),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = (await response.json()) as { record: ConsultationRecord };
  return data.record;
}

async function apiSaveNew(payload: {
  consultationName: string;
  caseId?: string | null;
  relatedCaseId?: string | null;
  formData: StructuredCaseForm;
  analysisResult: AnalysisResult;
  analysisRaw: unknown;
  modelMeta: ApiMeta;
}, viewAsDoctorId?: string): Promise<ConsultationRecord> {
  const response = await fetch("/api/consultations", {
    method: "POST",
    headers: buildRequestHeaders(viewAsDoctorId, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      consultationName: payload.consultationName || null,
      caseId: payload.caseId ?? null,
      relatedCaseId: payload.relatedCaseId ?? null,
      formData: payload.formData,
      analysisResult: payload.analysisResult,
      analysisRaw: payload.analysisRaw,
      modelMeta: payload.modelMeta,
      analysisStatus: "analyzed",
    }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = (await response.json()) as { record: ConsultationRecord };
  return data.record;
}

async function apiUpdateConsultation(
  id: string,
  payload: {
    consultationName?: string;
    caseId?: string | null;
    relatedCaseId?: string | null;
    aiFeedback?: string | null;
    formData?: StructuredCaseForm;
    analysisResult?: AnalysisResult;
    analysisRaw?: unknown;
    modelMeta?: ApiMeta;
    analysisStatus?: string;
  },
  viewAsDoctorId?: string,
): Promise<ConsultationRecord> {
  const response = await fetch(`/api/consultations/${id}`, {
    method: "PATCH",
    headers: buildRequestHeaders(viewAsDoctorId, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...(payload.consultationName !== undefined ? { consultationName: payload.consultationName } : {}),
      ...(payload.caseId !== undefined ? { caseId: payload.caseId } : {}),
      ...(payload.relatedCaseId !== undefined ? { relatedCaseId: payload.relatedCaseId } : {}),
      ...(payload.aiFeedback !== undefined ? { aiFeedback: payload.aiFeedback } : {}),
      ...(payload.formData !== undefined ? { formData: payload.formData } : {}),
      ...(payload.analysisResult !== undefined ? { analysisResult: payload.analysisResult } : {}),
      ...(payload.analysisRaw !== undefined ? { analysisRaw: payload.analysisRaw } : {}),
      ...(payload.modelMeta !== undefined ? { modelMeta: payload.modelMeta } : {}),
      ...(payload.analysisStatus !== undefined ? { analysisStatus: payload.analysisStatus } : {}),
    }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = (await response.json()) as { record: ConsultationRecord };
  return data.record;
}

async function apiDeleteConsultation(id: string, viewAsDoctorId?: string): Promise<void> {
  const response = await fetch(`/api/consultations/${id}`, {
    method: "DELETE",
    headers: buildRequestHeaders(viewAsDoctorId),
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

function getFormErrors(form: StructuredCaseForm): FormErrors {
  const result = structuredCaseSchema.safeParse(form);
  if (result.success) return {};
  const errors: FormErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof StructuredCaseForm | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

const Toast = memo(function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  const icons: Record<ToastState["tone"], ReactNode> = {
    success: <CheckCircle2 size={16} />,
    error: <AlertTriangle size={16} />,
    info: <Brain size={16} />,
  };

  return (
    <div className={`toast toast--${toast.tone}`} role="alert">
      <span className="toast__icon">{icons[toast.tone]}</span>
      <span>{toast.message}</span>
      <button className="toast__close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
});

type ConfirmDialogState = {
  title?: string;
  message: string;
  confirmLabel: string;
  confirmTone?: "primary" | "danger";
  resolve: (ok: boolean) => void;
};

const ConfirmDialog = memo(function ConfirmDialog({
  state,
  onResolve,
}: {
  state: ConfirmDialogState;
  onResolve: (ok: boolean) => void;
}) {
  return (
    <div className="confirm-overlay" role="presentation">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        {state.title ? <h3 className="confirm-dialog__title">{state.title}</h3> : null}
        <p className="confirm-dialog__message">{state.message}</p>
        <div className="confirm-dialog__actions">
          <button className="btn btn--ghost btn--sm" onClick={() => onResolve(false)}>
            取消
          </button>
          <button
            className={`btn btn--sm ${state.confirmTone === "danger" ? "btn--danger" : "btn--primary"}`}
            onClick={() => onResolve(true)}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
});

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="field-error">{message}</span>;
}

const ResultSection = memo(function ResultSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="result-section">
      <h4 className="result-section__title">{title}</h4>
      <ul className="result-section__list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
});

const ResultColumn = memo(function ResultColumn({ title, icon, colorVariant, children }: { title: string; icon: ReactNode; colorVariant?: "green" | "blue" | "red"; children: ReactNode }) {
  return (
    <div className={`result-column${colorVariant ? ` result-column--${colorVariant}` : ""}`}>
      <div className="result-column__header">
        <span className="result-column__icon">{icon}</span>
        <h3 className="result-column__title">{title}</h3>
      </div>
      <div className="result-column__body">{children}</div>
    </div>
  );
});

/** Wraps matched phrases in <mark> within a text string. */
function HighlightedText({ text, highlights }: { text: string; highlights: string[] }) {
  if (!highlights.length) return <>{text}</>;
  // Build a regex that matches any of the highlight phrases (longest first to avoid partial overlaps)
  const sorted = [...highlights].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        highlights.includes(part) ? (
          <mark key={i} className="critical-highlight">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function DiagnosticAlertBanner({ summary, highlights }: { summary: string; highlights: string[] }) {
  return (
    <div className="diagnostic-alert-banner" role="alert">
      <div className="diagnostic-alert-banner__header">
        <span className="diagnostic-alert-banner__icon">⚠</span>
        辨证警示 Diagnostic Alert
      </div>
      <p className="diagnostic-alert-banner__summary">
        <HighlightedText text={summary} highlights={highlights} />
      </p>
    </div>
  );
}

function ShimmerCard() {
  return (
    <div className="shimmer-card" aria-hidden="true">
      <div className="shimmer-line shimmer-line--title" />
      <div className="shimmer-line" />
      <div className="shimmer-line shimmer-line--short" />
      <div className="shimmer-line" />
    </div>
  );
}

function buildDisplayName(c: ConsultationSummary): string {
  if (c.consultation_name) return c.consultation_name;
  if (c.form_data && typeof c.form_data === "object") {
    const raw = c.form_data as Record<string, unknown>;
    const patientSex = typeof raw.patientSex === "string" ? raw.patientSex : null;
    const patientAge = typeof raw.patientAge === "string" ? raw.patientAge : null;
    const chiefComplaint = typeof raw.chiefComplaint === "string" ? raw.chiefComplaint : null;
    const parts = [
      patientSex,
      patientAge ? `${patientAge}岁` : null,
      chiefComplaint || null,
    ].filter(Boolean) as string[];
    if (parts.length) return parts.join(" ");
  }
  return "未命名病案";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const strTime = `${hours}:${minutes} ${ampm}`;

  return `${yyyy}-${mm}-${dd} ${strTime}`;
}

function formatSavedTime(d: Date) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const period = h >= 12 ? "下午" : "上午";
  h = h % 12 || 12;
  return `${period} ${h}:${m}`;
}

function normalizeCaseId(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseHistoricalFormData(formData: unknown): StructuredCaseForm | null {
  if (!formData || typeof formData !== "object") return null;
  const raw = formData as Record<string, unknown>;
  const coerced = {
    ...raw,
    prescriptionType: Array.isArray(raw.prescriptionType)
      ? (raw.prescriptionType[0] ?? "方药")
      : raw.prescriptionType,
  };
  const parsed = structuredCaseSchema.safeParse(coerced);
  return parsed.success ? parsed.data : null;
}

function getConsultationSortTime(record: Pick<ConsultationSummary, "created_at">) {
  const created = Date.parse(record.created_at);
  if (!Number.isNaN(created)) return created;
  return 0;
}

type LinkedCaseRail = {
  timelineRecords: ConsultationSummary[];
};

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

const StatusBar = memo(function StatusBar({
  saveStatus,
  savedAt,
  analyzing,
  form,
  readOnly = false,
}: {
  saveStatus: SaveStatus;
  savedAt: Date | null;
  analyzing: boolean;
  form: StructuredCaseForm;
  readOnly?: boolean;
}) {
  const hasIdentity = !!(form.patientAge || form.chiefComplaint);
  const parts = [
    hasIdentity ? form.patientSex : null,
    form.patientAge ? `${form.patientAge}岁` : null,
    form.chiefComplaint || null,
  ].filter(Boolean) as string[];
  const displayName = parts.length ? parts.join(" · ") : null;

  let indicator: ReactNode;
  if (readOnly) {
    indicator = (
      <span className="status-bar__state status-bar__state--saved">
        <CheckCircle2 size={11} />
        只读预览
      </span>
    );
  } else if (analyzing) {
    indicator = (
      <span className="status-bar__state status-bar__state--analyzing">
        <LoaderCircle size={11} className="spin" />
        分析中…
      </span>
    );
  } else if (saveStatus === "saving") {
    indicator = (
      <span className="status-bar__state status-bar__state--saving">
        <LoaderCircle size={11} className="spin" />
        保存中…
      </span>
    );
  } else if (saveStatus === "saved" && savedAt) {
    indicator = (
      <span className="status-bar__state status-bar__state--saved">
        <CheckCircle2 size={11} />
        已保存 {formatSavedTime(savedAt)}
      </span>
    );
  } else if (saveStatus === "unsaved") {
    indicator = (
      <span className="status-bar__state status-bar__state--unsaved">
        <span className="status-bar__dot" aria-hidden />
        未保存更改
      </span>
    );
  } else {
    indicator = (
      <span className="status-bar__state status-bar__state--new">
        新病案
      </span>
    );
  }

  return (
    <div className="form-status-bar">
      <span className="status-bar__name">
        <FileText size={12} />
        {displayName ?? "未命名病案"}
      </span>
      {indicator}
    </div>
  );
});

const FeedbackCard = memo(function FeedbackCard({
  value,
  onChange,
  updatedAt,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  updatedAt: Date | null;
  disabled?: boolean;
}) {
  return (
    <section className="feedback-section">
      <div className="feedback-card">
        <div className="feedback-card__header">
          <div>
            <h3 className="feedback-card__title">
              <MessageSquare size={15} />
              给AI回馈 Feedback to AI
            </h3>
            <p className="feedback-card__hint">可选填写：记录这次建议哪里有帮助、哪里不准确，帮助后续优化。</p>
          </div>
          {updatedAt ? (
            <span className="feedback-card__meta">上次提交 {formatSavedTime(updatedAt)}</span>
          ) : null}
        </div>
        <textarea
          className="form-textarea feedback-card__textarea"
          placeholder="例：整体方向有帮助，但方药剂量建议偏保守；希望下次更强调药物相互作用。"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={4}
          maxLength={1000}
        />
      </div>
    </section>
  );
});

const CaseLinkTimeline = memo(function CaseLinkTimeline({
  currentRecord,
  timelineRecords,
  onSelect,
}: {
  currentRecord: ConsultationSummary;
  timelineRecords: ConsultationSummary[];
  onSelect: (id: string) => void;
}) {
  if (!timelineRecords.length) return null;

  return (
    <aside className="case-linkage-rail" aria-label="随访记录">
      <div className="case-linkage-rail__header">
        <span className="case-linkage-rail__title">随访记录</span>
      </div>
      <div className="case-linkage">
        <div className="case-linkage__line" aria-hidden />
        {timelineRecords.map((record) => {
          const isCurrent = record.id === currentRecord.id;

          if (isCurrent) {
            return (
              <div key={`timeline-${record.id}`} className="case-linkage__item case-linkage__item--current">
                <span className="case-linkage__dot case-linkage__dot--current" aria-hidden />
                <span className="case-linkage__item-main">
                  <span className="case-linkage__item-head">
                    <span className="case-linkage__case-id">{record.case_id ?? "未填写病案编号"}</span>
                    <span className="case-linkage__status">当前病案</span>
                  </span>
                  <span className="case-linkage__name">{buildDisplayName(record)}</span>
                  <span className="case-linkage__time">{formatDate(record.updated_at)}</span>
                </span>
              </div>
            );
          }

          return (
            <button
              key={`timeline-${record.id}`}
              type="button"
              className="case-linkage__item"
              onClick={() => onSelect(record.id)}
            >
              <span className="case-linkage__dot" aria-hidden />
              <span className="case-linkage__item-main">
                <span className="case-linkage__case-id">{record.case_id ?? "未填写病案编号"}</span>
                <span className="case-linkage__name">{buildDisplayName(record)}</span>
                <span className="case-linkage__time">{formatDate(record.updated_at)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
});

const HistoryPanel = memo(function HistoryPanel({
  consultations,
  activeId,
  onSelect,
  onFollowUp,
  onDelete,
  onClose,
  loading,
  readOnly = false,
}: {
  consultations: ConsultationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onFollowUp: (source: ConsultationSummary) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  loading: boolean;
  readOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open and close on Escape
  useEffect(() => {
    searchRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return consultations;
    return consultations.filter((c) => {
      const displayName = buildDisplayName(c).toLowerCase();
      const caseId = (c.case_id ?? "").toLowerCase();
      const relatedCaseId = (c.related_case_id ?? "").toLowerCase();
      return displayName.includes(q) || caseId.includes(q) || relatedCaseId.includes(q);
    });
  }, [consultations, query]);

  return (
    /* Backdrop */
    <div
      className="history-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="历史记录"
    >
      <div className="history-modal">
        {/* Header */}
        <div className="history-modal__header">
          <span className="history-modal__title">
            <Clock size={15} />
            历史记录
          </span>
          <div className="history-modal__header-actions">
            <button className="history-modal__close" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="history-modal__search">
          <Search size={14} className="history-search__icon" />
          <input
            ref={searchRef}
            className="history-search__input"
            type="text"
            placeholder="搜索病案…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="history-search__clear" onClick={() => setQuery("")} aria-label="清除搜索">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="history-table-shell">
          <div className={`history-table${readOnly ? " history-table--readonly" : ""}`}>
            <div className="history-table-head" aria-hidden>
              <span className="history-table-head__name">病案</span>
              <span className="history-table-head__pills">编号 / 随访</span>
              <span className="history-table-head__time">创建时间</span>
              {!readOnly ? <span className="history-table-head__actions">操作</span> : null}
            </div>

            <div className="history-modal__list">
              {loading && <div className="history-modal__empty">加载中…</div>}
              {!loading && filtered.length === 0 && (
                <div className="history-modal__empty">
                  {query ? "无匹配记录" : "暂无历史记录"}
                </div>
              )}
              {filtered.map((c) => {
                const displayName = buildDisplayName(c);
                const createdAt = formatDate(c.created_at);
                return (
                  <div
                    key={c.id}
                    className={`history-item${c.id === activeId ? " history-item--active" : ""}`}
                  >
                    <div className="history-item__content" onClick={() => onSelect(c.id)}>
                      <div className="history-item__name" title={displayName}>{displayName}</div>
                      <div className="history-item__pills">
                        {c.case_id ? (
                          <span className="history-item__pill history-item__pill--case" title={c.case_id}>{c.case_id}</span>
                        ) : null}
                        {c.related_case_id ? (
                          <span className="history-item__pill history-item__pill--related" title={c.related_case_id}>{c.related_case_id}</span>
                        ) : null}
                      </div>
                      <div className="history-item__meta" title={createdAt}>
                        <span>{createdAt}</span>
                      </div>
                      {!readOnly ? (
                        <div className="history-item__actions">
                          <button
                            className="btn btn--ghost btn--sm history-item__action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFollowUp(c);
                            }}
                            title="创建随访记录"
                          >
                            随访
                          </button>
                          <button
                            className="btn btn--ghost btn--sm history-item__action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(c.id);
                            }}
                            aria-label="删除病案"
                            title="删除病案"
                          >
                            删除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {!loading && consultations.length > 0 && (
          <div className="history-modal__footer">
            共 {consultations.length} 条{query && `，匹配 ${filtered.length} 条`}
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Case Timeline Panel (right sidebar)
// ---------------------------------------------------------------------------

const CaseTimelinePanel = memo(function CaseTimelinePanel({
  activeId,
  linkedCaseRail,
  currentRecord,
  onSelect,
}: {
  activeId: string | null;
  linkedCaseRail: LinkedCaseRail | null;
  currentRecord: ConsultationSummary | null;
  onSelect: (id: string) => void;
}) {
  if (!activeId) {
    return <p className="sidebar-empty">选择一条病案后查看关联记录</p>;
  }
  if (!linkedCaseRail || !currentRecord) {
    return <p className="sidebar-empty">本病案为独立记录</p>;
  }
  return (
    <CaseLinkTimeline
      currentRecord={currentRecord}
      timelineRecords={linkedCaseRail.timelineRecords}
      onSelect={onSelect}
    />
  );
});

// ---------------------------------------------------------------------------
// Main Workbench
// ---------------------------------------------------------------------------

export default function Workbench({
  isAdmin = false,
  viewAs,
}: {
  isAdmin?: boolean;
  viewAs?: ViewAsPreview;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReadOnly = Boolean(viewAs);

  const buildUrl = useCallback((params?: { id?: string }) => {
    const qp = new URLSearchParams();
    if (viewAs?.doctorId) {
      qp.set("viewAs", viewAs.doctorId);
    }
    if (params?.id) {
      qp.set("id", params.id);
    }
    const qs = qp.toString();
    return qs ? `/?${qs}` : "/";
  }, [viewAs?.doctorId]);

  const [form, setForm] = useState<StructuredCaseForm>(EMPTY_FORM);
  const [touched, setTouched] = useState<Set<keyof StructuredCaseForm>>(new Set());

  // Debounced errors: run zod parse 250 ms after the last keystroke to avoid
  // blocking the input event loop on every character.
  const [displayErrors, setDisplayErrors] = useState<FormErrors>({});
  useEffect(() => {
    const t = setTimeout(() => setDisplayErrors(getFormErrors(form)), 250);
    return () => clearTimeout(t);
  }, [form]);
  // Live (synchronous) errors used only for submit-button gating — cheap to
  // compute once on user action, not on every render cycle.
  const liveErrors = useMemo(() => getFormErrors(form), [form]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("new");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [rawResult, setRawResult] = useState<unknown>(null);
  const [caseId, setCaseId] = useState("");
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [relatedCaseId, setRelatedCaseId] = useState("");
  const [savedRelatedCaseId, setSavedRelatedCaseId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackUpdatedAt, setFeedbackUpdatedAt] = useState<Date | null>(null);
  const [savedFeedback, setSavedFeedback] = useState("");
  const [savedFormSnapshot, setSavedFormSnapshot] = useState(EMPTY_FORM_SNAPSHOT);
  const [analysisFormSnapshot, setAnalysisFormSnapshot] = useState<string | null>(null);
  const [analysisSavePending, setAnalysisSavePending] = useState(false);
  const [dbAnalysisStale, setDbAnalysisStale] = useState(false);
  const [recordLocked, setRecordLocked] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const caseIdInputRef = useRef<HTMLInputElement>(null);

  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialogState, setConfirmDialogState] = useState<ConfirmDialogState | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedRelatedCaseId = normalizeCaseId(relatedCaseId);
  const currentFormSnapshot = snapshotForm(form);
  const clinicalDirty = currentFormSnapshot !== savedFormSnapshot;
  const caseIdDirty = normalizedCaseId !== savedCaseId;
  const relatedCaseIdDirty = normalizedRelatedCaseId !== savedRelatedCaseId;
  const feedbackDirty = feedback !== savedFeedback;
  const metadataDirty = caseIdDirty || relatedCaseIdDirty || feedbackDirty;
  const hasUnsavedChanges = saveStatus === "unsaved" || clinicalDirty || metadataDirty;
  // dbAnalysisStale: persisted via DB (survives page reload).
  // In-memory arm: catches changes made since the last loaded/analyzed snapshot.
  const analysisStale = dbAnalysisStale || Boolean(result && analysisFormSnapshot && analysisFormSnapshot !== currentFormSnapshot);
  const linkedCaseRail = useMemo<LinkedCaseRail | null>(() => {
    if (!activeId) return null;

    const currentRecord = consultations.find((item) => item.id === activeId);
    const currentCase = normalizedCaseId;
    const currentRelated = normalizedRelatedCaseId;

    if (!currentRecord && !currentCase && !currentRelated) return null;

    const directMatches = currentRelated
      ? consultations.filter(
          (item) => item.id !== activeId && normalizeCaseId(item.case_id ?? "") === currentRelated,
        )
      : [];
    const reverseMatches = currentCase
      ? consultations.filter(
          (item) => item.id !== activeId && normalizeCaseId(item.related_case_id ?? "") === currentCase,
        )
      : [];

    const linkedRecords = [...directMatches, ...reverseMatches].filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index,
    ).sort((a, b) => getConsultationSortTime(b) - getConsultationSortTime(a));

    if (!linkedRecords.length) return null;
    const timelineCurrent = currentRecord ?? {
      id: activeId,
      consultation_name: null,
      case_id: currentCase || null,
      case_id_updated_at: null,
      related_case_id: currentRelated || null,
      related_case_id_updated_at: null,
      form_data: form,
      analysis_status: recordLocked ? "analyzed" : "draft",
      created_at: "",
      updated_at: savedAt?.toISOString() ?? "",
      analyzed_at: null,
    };
    const timelineRecords = [timelineCurrent, ...linkedRecords].sort(
      (a, b) => getConsultationSortTime(b) - getConsultationSortTime(a),
    );
    return { timelineRecords };
  }, [activeId, consultations, form, normalizedCaseId, normalizedRelatedCaseId, recordLocked, savedAt]);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "info") => {
    setToast({ message, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const openConfirmDialog = useCallback((options: Omit<ConfirmDialogState, "resolve">): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialogState({ ...options, resolve });
    });
  }, []);

  const buildHistoryDiscardWarning = useCallback(() => {
    if (!hasUnsavedChanges) return null;
    return clinicalDirty
      ? "当前病案输入已修改但尚未保存，继续后将丢失。修改内容可能影响AI分析结果。"
      : "当前病案编号、随访病案编号或给AI回馈尚未保存，继续后将丢失。";
  }, [clinicalDirty, hasUnsavedChanges]);

  const confirmDiscardChanges = useCallback((): Promise<boolean> => {
    if (!hasUnsavedChanges) return Promise.resolve(true);
    return openConfirmDialog({
      title: "未保存修改",
      message: clinicalDirty
        ? "病案输入已修改但尚未保存，离开后将丢失。建议先保存并重新分析以获取最新AI建议。"
        : "病案编号、随访病案编号或给AI回馈尚未保存，离开后将丢失。",
      confirmLabel: clinicalDirty ? "继续（不保存）" : "继续离开",
    });
  }, [clinicalDirty, hasUnsavedChanges, openConfirmDialog]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Load consultation list on mount
  useEffect(() => {
    apiListConsultations(viewAs?.doctorId)
      .then((records) => setConsultations(records))
      .catch(() => showToast("读取历史记录失败。", "error"))
      .finally(() => setHistoryLoading(false));
  }, [showToast, viewAs?.doctorId]);

  // Restore consultation from ?id= on page load / refresh
  const initialId = useRef(searchParams.get("id"));
  useEffect(() => {
    if (initialId.current) void loadConsultationIntoWorkbench(initialId.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = useCallback(<K extends keyof StructuredCaseForm>(key: K, value: StructuredCaseForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveStatus((prev) => prev === "saving" ? prev : "unsaved");
  }, []);

  const markTouched = useCallback((key: keyof StructuredCaseForm) => {
    setTouched((prev) => new Set([...prev, key]));
  }, []);

  const handleCaseIdChange = useCallback((value: string) => {
    setCaseId(value);
    setSaveStatus((prev) => prev === "saving" ? prev : "unsaved");
  }, []);

  const handleFeedbackChange = useCallback((value: string) => {
    setFeedback(value);
    setSaveStatus((prev) => prev === "saving" ? prev : "unsaved");
  }, []);

  const handleRelatedCaseIdChange = useCallback((value: string) => {
    setRelatedCaseId(value);
    setSaveStatus((prev) => prev === "saving" ? prev : "unsaved");
  }, []);

  const resetWorkbenchToNew = useCallback(() => {
    setForm(EMPTY_FORM);
    setTouched(new Set());
    setResult(null);
    setMeta(null);
    setRawResult(null);
    setCaseId("");
    setSavedCaseId(null);
    setRelatedCaseId("");
    setSavedRelatedCaseId(null);
    setFeedback("");
    setFeedbackUpdatedAt(null);
    setSavedFeedback("");
    setSavedFormSnapshot(EMPTY_FORM_SNAPSHOT);
    setAnalysisFormSnapshot(null);
    setAnalysisSavePending(false);
    setDbAnalysisStale(false);
    setRecordLocked(false);
    setActiveId(null);
    setHistoryOpen(false);
    setSaveStatus("new");
    setSavedAt(null);
    router.replace(buildUrl(), { scroll: false });
  }, [router, buildUrl]);

  async function handleNew() {
    if (!await confirmDiscardChanges()) return;
    resetWorkbenchToNew();
  }

  async function loadConsultationIntoWorkbench(id: string) {
    try {
      let nextForm = EMPTY_FORM;
      let formWarning: string | null = null;
      const record = await apiGetConsultation(id, viewAs?.doctorId);
      const parsedForm = parseHistoricalFormData(record.form_data);
      if (parsedForm) {
        nextForm = parsedForm;
        setForm(parsedForm);
        setTouched(new Set(REQUIRED_FIELDS));
      } else {
        setForm(EMPTY_FORM);
        setTouched(new Set());
        formWarning = "此病案的临床输入无法读取，已载入空白表单。";
      }
      const analysis = ensureAnalysisResult(
        record.analysis_result,
        normalizePrescriptionType(parsedForm?.prescriptionType),
      );
      setResult(analysis);
      setMeta(record.model_meta ?? null);
      setRawResult(record.analysis_raw ?? null);
      setCaseId(record.case_id ?? "");
      setSavedCaseId(normalizeCaseId(record.case_id ?? ""));
      setRelatedCaseId(record.related_case_id ?? "");
      setSavedRelatedCaseId(normalizeCaseId(record.related_case_id ?? ""));
      setFeedback(record.ai_feedback ?? "");
      setFeedbackUpdatedAt(record.ai_feedback_updated_at ? new Date(record.ai_feedback_updated_at) : null);
      setSavedFeedback(record.ai_feedback ?? "");
      setSavedFormSnapshot(snapshotForm(nextForm));
      setAnalysisFormSnapshot(record.analysis_status === "analyzed" ? snapshotForm(nextForm) : null);
      setAnalysisSavePending(false);
      setDbAnalysisStale(record.analysis_stale ?? false);
      setRecordLocked(record.analysis_status === "analyzed");
      setActiveId(id);
      setHistoryOpen(false);
      setSaveStatus("saved");
      setSavedAt(new Date(record.updated_at));
      showToast(formWarning ?? "已加载病案。", formWarning ? "info" : "success");
      router.replace(buildUrl({ id }), { scroll: false });
    } catch {
      showToast("读取病案记录失败。", "error");
    }
  }

  function createFollowUpDraft(source: ConsultationSummary) {
    const parsedForm = parseHistoricalFormData(source.form_data);
    if (!parsedForm) {
      showToast("此病案缺少可用的临床输入，无法创建随访。", "error");
      return;
    }
    setForm(parsedForm);
    setTouched(new Set(REQUIRED_FIELDS));
    setResult(null);
    setMeta(null);
    setRawResult(null);
    setCaseId("");
    setSavedCaseId(null);
    setRelatedCaseId(source.case_id ?? "");
    setSavedRelatedCaseId(null);
    setFeedback("");
    setFeedbackUpdatedAt(null);
    setSavedFeedback("");
    setSavedFormSnapshot(EMPTY_FORM_SNAPSHOT);
    setAnalysisFormSnapshot(null);
    setAnalysisSavePending(false);
    setDbAnalysisStale(false);
    setRecordLocked(false);
    setActiveId(null);
    setHistoryOpen(false);
    setSaveStatus("unsaved");
    setSavedAt(null);
    router.replace(buildUrl(), { scroll: false });
    setTimeout(() => caseIdInputRef.current?.focus(), 80);
  }

  async function handleHistorySelect(id: string) {
    const warning = buildHistoryDiscardWarning();
    const ok = await openConfirmDialog({
      title: "载入病案",
      message: warning
        ? `载入此病案将替换当前工作台内容。\n\n${warning}`
        : "载入此病案将替换当前工作台内容。",
      confirmLabel: "载入",
    });
    if (!ok) return;
    await loadConsultationIntoWorkbench(id);
  }

  async function handleHistoryFollowUp(source: ConsultationSummary) {
    const warning = buildHistoryDiscardWarning();
    const ok = await openConfirmDialog({
      title: "创建随访",
      message: warning
        ? `将以此病案的临床输入创建新的随访记录。\n\n${warning}`
        : "将以此病案的临床输入创建新的随访记录。",
      confirmLabel: "创建随访",
    });
    if (!ok) return;
    createFollowUpDraft(source);
  }

  async function handleHistoryDelete(id: string) {
    const warning = activeId === id ? buildHistoryDiscardWarning() : null;
    const ok = await openConfirmDialog({
      title: "删除病案",
      message: warning
        ? `删除此病案后不可撤销。\n\n${warning}`
        : "删除此病案后不可撤销。",
      confirmLabel: "删除",
      confirmTone: "danger",
    });
    if (!ok) return;

    try {
      await apiDeleteConsultation(id, viewAs?.doctorId);
      setConsultations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        resetWorkbenchToNew();
      }
      showToast("已删除。", "success");
    } catch {
      showToast("删除失败，请稍后重试。", "error");
    }
  }

  async function handleTimelineSelect(id: string) {
    if (!await confirmDiscardChanges()) return;
    await loadConsultationIntoWorkbench(id);
  }

  async function handleAnalyze() {
    setTouched(new Set(REQUIRED_FIELDS));
    if (Object.keys(liveErrors).length > 0) {
      showToast("请先补全必填字段。", "error");
      return;
    }

    setAnalyzing(true);
    const startedAt = Date.now();

    try {
      const data = await apiAnalyze(form, viewAs?.doctorId);
      const durationSeconds = (Date.now() - startedAt) / 1000;
      setResult(data.result);
      setRawResult(data.raw);
      setMeta({ model: data.model, repairedJson: data.repairedJson, promptVersion: data.promptVersion, durationSeconds });
      setAnalysisSavePending(true);
      setTimeout(() => {
        if (typeof resultRef.current?.scrollIntoView === "function") {
          resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);

      // Auto-save or update
      try {
        const newMeta: ApiMeta = {
          model: data.model,
          repairedJson: data.repairedJson,
          promptVersion: data.promptVersion,
          durationSeconds,
        };
        const nextAnalysisSnapshot = snapshotForm(form);
        setSaveStatus("saving");
        if (activeId) {
          const updated = await apiUpdateConsultation(activeId, {
            caseId: normalizedCaseId,
            relatedCaseId: normalizedRelatedCaseId,
            formData: form,
            analysisResult: data.result,
            analysisRaw: data.raw,
            modelMeta: newMeta,
            analysisStatus: "analyzed",
          }, viewAs?.doctorId);
          setConsultations((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)));
          setCaseId(updated.case_id ?? "");
          setSavedCaseId(normalizeCaseId(updated.case_id ?? ""));
          setRelatedCaseId(updated.related_case_id ?? "");
          setSavedRelatedCaseId(normalizeCaseId(updated.related_case_id ?? ""));
          setFeedback(updated.ai_feedback ?? "");
          setFeedbackUpdatedAt(updated.ai_feedback_updated_at ? new Date(updated.ai_feedback_updated_at) : null);
          setSavedFeedback(updated.ai_feedback ?? "");
        } else {
          const saved = await apiSaveNew({
            consultationName: form.consultationName || "",
            caseId: normalizedCaseId,
            relatedCaseId: normalizedRelatedCaseId,
            formData: form,
            analysisResult: data.result,
            analysisRaw: data.raw,
            modelMeta: newMeta,
          }, viewAs?.doctorId);
          setActiveId(saved.id);
          setConsultations((prev) => [saved, ...prev]);
          setCaseId(saved.case_id ?? "");
          setSavedCaseId(normalizeCaseId(saved.case_id ?? ""));
          setRelatedCaseId(saved.related_case_id ?? "");
          setSavedRelatedCaseId(normalizeCaseId(saved.related_case_id ?? ""));
          setSavedFeedback(saved.ai_feedback ?? "");
        }
        setSavedFormSnapshot(nextAnalysisSnapshot);
        setAnalysisFormSnapshot(nextAnalysisSnapshot);
        setAnalysisSavePending(false);
        setDbAnalysisStale(false);
        setSaveStatus("saved");
        setSavedAt(new Date());
        setRecordLocked(true);
      } catch {
        // Auto-save failure is non-blocking; doctor can retry via save button
        setSaveStatus("unsaved");
        showToast("分析完成，自动保存失败，请手动保存。", "info");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "分析失败，请稍后重试。", "error");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!activeId && !result) return;
    if (clinicalDirty && Object.keys(liveErrors).length > 0) {
      setTouched(new Set(REQUIRED_FIELDS));
      setSaveStatus("unsaved");
      showToast("请先补全必填字段。", "error");
      return;
    }
    setSaving(true);
    setSaveStatus("saving");
    try {
      const saveMeta: ApiMeta = meta ?? {};
      if (activeId) {
        const updatePayload = {
          ...(clinicalDirty || analysisSavePending
            ? {
                formData: form,
              }
            : {}),
          ...(caseIdDirty ? { caseId: normalizedCaseId } : {}),
          ...(relatedCaseIdDirty ? { relatedCaseId: normalizedRelatedCaseId } : {}),
          ...(feedbackDirty ? { aiFeedback: feedback } : {}),
          ...(analysisSavePending && result
            ? {
                analysisResult: result,
                analysisRaw: rawResult,
                modelMeta: saveMeta,
                analysisStatus: "analyzed",
              }
            : {}),
        };

        if (Object.keys(updatePayload).length === 0) {
          setSaveStatus("saved");
          setSaving(false);
          return;
        }

        const updated = await apiUpdateConsultation(activeId, updatePayload, viewAs?.doctorId);
        setConsultations((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)));
        setCaseId(updated.case_id ?? "");
        setSavedCaseId(normalizeCaseId(updated.case_id ?? ""));
        setRelatedCaseId(updated.related_case_id ?? "");
        setSavedRelatedCaseId(normalizeCaseId(updated.related_case_id ?? ""));
        setFeedback(updated.ai_feedback ?? "");
        setFeedbackUpdatedAt(updated.ai_feedback_updated_at ? new Date(updated.ai_feedback_updated_at) : null);
        setSavedFeedback(updated.ai_feedback ?? "");
        setSavedFormSnapshot(snapshotForm(form));
        if (analysisSavePending) {
          setAnalysisFormSnapshot(snapshotForm(form));
          setAnalysisSavePending(false);
          setDbAnalysisStale(false);
        } else if (clinicalDirty && recordLocked) {
          // Clinical edits saved without re-analysis on an analyzed record → stale
          setDbAnalysisStale(true);
        }
      } else {
        if (!result) {
          setSaveStatus("unsaved");
          setSaving(false);
          return;
        }
        const saved = await apiSaveNew({
          consultationName: form.consultationName || "",
          caseId: normalizedCaseId,
          relatedCaseId: normalizedRelatedCaseId,
          formData: form,
          analysisResult: result,
          analysisRaw: rawResult,
          modelMeta: saveMeta,
        }, viewAs?.doctorId);
        setActiveId(saved.id);
        setConsultations((prev) => [saved, ...prev]);
        setCaseId(saved.case_id ?? "");
        setSavedCaseId(normalizeCaseId(saved.case_id ?? ""));
        setRelatedCaseId(saved.related_case_id ?? "");
        setSavedRelatedCaseId(normalizeCaseId(saved.related_case_id ?? ""));
        setSavedFeedback(saved.ai_feedback ?? "");
        const nextAnalysisSnapshot = snapshotForm(form);
        setSavedFormSnapshot(nextAnalysisSnapshot);
        setAnalysisFormSnapshot(nextAnalysisSnapshot);
        setAnalysisSavePending(false);
        setDbAnalysisStale(false);
      }
      const now = new Date();
      setSaveStatus("saved");
      setSavedAt(now);
      setRecordLocked(true);
      showToast("已保存。", "success");
    } catch {
      setSaveStatus("unsaved");
      showToast("保存失败，请稍后重试。", "error");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const Icon = BRANDING.icon;

  return (
    <div className="workbench">
      {/* Header */}
      <header className="workbench__header">
        <div className="workbench__header-inner">
          <div className="workbench__brand">
            <button
              className="workbench__brand-mark"
              onClick={isReadOnly ? undefined : handleNew}
              title="回到首页 / 新建"
              aria-label="回到首页"
            disabled={isReadOnly}
            >
              <Icon size={18} strokeWidth={2.25} />
            </button>
            <button
              className="workbench__brand-text"
              onClick={isReadOnly ? undefined : handleNew}
              title="回到首页 / 新建"
              aria-label="回到首页"
            disabled={isReadOnly}
            >
              <span className="workbench__brand-title">
                {BRANDING.name}
                <span className="workbench__brand-sub"> {BRANDING.subtitle}</span>
              </span>
            </button>
          </div>
          <div className="workbench__actions">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setHistoryOpen((o) => !o)}
              title="历史记录"
            >
              <Clock size={15} />
              <span>历史</span>
            </button>
            {historyOpen && (
              <HistoryPanel
                consultations={consultations}
                activeId={activeId}
                onSelect={(id) => void handleHistorySelect(id)}
                onFollowUp={(source) => void handleHistoryFollowUp(source)}
                onDelete={(id) => void handleHistoryDelete(id)}
                onClose={() => setHistoryOpen(false)}
                loading={historyLoading}
                readOnly={isReadOnly}
              />
            )}
            {!isReadOnly && (
              <button className="btn btn--ghost btn--sm" onClick={handleNew} title="新建">
                <Plus size={15} />
                <span>新建</span>
              </button>
            )}
            {!isReadOnly && ((activeId && hasUnsavedChanges) || (!activeId && result && hasUnsavedChanges)) && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void handleSave()}
                disabled={saving}
                title="保存"
              >
                {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
                <span>保存</span>
              </button>
            )}
            {isAdmin && (
              <a className="btn btn--ghost btn--sm" href="/admin" title="后台管理">
                <LayoutDashboard size={15} />
                <span className="sr-only">后台管理</span>
              </a>
            )}
            <button
              className="btn btn--ghost btn--sm"
              title="退出"
              onClick={() => {
                void confirmDiscardChanges().then((ok) => {
                  if (ok) window.location.href = "/auth/signout";
                });
              }}
            >
              <LogOut size={15} />
              <span className="sr-only">退出</span>
            </button>
          </div>
        </div>
      </header>

      {/* Form */}
      {viewAs ? <ViewAsBanner doctorId={viewAs.doctorId} email={viewAs.email} /> : null}

      <main className={`workbench__main ${viewAs ? "workbench__main--preview" : ""}`}>
        <div className="workbench__body">

          {/* Left sidebar — recurring AI risk nudge card */}
          <aside className="workbench__sidebar workbench__sidebar--left">
            <RiskNudgePanel viewAsDoctorId={viewAs?.doctorId} />
          </aside>

          {/* Center — main form + results (unchanged) */}
          <div className="workbench__content">
        <section className="form-section">
          <div className="form-card">
            {/* Clone provenance banner — shown when a consultation was cloned from another doctor */}
            {meta?.cloned_from_doctor_email && (
              <div className="clone-source-banner">
                拷贝自 {meta.cloned_from_doctor_email} 的病案 — 修改与保存只影响你的账户
              </div>
            )}

            {/* Row 1: Meta strip — sex / age / prescription type / case id */}
            {!isReadOnly && recordLocked && (
              <div className="readonly-banner">
                {analysisStale
                  ? "病案输入已修改，现有AI分析可能不完全对应当前内容。如需要，请重新分析。"
                  : "该病案已完成分析并归档，你仍可以继续修改原始输入并保存；如有需要，可重新分析更新结果。"}
              </div>
            )}

            <div className="form-row--meta">
              <fieldset className="form-fieldset form-fieldset--meta">
                <div className="form-group">
                  <label className="form-label">性别 Gender</label>
                  <div className="segmented-control">
                    {SEX_VALUES.map((sex) => (
                      <button
                        key={sex}
                        className={`segmented-btn ${form.patientSex === sex ? "segmented-btn--active" : ""}`}
                        onClick={() => setField("patientSex", sex)}
                        type="button" disabled={isReadOnly}
                      >
                        {sex}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label form-label--required">年龄 Age</label>
                  <input
                    className={`form-input form-input--sm ${touched.has("patientAge") ? (displayErrors.patientAge ? "form-input--error" : "form-input--valid") : ""}`}
                    type="number"
                    placeholder="岁"
                    value={form.patientAge}
                    onChange={(e) => setField("patientAge", e.target.value)}
                    onBlur={() => markTouched("patientAge")}
                    disabled={isReadOnly}
                    min={1}
                    max={120}
                  />
                  <FieldError message={touched.has("patientAge") ? displayErrors.patientAge : undefined} />
                </div>
                <div className="form-group">
                  <label className="form-label form-label--required">处方类型 Prescription Type</label>
                  <div className="segmented-control">
                    {PRESCRIPTION_TYPES.map((pt) => (
                      <button
                        key={pt}
                        className={`segmented-btn ${form.prescriptionType === pt ? "segmented-btn--active" : ""}`}
                        onClick={() => setField("prescriptionType", pt)}
                        type="button" disabled={isReadOnly}
                      >
                        {pt}
                      </button>
                    ))}
                  </div>
                  <FieldError message={touched.has("prescriptionType") ? displayErrors.prescriptionType as string | undefined : undefined} />
                </div>
              </fieldset>
              <div className="form-group">
                <label className="form-label" htmlFor="case-id-input">病案编号 Case ID</label>
                <input
                  ref={caseIdInputRef}
                  id="case-id-input"
                  className="form-input form-input--sm case-id-panel__input"
                  type="text"
                  placeholder="例：0004222"
                  value={caseId}
                  onChange={(event) => handleCaseIdChange(event.target.value)}
                  disabled={isReadOnly}
                  maxLength={64}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="related-case-id-input">随访病案编号 Follow-up Case ID</label>
                <input
                  id="related-case-id-input"
                  className="form-input form-input--sm case-id-panel__input"
                  type="text"
                  placeholder="例：0004221"
                  value={relatedCaseId}
                  onChange={(event) => handleRelatedCaseIdChange(event.target.value)}
                  disabled={isReadOnly}
                  maxLength={64}
                />
              </div>
            </div>

            <fieldset className="form-fieldset">

            {/* Row 2: Chief complaint */}
            <div className="form-group">
              <label className="form-label form-label--required">主诉 Presenting Complaint</label>
              <input
                className={`form-input ${touched.has("chiefComplaint") ? (displayErrors.chiefComplaint ? "form-input--error" : "form-input--valid") : ""}`}
                type="text"
                placeholder="例：头痛眩晕反复发作"
                value={form.chiefComplaint}
                onChange={(e) => setField("chiefComplaint", e.target.value)}
                onBlur={() => markTouched("chiefComplaint")}
                disabled={isReadOnly}
                maxLength={200}
              />
              <FieldError message={touched.has("chiefComplaint") ? displayErrors.chiefComplaint : undefined} />
            </div>

            {/* Row 4: Current illness */}
            <div className="form-group">
              <label className="form-label form-label--required">现病史 History of Presenting Complaint</label>
              <textarea
                className={`form-textarea ${touched.has("currentIllness") ? (displayErrors.currentIllness ? "form-input--error" : "form-input--valid") : ""}`}
                placeholder="例：头痛3个月余，伴轻度眩晕，劳累后加重"
                value={form.currentIllness}
                onChange={(e) => setField("currentIllness", e.target.value)}
                onBlur={() => markTouched("currentIllness")}
                disabled={isReadOnly}
                rows={4}
                maxLength={2000}
              />
              <FieldError message={touched.has("currentIllness") ? displayErrors.currentIllness : undefined} />
            </div>

            {/* Row 5: Past history + Physical exam (2 cols) */}
            <div className="form-row form-row--2col">
              <div className="form-group">
                <label className="form-label form-label--required">既往史 Past Medical History</label>
                <textarea
                  className={`form-textarea ${touched.has("pastHistory") ? (displayErrors.pastHistory ? "form-input--error" : "form-input--valid") : ""}`}
                  placeholder="例：高血压病史5年，规律服药；如无相关病史请填写：无"
                  value={form.pastHistory}
                  onChange={(e) => setField("pastHistory", e.target.value)}
                  onBlur={() => markTouched("pastHistory")}
                  disabled={isReadOnly}
                  rows={3}
                  maxLength={1000}
                />
                <FieldError message={touched.has("pastHistory") ? displayErrors.pastHistory : undefined} />
              </div>
              <div className="form-group">
                <label className="form-label form-label--required">体格检查 Medical Examination</label>
                <textarea
                  className={`form-textarea ${touched.has("physicalExam") ? (displayErrors.physicalExam ? "form-input--error" : "form-input--valid") : ""}`}
                  placeholder="舌脉、查体重点"
                  value={form.physicalExam}
                  onChange={(e) => setField("physicalExam", e.target.value)}
                  onBlur={() => markTouched("physicalExam")}
                  disabled={isReadOnly}
                  rows={3}
                  maxLength={1000}
                />
                <FieldError message={touched.has("physicalExam") ? displayErrors.physicalExam : undefined} />
              </div>
            </div>

            {/* Row 6: Diagnosis + Pattern (2 cols) */}
            <div className="form-row form-row--2col">
              <div className="form-group">
                <label className="form-label form-label--required">诊断 Diagnosis</label>
                <input
                  className={`form-input ${touched.has("diagnosis") ? (displayErrors.diagnosis ? "form-input--error" : "form-input--valid") : ""}`}
                  type="text"
                  placeholder="例：头痛 / 眩晕"
                  value={form.diagnosis}
                  onChange={(e) => setField("diagnosis", e.target.value)}
                  onBlur={() => markTouched("diagnosis")}
                  disabled={isReadOnly}
                  maxLength={100}
                />
                <FieldError message={touched.has("diagnosis") ? displayErrors.diagnosis : undefined} />
              </div>
              <div className="form-group">
                <label className="form-label form-label--required">证型 Pattern</label>
                <input
                  className={`form-input ${touched.has("pattern") ? (displayErrors.pattern ? "form-input--error" : "form-input--valid") : ""}`}
                  type="text"
                  placeholder="例：肝阳上亢"
                  value={form.pattern}
                  onChange={(e) => setField("pattern", e.target.value)}
                  onBlur={() => markTouched("pattern")}
                  disabled={isReadOnly}
                  maxLength={100}
                />
                <FieldError message={touched.has("pattern") ? displayErrors.pattern : undefined} />
              </div>
            </div>

            {/* Row 7: Prescription */}
            <div className="form-group">
              <label className="form-label form-label--required">处方 Treatment</label>
              <textarea
                className={`form-textarea form-textarea--tall ${touched.has("prescription") ? (displayErrors.prescription ? "form-input--error" : "form-input--valid") : ""}`}
                placeholder={
                  form.prescriptionType === "针灸"
                    ? "例：百会、太冲、风池，平补平泻，留针20分钟"
                    : form.prescriptionType === "推拿"
                    ? "例：颈肩腰背推拿松解，配合滚法、按揉、点压与牵伸"
                    : form.prescriptionType === "综合调理"
                    ? "例：穴位 + 方药 + 生活调摄建议"
                    : "例：天麻钩藤饮加减，天麻10g 钩藤15g…"
                }
                value={form.prescription}
                onChange={(e) => setField("prescription", e.target.value)}
                onBlur={() => markTouched("prescription")}
                disabled={isReadOnly}
                rows={5}
                maxLength={2000}
              />
              <FieldError message={touched.has("prescription") ? displayErrors.prescription : undefined} />
            </div>

            </fieldset>

            {/* Submit */}
            {!isReadOnly && (
              <div className="form-submit">
                <button
                  className="btn btn--primary btn--lg"
                  onClick={() => void handleAnalyze()}
                  disabled={analyzing || Object.keys(liveErrors).length > 0}
                >
                  {analyzing ? (
                    <>
                      <LoaderCircle size={18} className="spin" />
                      分析中…
                    </>
                  ) : result ? "重新分析" : "开始分析"}
                </button>
              </div>
            )}

            {/* Status bar */}
            <StatusBar
              saveStatus={saveStatus}
              savedAt={savedAt}
              analyzing={analyzing}
              form={form}
              readOnly={isReadOnly}
            />

          </div>
        </section>

        {/* Loading shimmer */}
        {analyzing && (
          <section className="result-section-wrap result-section-wrap--loading" aria-label="分析中">
            <div className="result-layout">
              <div className="result-top-row">
                <ShimmerCard />
                <ShimmerCard />
              </div>
              <div className="result-bottom-row">
                <ShimmerCard />
                <ShimmerCard />
              </div>
            </div>
          </section>
        )}

        {/* Result */}
        {!analyzing && result && (
          <section className="result-section-wrap" ref={resultRef}>
            <div className="result-layout">

              {/* 辨证警示 — critical diagnostic alert, shown above 重点结论 */}
              {result.criticalRisk && (
                <DiagnosticAlertBanner
                  summary={result.criticalRisk.summary}
                  highlights={result.criticalRisk.highlights}
                />
              )}

              {/* 重点结论 — full width conclusion card */}
              {result.keyPoints.length > 0 && (
                <ResultColumn title="重点结论 Conclusion" colorVariant="green" icon={<CheckCircle2 size={15} />}>
                  <div className="result-keypoints">
                    {result.keyPoints.map((kp, i) => (
                      <p key={i}>
                        {result.criticalRisk
                          ? <HighlightedText text={kp} highlights={result.criticalRisk.highlights} />
                          : kp}
                      </p>
                    ))}
                  </div>
                </ResultColumn>
              )}

              {/* Top row: 判断 + 风险与提醒, each full width */}
              <div className="result-top-row">

                {/* 判断 */}
                {result.groups[0] && (
                  <ResultColumn title="判断 Assessment" colorVariant="green" icon={<Brain size={15} />}>
                    {result.groups[0].sections.map((section) => (
                      <ResultSection key={section.title} title={section.title} items={section.items} />
                    ))}
                  </ResultColumn>
                )}

                {/* 风险与提醒 */}
                {result.cautions.length > 0 && !result.cautions.every((c) => c.includes("请结合面诊")) && (
                  <ResultColumn title="风险与提醒 Cautions" colorVariant="red" icon={<AlertTriangle size={15} />}>
                    <ul className="cautions-list">
                      {result.cautions.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </ResultColumn>
                )}
              </div>

              {/* Bottom row: 方案 (50%) + 随访监测 (50%) */}
              <div className="result-bottom-row">
                {result.groups[1] && (
                  <ResultColumn title="方案 Plan" colorVariant="blue" icon={<FileText size={15} />}>
                    {result.groups[1].sections.map((section) => (
                      <ResultSection key={section.title} title={section.title} items={section.items} />
                    ))}
                  </ResultColumn>
                )}
                {result.groups[2] && (
                  <ResultColumn title="随访监测 Follow-up" colorVariant="blue" icon={<AlertTriangle size={15} />}>
                    {result.groups[2].sections.map((section) => (
                      <ResultSection key={section.title} title={section.title} items={section.items} />
                    ))}
                  </ResultColumn>
                )}
              </div>
            </div>

            {/* Evidence footer */}
            {result.evidence && result.evidence.length > 0 && (
              <div className="evidence-footer">
                {result.evidence.map((e, i) => (
                  <span key={i}>{e}</span>
                ))}
              </div>
            )}

            {/* Non-clinical notes — muted footnote, only when non-empty */}
            {result.nonClinical && result.nonClinical.length > 0 && (
              <div className="non-clinical-notes">
                <span className="non-clinical-notes__label">非临床信息（已从临床分析中分流）</span>
                {result.nonClinical.map((note, i) => (
                  <span key={i} className="non-clinical-notes__item">• {note}</span>
                ))}
              </div>
            )}
          </section>
        )}

        {!analyzing && result && activeId && (
          <FeedbackCard
            value={feedback}
            onChange={handleFeedbackChange}
            updatedAt={feedbackUpdatedAt}
            disabled={isReadOnly}
          />
        )}
          </div>

          {/* Right sidebar — case linkage timeline */}
          <aside className="workbench__sidebar workbench__sidebar--right">
            <div className="sidebar-section-title">病案关联</div>
            <CaseTimelinePanel
              activeId={activeId}
              linkedCaseRail={linkedCaseRail}
              currentRecord={
                activeId
                  ? (consultations.find((item) => item.id === activeId) ?? {
                      id: activeId,
                      consultation_name: null,
                      case_id: normalizeCaseId(caseId),
                      case_id_updated_at: null,
                      related_case_id: normalizeCaseId(relatedCaseId),
                      related_case_id_updated_at: null,
                      form_data: form,
                      analysis_status: recordLocked ? "analyzed" : "draft",
                      created_at: "",
                      updated_at: "",
                      analyzed_at: null,
                    })
                  : null
              }
              onSelect={(id) => void handleTimelineSelect(id)}
            />
          </aside>

        </div>
      </main>

      {/* Footer */}
      <footer className="workbench-footer">
        <span>{BRANDING.author}</span>
        <span className="workbench-footer__sep">·</span>
        <span>Powered by DeepSeek</span>
      </footer>

      {/* Toast */}
      {toast && <Toast toast={toast} onClose={dismissToast} />}

      {/* Confirm dialog */}
      {confirmDialogState && (
        <ConfirmDialog
          state={confirmDialogState}
          onResolve={(ok) => {
            confirmDialogState.resolve(ok);
            setConfirmDialogState(null);
          }}
        />
      )}
    </div>
  );
}
