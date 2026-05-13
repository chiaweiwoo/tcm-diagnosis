"use client";

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  FileText,
  GitBranch,
  Info,
  LoaderCircle,
  ListChecks,
  LogOut,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useState } from "react";
import { CaseForm, getStageOneRequirements, validateCaseForm } from "@/lib/caseValidation";
import "./workbench.css";

type AnalysisResult = {
  title: string;
  keyPoints: string[];
  summary: string;
  groups: Array<{
    title: string;
    sections: Array<{ title: string; items: string[] }>;
  }>;
  cautions: string[];
  evidence: string[];
};

type ApiMeta = {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  costUsd?: number;
  model?: string;
  promptVersion?: string;
  durationSeconds?: number;
  organizeModel?: string;
  organizePromptVersion?: string;
};

type ConsultationSummary = {
  id: string;
  consultation_name: string | null;
  draft: string;
  analysis_status: "draft" | "ready" | "stale";
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
};

type ConsultationRecord = ConsultationSummary & {
  organized_case: unknown | null;
  analysis_result: AnalysisResult | null;
  analysis_raw: unknown | null;
  validation_result: ReturnType<typeof validateCaseForm> | null;
  model_meta: ApiMeta | null;
};

type ToastState = {
  message: string;
  tone: "success" | "error" | "info";
};

type ReviewMode = "smart" | "normal";

const initialForm: CaseForm = {
  caseType: "方药分析",
  age: "",
  sex: "",
  constitution: "",
  chiefComplaint: "",
  duration: "",
  history: "",
  currentPlan: "",
  herbs: "",
  acupoints: "",
  doctorQuestion: "",
  modelMode: "深度模式",
};

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || "请求失败，请稍后重试。";
  } catch {
    return "请求失败，请稍后重试。";
  }
}

function formatRecordLabel(record: ConsultationSummary) {
  const timestamp = new Intl.DateTimeFormat("zh-SG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(record.updated_at));

  return record.consultation_name ? `${timestamp} · ${record.consultation_name}` : timestamp;
}

function normalizeName(value: string) {
  return value.trim() || null;
}

export default function Workbench({
  userEmail,
  buildLabel,
  isDevBypass,
}: {
  userEmail: string;
  buildLabel: string;
  isDevBypass: boolean;
}) {
  const [consultationName, setConsultationName] = useState("");
  const [activeConsultationId, setActiveConsultationId] = useState("");
  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [form, setForm] = useState<CaseForm>(initialForm);
  const [stageOneHints, setStageOneHints] = useState<string[]>([]);
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [organizeNotes, setOrganizeNotes] = useState<string[]>([]);
  const [organizeSuggestions, setOrganizeSuggestions] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [apiError, setApiError] = useState("");
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [organizeReady, setOrganizeReady] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("smart");

  const isBusy = isOrganizing || isAnalyzing || isSaving;
  const isLocked = isBusy || (Boolean(result) && !isEditing);
  const hasSavedRecord = Boolean(activeConsultationId);
  const qualityWarnings = [...missingContext, ...organizeNotes, ...organizeSuggestions].filter(Boolean);
  const analysisReady = Boolean(result);
  const blockMessages = [...stageOneHints, ...blockedReasons].filter(Boolean);
  const stageOneRequirements = getStageOneRequirements(form.caseType);

  useEffect(() => {
    void loadConsultations();
  }, []);

  useEffect(() => {
    const savedMode = window.localStorage.getItem("tcm-review-mode");
    if (savedMode === "smart" || savedMode === "normal") {
      setReviewMode(savedMode);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isBusy || !runStartedAt) return;

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isBusy, runStartedAt]);

  async function loadConsultations() {
    setIsLoadingHistory(true);
    try {
      const response = await fetch("/api/consultations", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const body = (await response.json()) as { records: ConsultationSummary[] };
      setConsultations(body.records);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "读取病案历史失败。");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  function showToast(message: string, tone: ToastState["tone"] = "info") {
    setToast({ message, tone });
  }

  function handleReviewModeChange(nextMode: ReviewMode) {
    setReviewMode(nextMode);
    window.localStorage.setItem("tcm-review-mode", nextMode);
    setForm((current) => ({
      ...current,
      modelMode: nextMode === "smart" ? "深度模式" : "快速模式",
    }));
    showToast(nextMode === "smart" ? "已切换为智能模式。" : "已切换为常规模式。", "info");
  }

  function resetSession() {
    setConsultationName("");
    setActiveConsultationId("");
    setDraft("");
    setForm(initialForm);
    setStageOneHints([]);
    setBlockedReasons([]);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
    setResult(null);
    setMeta(null);
    setApiError("");
    setElapsedSeconds(0);
    setRunStartedAt(null);
    setIsOrganizing(false);
    setIsAnalyzing(false);
    setIsSaving(false);
    setIsEditing(false);
    setOrganizeReady(false);
    showToast("已建立新的病案记录。", "info");
  }

  function clearAnalysisForEdit(nextDraft?: string) {
    if (!result) return;
    setResult(null);
    setMeta(null);
    setStageOneHints([]);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
    setBlockedReasons([]);
    setOrganizeReady(false);
    if (activeConsultationId && nextDraft !== undefined) {
      void saveDraftOnly(nextDraft, consultationName, activeConsultationId);
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    clearAnalysisForEdit(value);
  }

  function handleNameChange(value: string) {
    setConsultationName(value);
  }

  async function saveDraftOnly(nextDraft = draft, nextName = consultationName, recordId = activeConsultationId) {
    const text = nextDraft.trim();
    if (!text) return "";

    setIsSaving(true);
    setApiError("");

    try {
      const response = await fetch(recordId ? `/api/consultations/${recordId}` : "/api/consultations", {
        method: recordId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultationName: normalizeName(nextName),
          draft: text,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as { record: ConsultationRecord };
      setActiveConsultationId(body.record.id);
      await loadConsultations();
      showToast("病案记录已保存。", "success");
      return body.record.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存病案记录失败。";
      setApiError(message);
      showToast(message, "error");
      return "";
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAnalysisResult(input: {
    recordId: string;
    organized: unknown;
    analyzed: {
      result: AnalysisResult;
      raw?: unknown;
      usage?: ApiMeta["usage"];
      costUsd?: number;
      model?: string;
      promptVersion?: string;
      validation?: ReturnType<typeof validateCaseForm>;
      durationSeconds: number;
      organizeModel?: string;
      organizePromptVersion?: string;
    };
  }) {
    const modelMeta = {
      usage: input.analyzed.usage,
      costUsd: input.analyzed.costUsd,
      model: input.analyzed.model,
      promptVersion: input.analyzed.promptVersion,
      durationSeconds: input.analyzed.durationSeconds,
      organizeModel: input.analyzed.organizeModel,
      organizePromptVersion: input.analyzed.organizePromptVersion,
    };

    const response = await fetch(`/api/consultations/${input.recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consultationName: normalizeName(consultationName),
        draft: draft.trim(),
        organizedCase: input.organized,
        analysisResult: input.analyzed.result,
        analysisRaw: {
          analyze_input: {
            form,
            doctorDraft: draft.trim(),
          },
          analyze_output: input.analyzed.raw ?? null,
        },
        validationResult: input.analyzed.validation ?? null,
        modelMeta,
        analysisStatus: "ready",
      }),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    await loadConsultations();
    showToast("临床研判已保存到历史记录。", "success");
  }


  async function saveOrganizeSnapshot(input: {
    recordId: string;
    draftText: string;
    organized: {
      form: CaseForm;
      notes?: string[];
      suggestions?: string[];
      usage?: ApiMeta["usage"];
      costUsd?: number;
      model?: string;
      promptVersion?: string;
    };
    validation: ReturnType<typeof validateCaseForm>;
  }) {
    const modelMeta = {
      organizeModel: input.organized.model,
      organizePromptVersion: input.organized.promptVersion,
      usage: input.organized.usage,
      costUsd: input.organized.costUsd,
    };

    const response = await fetch(`/api/consultations/${input.recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consultationName: normalizeName(consultationName),
        draft: input.draftText,
        organizedCase: {
          organize_input: { draft: input.draftText },
          organize_output: input.organized,
        },
        validationResult: input.validation,
        modelMeta,
        analysisStatus: "draft",
      }),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
  }
  async function loadConsultation(id: string) {
    if (!id) {
      resetSession();
      return;
    }

    setApiError("");
    setIsLoadingHistory(true);

    try {
      const response = await fetch(`/api/consultations/${id}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as { record: ConsultationRecord };
        const record = body.record;
        setActiveConsultationId(record.id);
        setConsultationName(record.consultation_name ?? "");
        setDraft(record.draft ?? "");
        setResult(record.analysis_result ?? null);
        setMeta(record.model_meta ?? null);
        setStageOneHints(record.validation_result?.stageOneHints ?? []);
        setMissingContext(record.validation_result?.missingContext ?? []);
        setBlockedReasons(record.validation_result?.blockedReasons ?? []);
      setOrganizeNotes(
        (record.organized_case as { organize_output?: { notes?: string[] } } | null)?.organize_output?.notes ?? [],
      );
      setOrganizeSuggestions(
        (record.organized_case as { organize_output?: { suggestions?: string[] } } | null)?.organize_output?.suggestions ?? [],
      );
      setApiError("");
      setElapsedSeconds(record.model_meta?.durationSeconds ?? 0);
      setRunStartedAt(null);
      setIsEditing(false);
      setOrganizeReady(Boolean(record.organized_case));
      showToast("已载入历史病案。", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取病案记录失败。";
      setApiError(message);
      showToast(message, "error");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function deleteActiveConsultation() {
    if (!activeConsultationId) return;
    const confirmed = window.confirm("确定删除这份病案记录？此操作无法复原。");
    if (!confirmed) return;

    setIsSaving(true);
    setApiError("");

    try {
      const response = await fetch(`/api/consultations/${activeConsultationId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      resetSession();
      await loadConsultations();
      showToast("病案记录已删除。", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除病案记录失败。";
      setApiError(message);
      showToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function analyzeDraft() {
    const text = draft.trim();
    if (!text) return;
    const startedAt = Date.now();

    setApiError("");
    setStageOneHints([]);
    setBlockedReasons([]);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
    setResult(null);
    setMeta(null);
    setElapsedSeconds(0);
    setRunStartedAt(startedAt);
    setOrganizeReady(false);
    setIsOrganizing(true);
    setIsAnalyzing(false);

    try {
      const organizeResponse = await fetch("/api/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: text }),
      });

      if (!organizeResponse.ok) {
        throw new Error(await readApiError(organizeResponse));
      }

      const organized = (await organizeResponse.json()) as {
        form: CaseForm;
        notes?: string[];
        suggestions?: string[];
        usage?: ApiMeta["usage"];
        costUsd?: number;
        model?: string;
        promptVersion?: string;
      };

      const nextForm = organized.form;
      const validation = validateCaseForm(nextForm);

      setForm(nextForm);
      setStageOneHints(validation.stageOneHints ?? []);
      setOrganizeNotes(organized.notes ?? []);
      setOrganizeSuggestions(organized.suggestions ?? []);
      setBlockedReasons(validation.blockedReasons);
      setMissingContext(validation.missingContext ?? []);
      setOrganizeReady(true);

      const recordId = activeConsultationId || (await saveDraftOnly(text, consultationName));
      if (recordId) {
        await saveOrganizeSnapshot({
          recordId,
          draftText: text,
          organized,
          validation,
        });
      }

      setIsOrganizing(false);
      const shouldBlock = !validation.canProceed;

      if (shouldBlock) {
        setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
        setIsEditing(false);
        showToast("资料已整理，建议先补充基础信息，再继续临床复核。", "info");
        return;
      }

      setIsAnalyzing(true);

        const analyzeResponse = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ form: nextForm, mode: reviewMode }),
        });

      if (!analyzeResponse.ok) {
        throw new Error(await readApiError(analyzeResponse));
      }

      const analyzed = (await analyzeResponse.json()) as {
        result: AnalysisResult;
        raw?: unknown;
        usage?: ApiMeta["usage"];
        costUsd?: number;
        model?: string;
        promptVersion?: string;
        validation?: ReturnType<typeof validateCaseForm>;
      };

      if (recordId) {
        await saveAnalysisResult({
          recordId,
          organized,
          analyzed: {
            ...analyzed,
            durationSeconds: Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
            organizeModel: organized.model,
            organizePromptVersion: organized.promptVersion,
          },
        });
      }

      setResult(analyzed.result);
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
      setMeta({
        usage: analyzed.usage,
        costUsd: analyzed.costUsd,
        model: analyzed.model,
        promptVersion: analyzed.promptVersion,
        durationSeconds: Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
        organizeModel: organized.model,
        organizePromptVersion: organized.promptVersion,
      });
      setMissingContext(analyzed.validation?.missingContext ?? validation.missingContext);
      setStageOneHints(analyzed.validation?.stageOneHints ?? validation.stageOneHints);
      setIsEditing(false);
      showToast("临床研判已完成。", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成分析失败，请稍后重试。";
      setApiError(message);
      showToast(message, "error");
    } finally {
      setIsOrganizing(false);
      setIsAnalyzing(false);
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && draft.trim() && !isLocked) {
      event.preventDefault();
      void analyzeDraft();
    }
  }

  return (
      <main className="app-shell">
      {toast ? (
        <div className="toast-region" aria-live="polite" aria-atomic="true">
          <ToastBanner message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        </div>
      ) : null}

      <section className="hero-panel">
        <div className="hero-head">
          <div className="hero-main">
            <p className="eyebrow">临床复核伙伴</p>
            <h1>临床复核工作台</h1>
            <p className="hero-copy">
              把自由病案整理成清晰脉络，先提示值得补充的关键信息，再陪你复核思路与后续重点。
            </p>
            <p className="hero-note">
              <AlertTriangle size={15} />
              仅供注册中医师临床参考；最终判断仍以医生面诊与专业评估为准。
            </p>
          </div>
          <a className="secondary-button hero-action" href="/auth/signout">
            <LogOut size={15} />
            {userEmail}
          </a>
        </div>
        <div className="hero-meta-row">
          {isDevBypass ? <span className="dev-bypass-badge">本地开发模式</span> : null}
          <span>构建：{buildLabel}</span>
          <span>作者：Woo Chia Wei</span>
          <a href="https://github.com/chiaweiwoo/tcm-diagnosis" target="_blank" rel="noreferrer">
            <GitBranch size={14} />
            GitHub 仓库
          </a>
        </div>
      </section>

      <section className="panel flow-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>临床记录</h2>
          </div>
          <div className="heading-actions">
              <button type="button" className="secondary-button compact-button" onClick={() => setShowGuide(true)}>
                <CircleHelp size={15} />
                使用说明
              </button>
              <div className="mode-switch" role="group" aria-label="复核模式">
                <button
                  type="button"
                  className={`mode-option ${reviewMode === "smart" ? "active" : ""}`}
                  onClick={() => handleReviewModeChange("smart")}
                  disabled={isBusy}
                >
                  智能
                </button>
                <button
                  type="button"
                  className={`mode-option ${reviewMode === "normal" ? "active" : ""}`}
                  onClick={() => handleReviewModeChange("normal")}
                  disabled={isBusy}
                >
                  常规
                </button>
              </div>
              <button
                type="button"
                className="secondary-button compact-button"
              onClick={() => void saveDraftOnly()}
              disabled={!draft.trim() || isBusy}
            >
              <Save size={15} />
              保存
            </button>
            {result && !isEditing ? (
              <button type="button" className="secondary-button compact-button" onClick={() => setIsEditing(true)}>
                <Pencil size={15} />
                编辑病案
              </button>
            ) : null}
            <button type="button" className="secondary-button compact-button" onClick={resetSession}>
              <RotateCcw size={15} />
              新建病案
            </button>
          </div>
        </div>

        {apiError ? (
          <div className="blocked-box">
            <strong>生成失败</strong>
            <span>{apiError}</span>
          </div>
        ) : null}

          {blockMessages.length ? (
            <div className="blocked-box">
              <strong>建议先补充后再复核</strong>
              {blockMessages.map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
          ) : null}

        <div className="entry-layout">
          <div className="draft-panel compact-draft">
          <div className="history-row">
            <label className="field-block name-field">
              <span>
                病案名称 <em className="field-badge">可选</em>
              </span>
                <input
                  value={consultationName}
                  onChange={(event) => handleNameChange(event.target.value)}
                  disabled={isLocked}
                  placeholder="例如：患者代号 A-01、PCOS 复诊（请勿填写真实姓名）"
                />
              </label>
            <label className="field-block history-field">
              <span>历史记录</span>
              <select
                value={activeConsultationId}
                onChange={(event) => void loadConsultation(event.target.value)}
                disabled={isBusy || isLoadingHistory}
              >
                <option value="">{isLoadingHistory ? "读取中..." : "选择历史病案"}</option>
                {consultations.map((record) => (
                  <option key={record.id} value={record.id}>
                    {formatRecordLabel(record)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button compact-button delete-button"
              onClick={deleteActiveConsultation}
              disabled={!hasSavedRecord || isBusy}
            >
              <Trash2 size={15} />
              删除
            </button>
          </div>

          {activeConsultationId && result === null && draft.trim() ? (
            <div className="reminder-box compact-reminder">
              <FileText size={16} />
              <span>病案可继续修改；修改后需重新研判，历史分析会以最新结果为准。</span>
            </div>
          ) : null}

          <label className="field-block">
            <textarea
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              onKeyDown={handleDraftKeyDown}
              disabled={isLocked}
              rows={8}
              placeholder="先按你的习惯写下病情、当前处理与想确认的问题；系统会先帮你整理重点，再给出临床复核建议。"
            />
          </label>

          <div className="action-bar">
            <button
              className="primary-button"
              type="button"
              onClick={analyzeDraft}
              disabled={!draft.trim() || isLocked}
            >
              <Sparkles size={18} />
              {isOrganizing ? "资料整理中..." : isAnalyzing ? "临床研判中..." : "生成临床复核"}
            </button>
            <p className="cost-note">
              资料将先结构化，再进入临床研判；可按 Ctrl+Enter 提交。
            </p>
          </div>
          </div>
          <MergedStatusPanel
            apiError={apiError}
            draft={draft}
            hasSavedRecord={hasSavedRecord}
            isAnalyzing={isAnalyzing}
            isOrganizing={isOrganizing}
            elapsedSeconds={elapsedSeconds}
            analysisReady={analysisReady}
            organizeReady={organizeReady}
            stageOneHints={stageOneHints}
            organizeNotes={organizeNotes}
            organizeSuggestions={organizeSuggestions}
            missingContext={missingContext}
            blockedReasons={blockedReasons}
          />
        </div>
      </section>

      {organizeReady && !analysisReady ? (
        <section className="panel result-panel-full organize-preview-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">资料整理</p>
              <h2>{blockMessages.length ? "建议先补充后再复核" : isAnalyzing ? "资料已整理，正在进入临床复核" : "资料整理结果"}</h2>
            </div>
            <span className="pill">{form.caseType}</span>
          </div>
          <OrganizeReviewPanel
            stageOneHints={stageOneHints}
            missingContext={missingContext}
            organizeNotes={organizeNotes}
            organizeSuggestions={organizeSuggestions}
            blockedReasons={blockedReasons}
          />
        </section>
      ) : null}

      {result ? (
        <section className="panel result-panel-full">
          <div className="section-heading">
            <div>
              <p className="eyebrow">临床参考</p>
              <h2>{result.title}</h2>
            </div>
            <span className="pill">{form.caseType}</span>
          </div>

          <div className="result-workspace">
            <div className="result-content">
              <section className="result-group" id="key-points">
                <SectionTitle icon={<Sparkles size={18} />}>重点结论</SectionTitle>
                <article className="result-card">
                  <ul>
                    {result.keyPoints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </section>

              <AnalysisBoard result={result} qualityWarnings={qualityWarnings} />
            </div>
          </div>
          </section>
        ) : null}
      {showGuide ? (
        <GuideModal
          buildLabel={buildLabel}
          caseType={form.caseType}
          requirements={stageOneRequirements}
          onClose={() => setShowGuide(false)}
        />
      ) : null}
    </main>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="section-title">
      <span>{icon}</span>
      {children}
    </h3>
  );
}

function ToastBanner({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone: ToastState["tone"];
  onClose: () => void;
}) {
  const icon =
    tone === "success" ? <CheckCircle2 size={16} /> : tone === "error" ? <CircleAlert size={16} /> : <Info size={16} />;

  const title = tone === "success" ? "操作已完成" : tone === "error" ? "这次没有完成" : "状态更新";

  return (
    <div className={`toast-message ${tone}`} role="status">
      <div className="toast-icon">{icon}</div>
      <div className="toast-copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <button type="button" className="toast-close" onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  );
}

function GuideModal({
  buildLabel,
  caseType,
  requirements,
  onClose,
}: {
  buildLabel: string;
  caseType: CaseForm["caseType"];
  requirements: Array<{ key: string; label: string; description: string }>;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="系统说明">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">系统说明</p>
            <h3>这套工作台如何协助临床复核</h3>
          </div>
          <button type="button" className="secondary-button compact-button" onClick={onClose}>
            <X size={15} />
            关闭
          </button>
        </div>
        <div className="modal-body">
          <section className="guide-section">
            <h4>系统如何工作</h4>
            <ol>
              <li>先按你的习惯写下病案重点、当前方案，以及这次想确认的问题。</li>
              <li>系统先整理资料脉络，提示值得补充与值得留意的地方。</li>
              <li>基础信息足够时，系统才继续进入临床复核，给出判断、优化与随访提醒。</li>
            </ol>
          </section>
          <section className="guide-section">
            <h4>系统默认假设</h4>
            <ul>
              <li>仅供注册中医师内部参考，不替代面诊、查体与专业评估。</li>
              <li>系统会优先保留当前方案里合理的部分，再提示可优化之处。</li>
              <li>若内容像患者自用、保证疗效、或问题过于笼统，系统会停在资料整理阶段。</li>
            </ul>
          </section>
          <section className="guide-section">
            <h4>本阶段建议至少写到这些</h4>
            <ul>
              {requirements.map((item) => (
                <li key={item.key}>
                  <strong>{item.label}：</strong>
                  {item.description}
                </li>
              ))}
            </ul>
            <p className="guide-footnote">当前病案类型：{caseType}</p>
          </section>
          <section className="guide-section">
            <h4>什么时候会先停下来</h4>
            <ul>
              <li>主诉、当前方案、医生问题、病程线索不足时。</li>
              <li>方药分析缺少方药内容，或针灸方案缺少穴位与操作时。</li>
              <li>出现患者自用、保证疗效、或“帮我看看”这类过于笼统的问题时。</li>
            </ul>
          </section>
        </div>
        <div className="modal-footer">
          <span>构建：{buildLabel}</span>
          <span>这份说明会随产品行为一起更新。</span>
        </div>
      </div>
    </div>
  );
}

function MergedStatusPanel({
  apiError,
  draft,
  hasSavedRecord,
  isAnalyzing,
  isOrganizing,
  elapsedSeconds,
  analysisReady,
  organizeReady,
  stageOneHints,
  organizeNotes,
  organizeSuggestions,
  missingContext,
  blockedReasons,
}: {
  apiError: string;
  draft: string;
  hasSavedRecord: boolean;
  isAnalyzing: boolean;
  isOrganizing: boolean;
  elapsedSeconds: number;
  analysisReady: boolean;
  organizeReady: boolean;
  stageOneHints: string[];
  organizeNotes: string[];
  organizeSuggestions: string[];
  missingContext: string[];
  blockedReasons: string[];
}) {
  const isRunning = isOrganizing || isAnalyzing;
  const draftChars = draft.trim().length;
  const organizeHighlights = [...stageOneHints, ...missingContext, ...organizeSuggestions].filter(Boolean);
  const hasBlocked = blockedReasons.length > 0;

  let stageTitle = "可开始记录";
  let stageBody = "先写下病案重点；系统会先整理资料脉络，再进入临床复核。";

  if (draftChars > 0) {
    stageTitle = "可进入复核";
    stageBody = "记录已经就绪，提交后会先整理资料，再继续往下复核。";
  }
  if (organizeReady) {
    stageTitle = "资料整理完成";
    stageBody = "系统已经整理出关键脉络，下面这些提醒值得先看一眼。";
  }
  if (isAnalyzing) {
    stageTitle = "临床复核中";
    stageBody = "资料已整理完成，系统正在复核当前思路、方案与后续重点。";
  }
  if (isOrganizing) {
    stageTitle = "资料整理中";
    stageBody = "系统正在提炼病案脉络，并整理值得留意的资料提示。";
  }
  if (hasBlocked) {
    stageTitle = "建议先补充后再复核";
    stageBody = "当前资料已经整理完毕；若先补充这些关键信息，后续判断会更稳。";
  }
  if (analysisReady && !isRunning && !hasBlocked) {
    stageTitle = "复核完成";
    stageBody = "已生成临床参考，可继续对照病案与下方结果一起查看。";
  }

  return (
    <aside className="entry-status-panel">
      <p className="eyebrow">研判状态</p>
      {apiError ? (
        <article className="status-card status-error">
          <h4>本次未完成</h4>
          <p>{apiError}</p>
        </article>
      ) : (
        <article
          className={`status-card ${
            hasBlocked
              ? "status-blocked"
              : isRunning
                ? "status-running"
                : analysisReady
                  ? "status-ready"
                  : organizeReady
                    ? "status-organized"
                    : ""
          }`}
        >
          <h4 className={isRunning ? "status-active" : undefined}>
            {isRunning ? <LoaderCircle size={14} className="status-rotating" /> : null}
            {stageTitle}
          </h4>
          <p>{stageBody}</p>
          {draftChars ? <p>字数：{draftChars} · 记录状态：{hasSavedRecord ? "已保存" : "新建"}</p> : null}
          {draftChars && (isRunning || analysisReady || organizeReady || hasBlocked) ? (
            <p>已用时：{elapsedSeconds} 秒</p>
          ) : null}
          {organizeHighlights.length || organizeNotes.length || blockedReasons.length ? (
            <div className="status-inline-section">
              <strong>资料完整性</strong>
              {organizeHighlights.length ? (
                <ul>
                  {organizeHighlights.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {organizeNotes.length ? (
                <ul>
                  {organizeNotes.slice(0, 2).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {blockedReasons.length ? (
                <ul>
                  {blockedReasons.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {analysisReady && !hasBlocked ? <p>可在下方查看完整研判。</p> : null}
        </article>
      )}
    </aside>
  );
}

function OrganizeReviewPanel({
  stageOneHints,
  missingContext,
  organizeNotes,
  organizeSuggestions,
  blockedReasons,
}: {
  stageOneHints: string[];
  missingContext: string[];
  organizeNotes: string[];
  organizeSuggestions: string[];
  blockedReasons: string[];
}) {
  const sections = [
    {
      title: "建议先补充",
      items: [...stageOneHints, ...blockedReasons],
      tone: "warn",
    },
    {
      title: "值得留意",
      items: [...missingContext, ...organizeSuggestions],
      tone: "soft",
    },
    {
      title: "系统整理到的线索",
      items: organizeNotes,
      tone: "default",
    },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="organize-review-grid">
      {sections.map((section) => (
        <section key={section.title} className={`organize-review-card tone-${section.tone}`}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AnalysisBoard({
  result,
  qualityWarnings,
}: {
  result: AnalysisResult;
  qualityWarnings: string[];
}) {
  const completeness = result.groups.find((group) => group.title === "资料完整性");
  const currentThinking = result.groups.find((group) => group.title === "当前思路");
  const suggestions = result.groups.find((group) => group.title === "建议优化");
  const alternatives = result.groups.find((group) => group.title === "可选思路");
  const followUp = result.groups.find((group) => group.title === "随访监测");

  const completenessProvided = completeness?.sections.find((section) => section.title === "已提供")?.items ?? [];
  const completenessSuggested = completeness?.sections.find((section) => section.title === "建议补充")?.items ?? [];

  const dataSections = [
    { title: "资料完整性", items: [...completenessSuggested, ...qualityWarnings].filter(Boolean) },
    { title: "已提供", items: completenessProvided },
    { title: "病案摘要", items: [result.summary].filter(Boolean) },
  ];

  const judgementSections = currentThinking?.sections ?? [];
  const planSections = [...(suggestions?.sections ?? []), ...(alternatives?.sections ?? [])];
  const followSafetySections = [
    ...(followUp?.sections ?? []),
    ...(result.cautions.length ? [{ title: "风险与提醒", items: result.cautions }] : []),
    ...(result.evidence.length ? [{ title: "证据状态", items: result.evidence }] : []),
  ];

  return (
    <section className="analysis-board">
      <AnalysisColumn title="资料" icon={<FileText size={16} />} sections={dataSections} tone="warn" />
      <AnalysisColumn title="判断" icon={<Brain size={16} />} sections={judgementSections} />
      <AnalysisColumn title="方案" icon={<ListChecks size={16} />} sections={planSections} />
      <AnalysisColumn title="随访安全" icon={<ClipboardCheck size={16} />} sections={followSafetySections} tone="caution" />
    </section>
  );
}

function AnalysisColumn({
  title,
  icon,
  sections,
  tone = "default",
}: {
  title: string;
  icon: ReactNode;
  sections: Array<{ title: string; items: string[] }>;
  tone?: "default" | "warn" | "caution";
}) {
  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter(Boolean) }))
    .filter((section) => section.items.length > 0);

  if (!visibleSections.length) return null;

  return (
    <article className={`analysis-column tone-${tone}`}>
      <h3 className="analysis-column-title">
        <span>{icon}</span>
        {title}
      </h3>
      <div className="analysis-column-sections">
        {visibleSections.map((section) => (
          <section className="analysis-section" key={`${title}-${section.title}`}>
            <h4>{section.title}</h4>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}


