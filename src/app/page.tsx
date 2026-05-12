"use client";

import {
  Activity,
  AlertTriangle,
  Brain,
  ClipboardCheck,
  ListChecks,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useState } from "react";
import { CaseForm, validateCaseForm } from "@/lib/caseValidation";
import "./workbench.css";

type AnalysisResult = {
  title: string;
  summary: string;
  sections: Array<{ title: string; items: string[] }>;
  cautions: string[];
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

const resultGroups = [
  { title: "临床判断", sectionTitles: ["辨证假设", "当前方案评估"] },
  { title: "建议方案", sectionTitles: ["修改建议", "备选思路"] },
  { title: "复核与随访", sectionTitles: ["检查与监测", "证据缺口", "需要复核"] },
];

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || "请求失败，请稍后重试。";
  } catch {
    return "请求失败，请稍后重试。";
  }
}

export default function Home() {
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  const isBusy = isOrganizing || isAnalyzing;
  const isLocked = Boolean(result) || isBusy;
  const qualityWarnings = [...missingContext, ...organizeNotes, ...organizeSuggestions].filter(Boolean);

  useEffect(() => {
    if (!isBusy || !runStartedAt) return;

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isBusy, runStartedAt]);

  function resetSession() {
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
        usage?: ApiMeta["usage"];
        costUsd?: number;
        model?: string;
        promptVersion?: string;
        validation?: ReturnType<typeof validateCaseForm>;
      };

      setResult(analyzed.result);
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
      setMeta({
        usage: analyzed.usage,
        costUsd: analyzed.costUsd,
        model: analyzed.model,
        promptVersion: analyzed.promptVersion,
      });
      setMissingContext(analyzed.validation?.missingContext ?? validation.missingContext);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "生成分析失败，请稍后重试。");
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
      <section className="hero-panel">
        <p className="eyebrow">医生端临床辅助</p>
        <h1>病案研判工作台</h1>
        <p className="hero-copy">
          从病案记录中提炼关键信息，标出影响判断的资料缺口，并输出可复核的中医临床参考。
        </p>
      </section>

      <section className="notice-bar">
        <AlertTriangle size={18} />
        <span>仅供注册中医师临床参考，最终判断以医生面诊与专业评估为准。</span>
      </section>

      <section className="panel flow-panel">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">病案输入</p>
            <h2>病案记录</h2>
          </div>
          <button type="button" className="secondary-button compact-button" onClick={resetSession}>
            <RotateCcw size={15} />
            新建病案
          </button>
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
          <label className="field-block">
            <span>病案记录</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
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

          {qualityWarnings.length ? (
            <article className="warning-card">
              <SectionTitle icon={<AlertTriangle size={18} />}>资料完整性</SectionTitle>
              <ul>
                {qualityWarnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}

          <section className="result-group">
            <SectionTitle icon={<Sparkles size={18} />}>病案摘要</SectionTitle>
            <p className="result-summary">{result.summary}</p>
          </section>

          <GroupedResults sections={result.sections} />

          <article className="caution-card">
            <SectionTitle icon={<AlertTriangle size={18} />}>临床风险</SectionTitle>
            {result.cautions.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </article>

          {meta ? (
            <p className="cost-note">
              本次研判约 {meta.usage?.total_tokens ?? 0} tokens，费用约 US${(meta.costUsd ?? 0).toFixed(6)}。
            </p>
          ) : null}

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

function GroupedResults({ sections }: { sections: AnalysisResult["sections"] }) {
  const groupedTitles = new Set(resultGroups.flatMap((group) => group.sectionTitles));
  const otherSections = sections.filter((section) => !groupedTitles.has(section.title));

  return (
    <>
      {resultGroups.map((group) => (
        <ResultGroup
          key={group.title}
          title={group.title}
          sections={sections.filter((section) => group.sectionTitles.includes(section.title))}
        />
      ))}
      {otherSections.length ? <ResultGroup title="其他信息" sections={otherSections} /> : null}
    </>
  );
}

function ResultGroup({
  title,
  sections,
}: {
  title: string;
  sections: AnalysisResult["sections"];
}) {
  if (!sections.length) return null;

  return (
    <section className="result-group">
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
