"use client";

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  FlaskConical,
  LoaderCircle,
  LogOut,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StructuredCaseForm, structuredCaseSchema, PRESCRIPTION_TYPES, SEX_VALUES } from "@/lib/forms/caseSchema";
import { AnalysisResult, ensureAnalysisResult, normalizePrescriptionType } from "@/lib/ai/analysisResult";
import { BRANDING } from "@/lib/branding";
import "./workbench.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiMeta = {
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  costUsd?: number;
  model?: string;
  promptVersion?: string;
  durationSeconds?: number;
};

type ConsultationSummary = {
  id: string;
  consultation_name: string | null;
  form_data: StructuredCaseForm | null;
  analysis_status: "draft" | "analyzed";
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
};

type ConsultationRecord = ConsultationSummary & {
  analysis_result: unknown | null;
  analysis_raw: unknown | null;
  model_meta: ApiMeta | null;
};

type ToastState = { message: string; tone: "success" | "error" | "info" };

type AssessmentSample = {
  id: string;
  label: string;
  form_data: StructuredCaseForm;
  notes: string | null;
  sort_order: number;
};

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
  prescriptionType: ["方药"],
  patientAge: "",
  patientSex: "女",
  chiefComplaint: "",
  currentIllness: "",
  pastHistory: "",
  physicalExam: "",
  diagnosis: "",
  pattern: "",
  prescription: "",
  doctorQuestion: "",
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
  costUsd: number;
  promptVersion: string;
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
    costUsd: number;
    promptVersion: string;
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

const ResultColumn = memo(function ResultColumn({ title, icon, colorVariant, children }: { title: string; icon: ReactNode; colorVariant?: "green" | "slate" | "teal"; children: ReactNode }) {
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

// ---------------------------------------------------------------------------
// Samples panel (admin only)
// ---------------------------------------------------------------------------

const SamplesPanel = memo(function SamplesPanel({
  samples,
  loading,
  onLoad,
}: {
  samples: AssessmentSample[];
  loading: boolean;
  onLoad: (sample: AssessmentSample) => void;
}) {
  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <span className="history-panel__title">
          <FlaskConical size={14} />
          评估样本
        </span>
      </div>
      <div className="history-panel__list">
        {loading && <div className="history-panel__empty">加载中…</div>}
        {!loading && samples.length === 0 && (
          <div className="history-panel__empty">暂无样本（请先运行 SQL 迁移）</div>
        )}
        {samples.map((s) => (
          <div
            key={s.id}
            className="history-item"
            onClick={() => onLoad(s)}
            title={s.notes ?? undefined}
          >
            <div className="history-item__name">{s.label}</div>
            <div className="history-item__meta">
              <span>{s.form_data.diagnosis} · {s.form_data.pattern}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

const HistoryPanel = memo(function HistoryPanel({
  consultations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  consultations: ConsultationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <span className="history-panel__title">
          <Clock size={14} />
          历史记录
        </span>
        <button className="history-panel__new" onClick={onNew} title="新建病案">
          <Plus size={14} />
        </button>
      </div>
      <div className="history-panel__list">
        {loading && <div className="history-panel__empty">加载中…</div>}
        {!loading && consultations.length === 0 && (
          <div className="history-panel__empty">暂无历史记录</div>
        )}
        {consultations.map((c) => (
          <div
            key={c.id}
            className={`history-item ${c.id === activeId ? "history-item--active" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="history-item__name">
              {buildDisplayName(c)}
            </div>
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
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Workbench
// ---------------------------------------------------------------------------

export default function Workbench({ isAdmin = false }: { isAdmin?: boolean }) {
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

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [samples, setSamples] = useState<AssessmentSample[]>([]);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [samplesLoading, setSamplesLoading] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "info") => {
    setToast({ message, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  // Load consultation list on mount
  useEffect(() => {
    apiListConsultations()
      .then((records) => setConsultations(records))
      .catch(() => showToast("读取历史记录失败。", "error"))
      .finally(() => setHistoryLoading(false));
  }, [showToast]);

  const setField = useCallback(<K extends keyof StructuredCaseForm>(key: K, value: StructuredCaseForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveStatus((prev) => prev === "saving" ? prev : "unsaved");
  }, []);

  const markTouched = useCallback((key: keyof StructuredCaseForm) => {
    setTouched((prev) => new Set([...prev, key]));
  }, []);

  function handleNew() {
    setForm(EMPTY_FORM);
    setTouched(new Set());
    setResult(null);
    setMeta(null);
    setRawResult(null);
    setActiveId(null);
    setHistoryOpen(false);
    setSaveStatus("new");
    setSavedAt(null);
  }

  async function handleToggleSamples() {
    if (!samplesOpen && samples.length === 0) {
      setSamplesLoading(true);
      try {
        const res = await fetch("/api/admin/samples", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { samples: AssessmentSample[] };
        setSamples(data.samples);
      } catch {
        showToast("读取样本失败。", "error");
      } finally {
        setSamplesLoading(false);
      }
    }
    setSamplesOpen((o) => !o);
    setHistoryOpen(false);
  }

  function handleLoadSample(sample: AssessmentSample) {
    const parsed = structuredCaseSchema.safeParse(sample.form_data);
    if (!parsed.success) {
      showToast("样本数据格式有误。", "error");
      return;
    }
    setForm(parsed.data);
    setTouched(new Set(REQUIRED_FIELDS));
    setResult(null);
    setMeta(null);
    setRawResult(null);
    setActiveId(null);
    setSaveStatus("new");
    setSavedAt(null);
    setSamplesOpen(false);
    showToast(`已加载：${sample.label}`, "success");
  }

  async function handleSelectHistory(id: string) {
    try {
      const record = await apiGetConsultation(id);
      if (record.form_data) {
        const parsed = structuredCaseSchema.safeParse(record.form_data);
        if (parsed.success) {
          setForm(parsed.data);
          setTouched(new Set(REQUIRED_FIELDS));
        }
      }
      const analysis = ensureAnalysisResult(
        record.analysis_result,
        normalizePrescriptionType((record.form_data as StructuredCaseForm | null)?.prescriptionType),
      );
      setResult(analysis);
      setMeta(record.model_meta ?? null);
      setRawResult(record.analysis_raw ?? null);
      setActiveId(id);
      setHistoryOpen(false);
      setSaveStatus("saved");
      setSavedAt(new Date(record.updated_at));
      showToast("已加载病案。", "success");
    } catch {
      showToast("读取病案记录失败。", "error");
    }
  }

  async function handleDeleteHistory(id: string) {
    try {
      await apiDeleteConsultation(id);
      setConsultations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) handleNew();
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
      setMeta({ model: data.model, costUsd: data.costUsd, promptVersion: data.promptVersion, durationSeconds });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

      // Auto-save or update
      try {
        const newMeta: ApiMeta = {
          model: data.model,
          costUsd: data.costUsd,
          promptVersion: data.promptVersion,
          durationSeconds,
        };
        setSaveStatus("saving");
        if (activeId) {
          const updated = await apiUpdateConsultation(activeId, {
            formData: form,
            analysisResult: data.result,
            analysisRaw: data.raw,
            modelMeta: newMeta,
            analysisStatus: "analyzed",
          });
          setConsultations((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)));
        } else {
          const saved = await apiSaveNew({
            consultationName: form.consultationName || "",
            formData: form,
            analysisResult: data.result,
            analysisRaw: data.raw,
            modelMeta: newMeta,
          });
          setActiveId(saved.id);
          setConsultations((prev) => [saved, ...prev]);
        }
        setSaveStatus("saved");
        setSavedAt(new Date());
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
      if (activeId) {
        const updated = await apiUpdateConsultation(activeId, {
          consultationName: form.consultationName,
          formData: form,
          analysisResult: result,
          analysisRaw: rawResult,
          modelMeta: saveMeta,
          analysisStatus: "analyzed",
        });
        setConsultations((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)));
      } else {
        const saved = await apiSaveNew({
          consultationName: form.consultationName || "",
          formData: form,
          analysisResult: result,
          analysisRaw: rawResult,
          modelMeta: saveMeta,
        });
        setActiveId(saved.id);
        setConsultations((prev) => [saved, ...prev]);
      }
      const now = new Date();
      setSaveStatus("saved");
      setSavedAt(now);
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
            {isAdmin && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void handleToggleSamples()}
                title="评估样本"
              >
                <FlaskConical size={15} />
                <span>样本</span>
                <ChevronDown size={13} className={samplesOpen ? "rotate-180" : ""} />
              </button>
            )}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => { setHistoryOpen((o) => !o); setSamplesOpen(false); }}
              title="历史记录"
            >
              <Clock size={15} />
              <span>历史</span>
              <ChevronDown size={13} className={historyOpen ? "rotate-180" : ""} />
            </button>
            <button className="btn btn--ghost btn--sm" onClick={handleNew} title="新建">
              <Plus size={15} />
              <span>新建</span>
            </button>
            {result && (
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
            <a className="btn btn--ghost btn--sm" href="/auth/signout" title="退出">
              <LogOut size={15} />
              <span className="sr-only">退出</span>
            </a>
          </div>
        </div>
      </header>

      {/* Samples panel dropdown (admin only) */}
      {samplesOpen && isAdmin && (
        <div className="history-dropdown">
          <SamplesPanel
            samples={samples}
            loading={samplesLoading}
            onLoad={handleLoadSample}
          />
        </div>
      )}

      {/* History panel dropdown */}
      {historyOpen && (
        <div className="history-dropdown">
          <HistoryPanel
            consultations={consultations}
            activeId={activeId}
            onSelect={(id) => void handleSelectHistory(id)}
            onNew={handleNew}
            onDelete={(id) => void handleDeleteHistory(id)}
            loading={historyLoading}
          />
        </div>
      )}

      {/* Form */}
      <main className="workbench__main">
        <section className="form-section">
          <div className="form-card">
            {/* Row 1: Meta strip — sex / age / prescription type */}
            <div className="form-row--meta">
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
                  {PRESCRIPTION_TYPES.map((pt) => {
                    const selected = form.prescriptionType.includes(pt);
                    return (
                      <button
                        key={pt}
                        className={`segmented-btn ${selected ? "segmented-btn--active" : ""}`}
                        onClick={() => {
                          const current = form.prescriptionType;
                          const next = selected
                            ? current.filter((t) => t !== pt)
                            : [...current, pt];
                          setField("prescriptionType", next.length ? next : [pt]);
                        }}
                        type="button"
                      >
                        {pt}
                      </button>
                    );
                  })}
                </div>
                <FieldError message={touched.has("prescriptionType") ? displayErrors.prescriptionType as string | undefined : undefined} />
              </div>
            </div>

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
                  form.prescriptionType.includes("针灸") && !form.prescriptionType.includes("方药")
                    ? "例：百会、太冲、风池，平补平泻，留针20分钟"
                    : form.prescriptionType.includes("综合调理") && !form.prescriptionType.includes("方药")
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

            {/* Submit */}
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
                ) : "开始分析"}
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
            <div className="result-grid">
              <ShimmerCard />
              <ShimmerCard />
              <ShimmerCard />
            </div>
          </section>
        )}

        {/* Result */}
        {!analyzing && result && (
          <section className="result-section-wrap" ref={resultRef}>
            {/* Key points + cautions — side-by-side */}
            <div className="top-banners">
              {result.keyPoints.length > 0 && (
                <div className="keypoints-banner">
                  <div className="keypoints-banner__label">
                    <FileText size={14} />
                    重点结论
                  </div>
                  <ul className="keypoints-banner__list">
                    {result.keyPoints.map((kp, i) => (
                      <li key={i}>{kp}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.cautions.length > 0 && !result.cautions.every((c) => c.includes("请结合面诊")) && (
                <div className="cautions-banner">
                  <div className="cautions-banner__label">
                    <AlertTriangle size={14} />
                    风险与提醒
                  </div>
                  <ul className="cautions-banner__list">
                    {result.cautions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 3-column grid */}
            <div className="result-grid">
              {result.groups.map((group) => (
                <ResultColumn
                  key={group.title}
                  title={group.title}
                  colorVariant={
                    group.title === "判断" ? "green" :
                    group.title === "方案" ? "slate" : "teal"
                  }
                  icon={
                    group.title === "判断" ? (
                      <Brain size={15} />
                    ) : group.title === "方案" ? (
                      <FileText size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )
                  }
                >
                  {group.sections.map((section) => (
                    <ResultSection key={section.title} title={section.title} items={section.items} />
                  ))}
                </ResultColumn>
              ))}
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
