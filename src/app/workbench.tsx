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
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StructuredCaseForm, structuredCaseSchema, PRESCRIPTION_TYPES, SEX_VALUES } from "@/lib/forms/caseSchema";
import { AnalysisResult, ensureAnalysisResult, normalizePrescriptionType } from "@/lib/ai/analysisResult";
import { BRANDING } from "@/lib/branding";
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
  form_data: StructuredCaseForm | null;
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
};

type ToastState = { message: string; tone: "success" | "error" | "info" };

type FormErrors = Partial<Record<keyof StructuredCaseForm, string>>;

type SaveStatus = "new" | "unsaved" | "saving" | "saved";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof StructuredCaseForm)[] = [
  "patientAge", "prescriptionType", "chiefComplaint", "currentIllness",
  "physicalExam", "diagnosis", "pattern", "prescription",
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

async function apiAnalyze(form: StructuredCaseForm): Promise<{
  result: AnalysisResult;
  raw: unknown;
  model: string;
  promptVersion: string;
  repairedJson: boolean;
}> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function apiListConsultations(): Promise<ConsultationSummary[]> {
  const response = await fetch("/api/consultations", { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = (await response.json()) as { records: ConsultationSummary[] };
  return data.records;
}

async function apiGetConsultation(id: string): Promise<ConsultationRecord> {
  const response = await fetch(`/api/consultations/${id}`, { cache: "no-store" });
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
}): Promise<ConsultationRecord> {
  const response = await fetch("/api/consultations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
): Promise<ConsultationRecord> {
  const response = await fetch(`/api/consultations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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

async function apiDeleteConsultation(id: string): Promise<void> {
  const response = await fetch(`/api/consultations/${id}`, { method: "DELETE" });
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
  if (c.form_data) {
    const { patientSex, patientAge, chiefComplaint } = c.form_data;
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

function getConsultationSortTime(record: Pick<ConsultationSummary, "updated_at" | "created_at">) {
  const updated = Date.parse(record.updated_at);
  if (!Number.isNaN(updated)) return updated;
  const created = Date.parse(record.created_at);
  if (!Number.isNaN(created)) return created;
  return 0;
}

type LinkedCaseRail = {
  linkedRecords: ConsultationSummary[];
};

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

const StatusBar = memo(function StatusBar({
  saveStatus,
  savedAt,
  analyzing,
  form,
}: {
  saveStatus: SaveStatus;
  savedAt: Date | null;
  analyzing: boolean;
  form: StructuredCaseForm;
}) {
  const hasIdentity = !!(form.patientAge || form.chiefComplaint);
  const parts = [
    hasIdentity ? form.patientSex : null,
    form.patientAge ? `${form.patientAge}岁` : null,
    form.chiefComplaint || null,
  ].filter(Boolean) as string[];
  const displayName = parts.length ? parts.join(" · ") : null;

  let indicator: ReactNode;
  if (analyzing) {
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
}: {
  value: string;
  onChange: (value: string) => void;
  updatedAt: Date | null;
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
          rows={4}
          maxLength={1000}
        />
      </div>
    </section>
  );
});

const CaseLinkTimeline = memo(function CaseLinkTimeline({
  currentRecord,
  linkedRecords,
  onSelect,
}: {
  currentRecord: ConsultationSummary;
  linkedRecords: ConsultationSummary[];
  onSelect: (id: string) => void;
}) {
  if (!linkedRecords.length) return null;

  return (
    <aside className="case-linkage-rail" aria-label="关联病案">
      <div className="case-linkage-rail__header">
        <span className="case-linkage-rail__title">关联病案</span>
      </div>
      <div className="case-linkage">
        <div className="case-linkage__line" aria-hidden />
        <span className="case-linkage__section-label">当前病案</span>
        <div className="case-linkage__item case-linkage__item--current">
          <span className="case-linkage__dot case-linkage__dot--current" aria-hidden />
          <span className="case-linkage__item-main">
            <span className="case-linkage__case-id">{currentRecord.case_id ?? "未填写病案编号"}</span>
            <span className="case-linkage__name">{buildDisplayName(currentRecord)}</span>
          </span>
        </div>

        <span className="case-linkage__section-label">关联病案</span>
        {linkedRecords.map((record) => (
          <button
            key={`linked-${record.id}`}
            type="button"
            className="case-linkage__item"
            onClick={() => onSelect(record.id)}
          >
            <span className="case-linkage__dot" aria-hidden />
            <span className="case-linkage__item-main">
              <span className="case-linkage__case-id">{record.case_id ?? "未填写病案编号"}</span>
              <span className="case-linkage__name">{buildDisplayName(record)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
});

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

const HistoryPanel = memo(function HistoryPanel({
  consultations,
  activeId,
  onSelect,
  onDelete,
  onClose,
  loading,
}: {
  consultations: ConsultationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  loading: boolean;
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

        {/* List */}
        <div className="history-modal__list">
          {loading && <div className="history-modal__empty">加载中…</div>}
          {!loading && filtered.length === 0 && (
            <div className="history-modal__empty">
              {query ? "无匹配记录" : "暂无历史记录"}
            </div>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              className={`history-item ${c.id === activeId ? "history-item--active" : ""}`}
              onClick={() => { onSelect(c.id); onClose(); }}
            >
              <div className="history-item__name">{buildDisplayName(c)}</div>
              <span className="history-item__pill history-item__pill--case">
                {c.case_id ?? "—"}
              </span>
              <span className="history-item__pill history-item__pill--related">
                {c.related_case_id ?? "—"}
              </span>
              <div className="history-item__meta">
                <span>{formatDate(c.updated_at)}</span>
              </div>
              <button
                className="history-item__delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                title="删除"
                aria-label="删除病案"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
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
// Main Workbench
// ---------------------------------------------------------------------------

export default function Workbench({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [recordLocked, setRecordLocked] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedRelatedCaseId = normalizeCaseId(relatedCaseId);
  const caseIdDirty = normalizedCaseId !== savedCaseId;
  const relatedCaseIdDirty = normalizedRelatedCaseId !== savedRelatedCaseId;
  const feedbackDirty = feedback !== savedFeedback;
  const hasUnsavedChanges = saveStatus === "unsaved" || caseIdDirty || relatedCaseIdDirty || feedbackDirty;
  const linkedCaseRail = useMemo<LinkedCaseRail | null>(() => {
    if (!activeId) return null;

    const currentRecord = consultations.find((item) => item.id === activeId);
    if (!currentRecord) return null;

    const currentCase = normalizeCaseId(currentRecord.case_id ?? "");
    const currentRelated = normalizeCaseId(currentRecord.related_case_id ?? "");

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
    return { linkedRecords };
  }, [activeId, consultations]);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "info") => {
    setToast({ message, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const confirmDiscardChanges = useCallback(() => {
    if (!hasUnsavedChanges) return true;
    return window.confirm("你有未保存的修改，离开后将丢失。是否继续？");
  }, [hasUnsavedChanges]);

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
    apiListConsultations()
      .then((records) => setConsultations(records))
      .catch(() => showToast("读取历史记录失败。", "error"))
      .finally(() => setHistoryLoading(false));
  }, [showToast]);

  // Restore consultation from ?id= on page load / refresh
  const initialId = useRef(searchParams.get("id"));
  useEffect(() => {
    if (initialId.current) void handleSelectHistory(initialId.current);
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
    setRecordLocked(false);
    setActiveId(null);
    setHistoryOpen(false);
    setSaveStatus("new");
    setSavedAt(null);
    router.replace("/", { scroll: false });
  }, [router]);

  function handleNew() {
    if (!confirmDiscardChanges()) return;
    resetWorkbenchToNew();
  }

  async function handleSelectHistory(id: string) {
    if (id !== activeId && !confirmDiscardChanges()) return;
    try {
      const record = await apiGetConsultation(id);
      if (record.form_data) {
        // Backward compat: records saved before the prescriptionType array→string
        // migration store the value as e.g. ["方药"]. Normalize before parsing.
        const raw = record.form_data as Record<string, unknown>;
        const coerced = {
          ...raw,
          prescriptionType: Array.isArray(raw.prescriptionType)
            ? (raw.prescriptionType[0] ?? "方药")
            : raw.prescriptionType,
        };
        const parsed = structuredCaseSchema.safeParse(coerced);
        if (parsed.success) {
          setForm(parsed.data);
          setTouched(new Set(REQUIRED_FIELDS));
        }
      }
      const analysis = ensureAnalysisResult(
        record.analysis_result,
        normalizePrescriptionType((record.form_data as StructuredCaseForm | null | undefined)?.prescriptionType),
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
      setRecordLocked(record.analysis_status === "analyzed");
      setActiveId(id);
      setHistoryOpen(false);
      setSaveStatus("saved");
      setSavedAt(new Date(record.updated_at));
      showToast("已加载病案。", "success");
      router.replace(`/?id=${id}`, { scroll: false });
    } catch {
      showToast("读取病案记录失败。", "error");
    }
  }

  async function handleDeleteHistory(id: string) {
    if (!confirmDiscardChanges()) return;
    try {
      await apiDeleteConsultation(id);
      setConsultations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        resetWorkbenchToNew();
      }
      showToast("已删除。", "success");
    } catch {
      showToast("删除失败，请稍后重试。", "error");
    }
  }

  async function handleAnalyze() {
    setTouched(new Set(REQUIRED_FIELDS));
    if (Object.keys(liveErrors).length > 0) {
      showToast("请先补全必填字段。", "error");
      return;
    }

    setAnalyzing(true);
    setResult(null);
    const startedAt = Date.now();

    try {
      const data = await apiAnalyze(form);
      const durationSeconds = (Date.now() - startedAt) / 1000;
      setResult(data.result);
      setRawResult(data.raw);
      setMeta({ model: data.model, repairedJson: data.repairedJson, promptVersion: data.promptVersion, durationSeconds });
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
          });
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
          });
          setActiveId(saved.id);
          setConsultations((prev) => [saved, ...prev]);
          setCaseId(saved.case_id ?? "");
          setSavedCaseId(normalizeCaseId(saved.case_id ?? ""));
          setRelatedCaseId(saved.related_case_id ?? "");
          setSavedRelatedCaseId(normalizeCaseId(saved.related_case_id ?? ""));
          setSavedFeedback(saved.ai_feedback ?? "");
        }
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
    if (!result) return;
    setSaving(true);
    setSaveStatus("saving");
    try {
      const saveMeta: ApiMeta = meta ?? {};
      if (activeId && recordLocked) {
        const updated = await apiUpdateConsultation(activeId, {
          caseId: normalizedCaseId,
          relatedCaseId: normalizedRelatedCaseId,
          aiFeedback: feedback,
        });
        setConsultations((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)));
        setCaseId(updated.case_id ?? "");
        setSavedCaseId(normalizeCaseId(updated.case_id ?? ""));
        setRelatedCaseId(updated.related_case_id ?? "");
        setSavedRelatedCaseId(normalizeCaseId(updated.related_case_id ?? ""));
        setFeedback(updated.ai_feedback ?? "");
        setFeedbackUpdatedAt(updated.ai_feedback_updated_at ? new Date(updated.ai_feedback_updated_at) : null);
        setSavedFeedback(updated.ai_feedback ?? "");
      } else if (activeId) {
        const updated = await apiUpdateConsultation(activeId, {
          consultationName: form.consultationName,
          caseId: normalizedCaseId,
          relatedCaseId: normalizedRelatedCaseId,
          formData: form,
          analysisResult: result,
          analysisRaw: rawResult,
          modelMeta: saveMeta,
          analysisStatus: "analyzed",
        });
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
          analysisResult: result,
          analysisRaw: rawResult,
          modelMeta: saveMeta,
        });
        setActiveId(saved.id);
        setConsultations((prev) => [saved, ...prev]);
        setCaseId(saved.case_id ?? "");
        setSavedCaseId(normalizeCaseId(saved.case_id ?? ""));
        setRelatedCaseId(saved.related_case_id ?? "");
        setSavedRelatedCaseId(normalizeCaseId(saved.related_case_id ?? ""));
        setSavedFeedback(saved.ai_feedback ?? "");
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
            <div className="workbench__brand-mark" aria-hidden>
              <Icon size={18} strokeWidth={2.25} />
            </div>
            <div className="workbench__brand-text">
              <span className="workbench__brand-title">
                {BRANDING.name}
                <span className="workbench__brand-sub"> {BRANDING.subtitle}</span>
              </span>
            </div>
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
                onSelect={(id) => void handleSelectHistory(id)}
                onDelete={(id) => void handleDeleteHistory(id)}
                onClose={() => setHistoryOpen(false)}
                loading={historyLoading}
              />
            )}
            <button className="btn btn--ghost btn--sm" onClick={handleNew} title="新建">
              <Plus size={15} />
              <span>新建</span>
            </button>
            {result && (!recordLocked || hasUnsavedChanges) && (
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
                <Settings2 size={15} />
                <span className="sr-only">后台管理</span>
              </a>
            )}
            <a
              className="btn btn--ghost btn--sm"
              href="/auth/signout"
              title="退出"
              onClick={(event) => {
                if (!confirmDiscardChanges()) {
                  event.preventDefault();
                }
              }}
            >
              <LogOut size={15} />
              <span className="sr-only">退出</span>
            </a>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="workbench__main">
        <div className="workbench__body">
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
            {recordLocked && (
              <div className="readonly-banner">
                该病案已完成分析并归档，原始字段仅供查看；如需补充意见，请使用下方“给AI回馈”。
              </div>
            )}

            <div className="form-row--meta">
              <fieldset className="form-fieldset form-fieldset--meta" disabled={recordLocked}>
                <div className="form-group">
                  <label className="form-label">性别 Gender</label>
                  <div className="segmented-control">
                    {SEX_VALUES.map((sex) => (
                      <button
                        key={sex}
                        className={`segmented-btn ${form.patientSex === sex ? "segmented-btn--active" : ""}`}
                        onClick={() => setField("patientSex", sex)}
                        type="button"
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
                        type="button"
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
                  id="case-id-input"
                  className="form-input form-input--sm case-id-panel__input"
                  type="text"
                  placeholder="例：0004222"
                  value={caseId}
                  onChange={(event) => handleCaseIdChange(event.target.value)}
                  maxLength={64}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="related-case-id-input">关联病案编号 Related Case ID</label>
                <input
                  id="related-case-id-input"
                  className="form-input form-input--sm case-id-panel__input"
                  type="text"
                  placeholder="例：0004221"
                  value={relatedCaseId}
                  onChange={(event) => handleRelatedCaseIdChange(event.target.value)}
                  maxLength={64}
                />
              </div>
            </div>

            <fieldset className="form-fieldset" disabled={recordLocked}>

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
                rows={4}
                maxLength={2000}
              />
              <FieldError message={touched.has("currentIllness") ? displayErrors.currentIllness : undefined} />
            </div>

            {/* Row 5: Past history + Physical exam (2 cols) */}
            <div className="form-row form-row--2col">
              <div className="form-group">
                <label className="form-label">既往史 Past Medical History</label>
                <textarea
                  className="form-textarea"
                  placeholder="例：高血压病史5年，规律服药"
                  value={form.pastHistory}
                  onChange={(e) => setField("pastHistory", e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </div>
              <div className="form-group">
                <label className="form-label form-label--required">体格检查 Medical Examination</label>
                <textarea
                  className={`form-textarea ${touched.has("physicalExam") ? (displayErrors.physicalExam ? "form-input--error" : "form-input--valid") : ""}`}
                  placeholder="舌脉、查体重点"
                  value={form.physicalExam}
                  onChange={(e) => setField("physicalExam", e.target.value)}
                  onBlur={() => markTouched("physicalExam")}
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
                    : form.prescriptionType === "综合调理"
                    ? "例：穴位 + 方药 + 生活调摄建议"
                    : "例：天麻钩藤饮加减，天麻10g 钩藤15g…"
                }
                value={form.prescription}
                onChange={(e) => setField("prescription", e.target.value)}
                onBlur={() => markTouched("prescription")}
                rows={5}
                maxLength={2000}
              />
              <FieldError message={touched.has("prescription") ? displayErrors.prescription : undefined} />
            </div>

            </fieldset>

            {/* Submit */}
            <div className="form-submit">
              <button
                className="btn btn--primary btn--lg"
                onClick={() => void handleAnalyze()}
                disabled={recordLocked || analyzing || Object.keys(liveErrors).length > 0}
              >
                {analyzing ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    分析中…
                  </>
                ) : recordLocked ? "已归档" : "开始分析"}
              </button>
            </div>

            {/* Status bar */}
            <StatusBar
              saveStatus={saveStatus}
              savedAt={savedAt}
              analyzing={analyzing}
              form={form}
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

              {/* 重点结论 — full width conclusion card */}
              {result.keyPoints.length > 0 && (
                <ResultColumn title="重点结论 Conclusion" colorVariant="green" icon={<CheckCircle2 size={15} />}>
                  <div className="result-keypoints">
                    {result.keyPoints.map((kp, i) => (
                      <p key={i}>{kp}</p>
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
            {result.evidence.length > 0 && (
              <div className="evidence-footer">
                {result.evidence.map((e, i) => (
                  <span key={i}>{e}</span>
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
          />
        )}
        </div>
        {linkedCaseRail && activeId ? (
          <CaseLinkTimeline
            currentRecord={
              consultations.find((item) => item.id === activeId) ?? {
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
              }
            }
            linkedRecords={linkedCaseRail.linkedRecords}
            onSelect={(id) => void handleSelectHistory(id)}
          />
        ) : null}
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
    </div>
  );
}
