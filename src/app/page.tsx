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
import { ReactNode, useState } from "react";
import { CaseForm, validateCaseForm } from "@/lib/caseValidation";
import "./workbench.css";

type Step = "draft" | "result";

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
  const [activeStep, setActiveStep] = useState<Step>("draft");
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [organizeNotes, setOrganizeNotes] = useState<string[]>([]);
  const [organizeSuggestions, setOrganizeSuggestions] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [apiError, setApiError] = useState("");
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const isBusy = isOrganizing || isAnalyzing;
  const qualityWarnings = [...missingContext, ...organizeNotes, ...organizeSuggestions].filter(Boolean);

  function resetSession() {
    setDraft("");
    setForm(initialForm);
    setActiveStep("draft");
    setBlockedReasons([]);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
    setResult(null);
    setMeta(null);
    setApiError("");
    setIsOrganizing(false);
    setIsAnalyzing(false);
  }

  async function analyzeDraft() {
    const text = draft.trim();
    if (!text) return;

    setApiError("");
    setBlockedReasons([]);
    setMissingContext([]);
    setOrganizeNotes([]);
    setOrganizeSuggestions([]);
    setResult(null);
    setMeta(null);
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
      const hardErrors = [...Object.values(validation.errors), ...validation.blockedReasons].filter(Boolean);

      setForm(nextForm);
      setOrganizeNotes(organized.notes ?? []);
      setOrganizeSuggestions(organized.suggestions ?? []);
      setMissingContext(validation.missingContext);

      if (hardErrors.length) {
        setBlockedReasons(hardErrors);
        return;
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
        usage?: ApiMeta["usage"];
        costUsd?: number;
        model?: string;
        promptVersion?: string;
        validation?: ReturnType<typeof validateCaseForm>;
      };

      setResult(analyzed.result);
      setMeta({
        usage: analyzed.usage,
        costUsd: analyzed.costUsd,
        model: analyzed.model,
        promptVersion: analyzed.promptVersion,
      });
      setMissingContext(analyzed.validation?.missingContext ?? validation.missingContext);
      setActiveStep("result");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "生成分析失败，请稍后重试。");
    } finally {
      setIsOrganizing(false);
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">医生端测试版</p>
        <h1>输入草稿，生成临床参考</h1>
        <p className="hero-copy">
          系统先整理病案，再标出资料缺口，最后生成务实、可追踪的中医临床建议。
        </p>
      </section>

      <section className="notice-bar">
        <AlertTriangle size={18} />
        <span>本工具仅供注册中医师临床参考，不替代医生判断。</span>
      </section>

      <section className="panel flow-panel">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">流程</p>
            <h2>草稿输入 → 分析结果</h2>
          </div>
          <button type="button" className="secondary-button compact-button" onClick={resetSession}>
            <RotateCcw size={15} />
            重新开始
          </button>
        </div>

        <div className="steps two-steps" aria-label="流程步骤">
          <button
            type="button"
            className={activeStep === "draft" ? "active" : ""}
            onClick={() => setActiveStep("draft")}
          >
            1 草稿输入
          </button>
          <button
            type="button"
            className={activeStep === "result" ? "active" : ""}
            onClick={() => setActiveStep("result")}
            disabled={!result}
          >
            2 分析结果
          </button>
        </div>

        {apiError ? (
          <div className="blocked-box">
            <strong>请求失败</strong>
            <span>{apiError}</span>
          </div>
        ) : null}

        {blockedReasons.length ? (
          <div className="blocked-box">
            <strong>暂不能生成</strong>
            {blockedReasons.map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}

        {activeStep === "draft" ? (
          <div className="draft-panel compact-draft">
            <label className="field-block">
              <span>医生草稿</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={12}
                placeholder="直接粘贴病案、当前治疗方案和医生问题。系统会自动整理资料并提示可能影响判断的缺口。"
              />
            </label>

            <div className="action-bar">
              <button
                className="primary-button"
                type="button"
                onClick={analyzeDraft}
                disabled={!draft.trim() || isBusy}
              >
                <Sparkles size={18} />
                {isOrganizing ? "整理资料中..." : isAnalyzing ? "生成分析中..." : "生成分析"}
              </button>
              <p className="cost-note">先整理资料，再调用DeepSeek生成分析；若资料不足会先提示。</p>
            </div>
          </div>
        ) : null}
      </section>

      {activeStep === "result" && result ? (
        <section className="panel result-panel-full">
          <div className="section-heading">
            <div>
              <p className="eyebrow">分析结果</p>
              <h2>{result.title}</h2>
            </div>
            <span className="pill">{form.caseType}</span>
          </div>

          {qualityWarnings.length ? (
            <article className="warning-card">
              <SectionTitle icon={<AlertTriangle size={18} />}>资料缺口与准确性提醒</SectionTitle>
              <ul>
                {qualityWarnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}

          <section className="result-group">
            <SectionTitle icon={<Sparkles size={18} />}>摘要</SectionTitle>
            <p className="result-summary">{result.summary}</p>
          </section>

          <GroupedResults sections={result.sections} />

          <article className="caution-card">
            <SectionTitle icon={<AlertTriangle size={18} />}>风险提示</SectionTitle>
            {result.cautions.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </article>

          {meta ? (
            <p className="cost-note">
              本次分析约 {meta.usage?.total_tokens ?? 0} tokens，费用约 US${(meta.costUsd ?? 0).toFixed(6)}。
            </p>
          ) : null}

          <div className="result-actions">
            <button type="button" className="secondary-button" onClick={() => setActiveStep("draft")}>
              返回草稿
            </button>
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
