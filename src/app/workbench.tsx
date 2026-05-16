"use client";

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  LoaderCircle,
  LogOut,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { StructuredCaseForm, structuredCaseSchema, PRESCRIPTION_TYPES, SEX_VALUES } from "@/lib/forms/caseSchema";
import { AnalysisResult, ensureAnalysisResult } from "@/lib/ai/analysisResult";
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

type FormErrors = Partial<Record<keyof StructuredCaseForm, string>>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

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
  doctorQuestion: "",
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

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
  if (!response.ok) throw new Error(await readApiError(response));
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

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
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
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="field-error">{message}</span>;
}

function ResultSection({ title, items }: { title: string; items: string[] }) {
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
}

function ResultColumn({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="result-column">
      <div className="result-column__header">
        <span className="result-column__icon">{icon}</span>
        <h3 className="result-column__title">{title}</h3>
      </div>
      <div className="result-column__body">{children}</div>
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

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

function HistoryPanel({
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
              {c.consultation_name || c.form_data?.chiefComplaint || "未命名病案"}
            </div>
            <div className="history-item__meta">
              <span>{c.analysis_status === "analyzed" ? "已分析" : "草稿"}</span>
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
}

// ---------------------------------------------------------------------------
// Main Workbench
// ---------------------------------------------------------------------------

export default function Workbench() {
  const [form, setForm] = useState<StructuredCaseForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [rawResult, setRawResult] = useState<unknown>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  function showToast(message: string, tone: ToastState["tone"] = "info") {
    setToast({ message, tone });
  }

  // Load consultation list on mount
  useEffect(() => {
    apiListConsultations()
      .then((records) => setConsultations(records))
      .catch(() => showToast("读取历史记录失败。", "error"))
      .finally(() => setHistoryLoading(false));
  }, []);

  function setField<K extends keyof StructuredCaseForm>(key: K, value: StructuredCaseForm[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Clear error for this field on change
      if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
      return next;
    });
  }

  function handleNew() {
    setForm(EMPTY_FORM);
    setErrors({});
    setResult(null);
    setMeta(null);
    setRawResult(null);
    setActiveId(null);
    setHistoryOpen(false);
  }

  async function handleSelectHistory(id: string) {
    try {
      const record = await apiGetConsultation(id);
      if (record.form_data) {
        const parsed = structuredCaseSchema.safeParse(record.form_data);
        if (parsed.success) {
          setForm(parsed.data);
          setErrors({});
        }
      }
      const analysis = ensureAnalysisResult(
        record.analysis_result,
        (record.form_data as StructuredCaseForm | null)?.prescriptionType ?? "方药",
      );
      setResult(analysis);
      setMeta(record.model_meta ?? null);
      setRawResult(record.analysis_raw ?? null);
      setActiveId(id);
      setHistoryOpen(false);
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
    const validationErrors = getFormErrors(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      showToast("请先补全必填字段。", "error");
      return;
    }

    setErrors({});
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
      } catch {
        // Auto-save failure is non-blocking; doctor can retry via save button
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
      showToast("已保存。", "success");
    } catch {
      showToast("保存失败，请稍后重试。", "error");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="workbench">
      {/* Header */}
      <header className="workbench__header">
        <div className="workbench__header-inner">
          <div className="workbench__brand">
            <div className="workbench__brand-mark" aria-hidden>
              <Brain size={18} strokeWidth={2.25} />
            </div>
            <div className="workbench__brand-text">
              <span className="workbench__brand-title">中医临床复核</span>
              <span className="workbench__brand-sub">Clinical Review</span>
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
            <a className="btn btn--ghost btn--sm" href="/auth/signout" title="退出">
              <LogOut size={15} />
              <span className="sr-only">退出</span>
            </a>
          </div>
        </div>
      </header>

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
                <label className="form-label">性别</label>
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
                <label className="form-label form-label--required">年龄</label>
                <input
                  className={`form-input form-input--sm ${errors.patientAge ? "form-input--error" : ""}`}
                  type="text"
                  inputMode="numeric"
                  placeholder="岁"
                  value={form.patientAge}
                  onChange={(e) => setField("patientAge", e.target.value)}
                  maxLength={3}
                />
                <FieldError message={errors.patientAge} />
              </div>
              <div className="form-group">
                <label className="form-label">处方类型</label>
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
              </div>
            </div>

            {/* Row 2: Chief complaint */}
            <div className="form-group">
              <label className="form-label form-label--required">主诉</label>
              <input
                className={`form-input ${errors.chiefComplaint ? "form-input--error" : ""}`}
                type="text"
                placeholder="例：头痛眩晕反复发作"
                value={form.chiefComplaint}
                onChange={(e) => setField("chiefComplaint", e.target.value)}
                maxLength={200}
              />
              <FieldError message={errors.chiefComplaint} />
            </div>

            {/* Row 4: Current illness */}
            <div className="form-group">
              <label className="form-label form-label--required">现病史</label>
              <textarea
                className={`form-textarea ${errors.currentIllness ? "form-input--error" : ""}`}
                placeholder="例：头痛3个月余，伴轻度眩晕，劳累后加重"
                value={form.currentIllness}
                onChange={(e) => setField("currentIllness", e.target.value)}
                rows={4}
                maxLength={2000}
              />
              <FieldError message={errors.currentIllness} />
            </div>

            {/* Row 5: Past history + Physical exam (2 cols) */}
            <div className="form-row form-row--2col">
              <div className="form-group">
                <label className="form-label">既往史</label>
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
                <label className="form-label">体格检查 / 舌脉</label>
                <textarea
                  className="form-textarea"
                  placeholder="舌脉、查体重点"
                  value={form.physicalExam}
                  onChange={(e) => setField("physicalExam", e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>

            {/* Row 6: Diagnosis + Pattern (2 cols) */}
            <div className="form-row form-row--2col">
              <div className="form-group">
                <label className="form-label form-label--required">诊断</label>
                <input
                  className={`form-input ${errors.diagnosis ? "form-input--error" : ""}`}
                  type="text"
                  placeholder="例：头痛 / 眩晕"
                  value={form.diagnosis}
                  onChange={(e) => setField("diagnosis", e.target.value)}
                  maxLength={100}
                />
                <FieldError message={errors.diagnosis} />
              </div>
              <div className="form-group">
                <label className="form-label">证型</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="例：肝阳上亢"
                  value={form.pattern}
                  onChange={(e) => setField("pattern", e.target.value)}
                  maxLength={100}
                />
              </div>
            </div>

            {/* Row 7: Prescription */}
            <div className="form-group">
              <label className="form-label form-label--required">处方</label>
              <textarea
                className={`form-textarea form-textarea--tall ${errors.prescription ? "form-input--error" : ""}`}
                placeholder={
                  form.prescriptionType === "针灸"
                    ? "例：百会、太冲、风池，平补平泻，留针20分钟"
                    : form.prescriptionType === "综合调理"
                    ? "例：穴位 + 方药 + 生活调摄建议"
                    : "例：天麻钩藤饮加减，天麻10g 钩藤15g…"
                }
                value={form.prescription}
                onChange={(e) => setField("prescription", e.target.value)}
                rows={5}
                maxLength={2000}
              />
              <FieldError message={errors.prescription} />
            </div>

            {/* Row 8: Doctor question */}
            <div className="form-group">
              <label className="form-label">医生问题</label>
              <input
                className="form-input"
                type="text"
                placeholder="本次最想确认的方向"
                value={form.doctorQuestion}
                onChange={(e) => setField("doctorQuestion", e.target.value)}
                maxLength={500}
              />
            </div>

            {/* Submit */}
            <div className="form-submit">
              <button
                className="btn btn--primary btn--lg"
                onClick={() => void handleAnalyze()}
                disabled={analyzing}
              >
                {analyzing ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    分析中…
                  </>
                ) : (
                  <>
                    <Brain size={18} />
                    开始复核
                  </>
                )}
              </button>
            </div>
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
            {/* Key points banner */}
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

            {/* Cautions banner */}
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

            {/* 3-column grid */}
            <div className="result-grid">
              {result.groups.map((group) => (
                <ResultColumn
                  key={group.title}
                  title={group.title}
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

            {/* Result metadata */}
            {meta && (
              <div className="result-meta">
                {meta.durationSeconds != null && (
                  <span>耗时 {meta.durationSeconds.toFixed(1)} 秒</span>
                )}
                {meta.model && <span>{meta.model.replace("deepseek-", "")}</span>}
                {meta.promptVersion && <span>{meta.promptVersion}</span>}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Toast */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
