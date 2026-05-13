"use client";

import {
  AlertTriangle,
  Brain,
  ClipboardCheck,
  FileText,
  GitBranch,
  ListChecks,
  LogOut,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useState } from "react";
import { CaseForm, validateCaseForm } from "@/lib/caseValidation";
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

export default function Workbench({ userEmail }: { userEmail: string }) {
  const [consultationName, setConsultationName] = useState("");
  const [activeConsultationId, setActiveConsultationId] = useState("");
  const [consultations, setConsultations] = useState<ConsultationSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [form, setForm] = useState<CaseForm>(initialForm);
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

  const isBusy = isOrganizing || isAnalyzing || isSaving;
  const isLocked = isBusy || (Boolean(result) && !isEditing);
  const hasSavedRecord = Boolean(activeConsultationId);
  const qualityWarnings = [...missingContext, ...organizeNotes, ...organizeSuggestions].filter(Boolean);
  const analysisReady = Boolean(result);

  useEffect(() => {
    void loadConsultations();
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

  function resetSession() {
    setConsultationName("");
    setActiveConsultationId("");
    setDraft("");
    setForm(initialForm);
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
    showToast("已建立新的病案记录。", "info");
  }

  function clearAnalysisForEdit(nextDraft?: string) {
    if (!result) return;
    setResult(null);
    setMeta(null);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
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
    };
  }) {
    const modelMeta = {
      usage: input.analyzed.usage,
      costUsd: input.analyzed.costUsd,
      model: input.analyzed.model,
      promptVersion: input.analyzed.promptVersion,
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
  }) {
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
      setMissingContext(record.validation_result?.missingContext ?? []);
      setOrganizeNotes([]);
      setOrganizeSuggestions([]);
      setBlockedReasons([]);
      setApiError("");
      setElapsedSeconds(0);
      setRunStartedAt(null);
      setIsEditing(false);
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
    setBlockedReasons([]);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
    setResult(null);
    setMeta(null);
    setElapsedSeconds(0);
    setRunStartedAt(startedAt);
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
      setOrganizeNotes(organized.notes ?? []);
      setOrganizeSuggestions(organized.suggestions ?? []);
      setMissingContext([
        ...validation.missingContext,
        ...Object.values(validation.errors),
        ...validation.blockedReasons,
      ].filter(Boolean));

      const recordId = activeConsultationId || (await saveDraftOnly(text, consultationName));
      if (recordId) {
        await saveOrganizeSnapshot({
          recordId,
          draftText: text,
          organized,
        });
      }

      setIsOrganizing(false);
      setIsAnalyzing(true);

      const analyzeResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: nextForm }),
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
        await saveAnalysisResult({ recordId, organized, analyzed });
      }

      setResult(analyzed.result);
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
      setMeta({
        usage: analyzed.usage,
        costUsd: analyzed.costUsd,
        model: analyzed.model,
        promptVersion: analyzed.promptVersion,
      });
      setMissingContext(analyzed.validation?.missingContext ?? validation.missingContext);
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
      {toast ? <div className={`toast-message ${toast.tone}`}>{toast.message}</div> : null}

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

        {blockedReasons.length ? (
          <div className="blocked-box">
            <strong>暂无法研判</strong>
            {blockedReasons.map((reason) => (
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
                placeholder="例如：PCOS复诊、拇指弹响指"
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
          <EntryStatusPanel
            apiError={apiError}
            draft={draft}
            hasSavedRecord={hasSavedRecord}
            isAnalyzing={isAnalyzing}
            isOrganizing={isOrganizing}
            elapsedSeconds={elapsedSeconds}
            analysisReady={analysisReady}
          />
        </div>
      </section>

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

function EntryStatusPanel({
  apiError,
  draft,
  hasSavedRecord,
  isAnalyzing,
  isOrganizing,
  elapsedSeconds,
  analysisReady,
}: {
  apiError: string;
  draft: string;
  hasSavedRecord: boolean;
  isAnalyzing: boolean;
  isOrganizing: boolean;
  elapsedSeconds: number;
  analysisReady: boolean;
}) {
  const isRunning = isOrganizing || isAnalyzing;
  const draftChars = draft.trim().length;

  return (
    <aside className="entry-status-panel">
      <p className="eyebrow">研判状态</p>
      {apiError ? (
        <article className="status-card status-error">
          <h4>请求失败</h4>
          <p>{apiError}</p>
        </article>
      ) : null}
      {!apiError && !draftChars ? (
        <article className="status-card">
          <h4>待输入</h4>
          <p>请先录入病案内容，系统会在提交后生成结构化临床参考。</p>
        </article>
      ) : null}
      {!apiError && draftChars > 0 && !isRunning && !analysisReady ? (
        <article className="status-card">
          <h4>待研判</h4>
          <ul>
            <li>字数：{draftChars}</li>
            <li>记录状态：{hasSavedRecord ? "已保存" : "新建"}</li>
            <li>尚未生成临床参考</li>
          </ul>
        </article>
      ) : null}
      {!apiError && isRunning ? (
        <article className="status-card status-running">
          <h4>{isOrganizing ? "资料整理中" : "临床研判中"}</h4>
          <p>已用时：{elapsedSeconds} 秒</p>
        </article>
      ) : null}
      {!apiError && analysisReady && !isRunning ? (
        <article className="status-card status-ready">
          <h4>研判完成</h4>
          <p>已生成临床参考。</p>
          <p>生成用时：{elapsedSeconds} 秒</p>
          <p>可在下方查看完整研判。</p>
        </article>
      ) : null}
    </aside>
  );
}

function AnalysisBoard({
  result,
  qualityWarnings,
}: {
  result: AnalysisResult;
  qualityWarnings: string[];
}) {
  const currentThinking = result.groups.find((group) => group.title === "当前思路");
  const suggestions = result.groups.find((group) => group.title === "建议优化");
  const alternatives = result.groups.find((group) => group.title === "可选思路");
  const followUp = result.groups.find((group) => group.title === "随访监测");

  const dataSections = [
    qualityWarnings.length ? { title: "资料完整性", items: qualityWarnings } : null,
    result.summary ? { title: "病案摘要", items: [result.summary] } : null,
  ].filter((section): section is { title: string; items: string[] } => Boolean(section));

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


