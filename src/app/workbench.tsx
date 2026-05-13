"use client";

import {
  Activity,
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
  const reviewItems = result?.groups
    .find((group) => group.title === "当前思路")
    ?.sections.find((section) => section.title === "需要复核")
    ?.items ?? [];
  const recommendationItems = result?.groups
    .find((group) => group.title === "建议优化")
    ?.sections.find((section) => section.title === "主要建议")
    ?.items ?? [];

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
          <div>
            <p className="eyebrow">临床参考</p>
            <h1>病案研判工作台</h1>
            <p className="hero-copy">
              从病案记录中提炼关键信息，标出影响判断的资料缺口，并输出可复核的中医临床参考。
            </p>
            <p className="hero-note">
              <AlertTriangle size={15} />
              仅供注册中医师临床参考，最终判断以医生面诊与专业评估为准。
            </p>
            <div className="hero-meta">
              <span>作者：Woo Chia Wei</span>
              <a href="https://github.com/chiaweiwoo/tcm-diagnosis" target="_blank" rel="noreferrer">
                <GitBranch size={15} />
                GitHub 仓库
              </a>
            </div>
          </div>
          <a className="secondary-button hero-action" href="/auth/signout">
            <LogOut size={15} />
            {userEmail}
          </a>
        </div>
      </section>

      <section className="panel flow-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>病案记录</h2>
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
              placeholder="粘贴病案、处方或针灸方案、复诊目标，以及需要复核的临床问题。"
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
              {isOrganizing ? "整理资料中..." : isAnalyzing ? "临床研判中..." : "开始研判"}
            </button>
            <p className="cost-note">
              {elapsedSeconds > 0 ? `用时 ${elapsedSeconds} 秒 · ` : ""}
              资料将先结构化，再进入临床研判；可按Ctrl+Enter提交。
            </p>
          </div>
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
              <div className="metric-grid">
                <MetricCard title="资料完整性" value={qualityWarnings.length} detail="项提醒" tone={qualityWarnings.length ? "warn" : "ok"} />
                <MetricCard title="临床风险" value={result.cautions.length} detail="项需注意" tone={result.cautions.length ? "warn" : "ok"} />
                <MetricCard title="需要复核" value={reviewItems.length} detail="项待确认" tone={reviewItems.length ? "warn" : "ok"} />
                <MetricCard title="建议重点" value={recommendationItems.length} detail="项建议" tone={recommendationItems.length ? "focus" : "ok"} />
              </div>

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

              {qualityWarnings.length ? (
                <article className="warning-card" id="completeness">
                  <SectionTitle icon={<AlertTriangle size={18} />}>资料完整性</SectionTitle>
                  <ul>
                    {qualityWarnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ) : null}

              <section className="result-group" id="summary">
                <SectionTitle icon={<Sparkles size={18} />}>病案摘要</SectionTitle>
                <p className="result-summary">{result.summary}</p>
              </section>

              <GroupedResults groups={result.groups} />

              <article className="caution-card" id="risk">
                <SectionTitle icon={<AlertTriangle size={18} />}>风险与提醒</SectionTitle>
                {result.cautions.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </article>

              <section className="result-group" id="evidence">
                <SectionTitle icon={<ClipboardCheck size={18} />}>证据状态</SectionTitle>
                <article className="result-card">
                  <ul>
                    {result.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </section>
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

function MetricCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string;
  value: number;
  detail: string;
  tone: "ok" | "warn" | "focus";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </article>
  );
}

function GroupedResults({ groups }: { groups: AnalysisResult["groups"] }) {
  return (
    <>
      {groups.map((group) => (
        <ResultGroup key={group.title} title={group.title} sections={group.sections} />
      ))}
    </>
  );
}

function ResultGroup({
  id,
  title,
  sections,
}: {
  id?: string;
  title: string;
  sections: AnalysisResult["groups"][number]["sections"];
}) {
  if (!sections.length) return null;

  return (
    <section className="result-group" id={id}>
      <SectionTitle icon={getResultIcon(title)}>{title}</SectionTitle>
      <div className="result-sections">
        {sections.map((section) => (
          <article className="result-card" key={section.title}>
            <h4>{section.title}</h4>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function getResultIcon(title: string) {
  if (title === "临床判断") return <Brain size={18} />;
  if (title === "建议方案") return <ListChecks size={18} />;
  if (title === "复核与随访") return <ClipboardCheck size={18} />;
  return <Activity size={18} />;
}


