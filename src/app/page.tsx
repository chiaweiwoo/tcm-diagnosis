"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";
import { CaseForm, validateCaseForm } from "@/lib/caseValidation";
import "./workbench.css";

type Step = "draft" | "review" | "result";

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

const estimatedTrialCost = {
  inputTokens: 3500,
  outputTokens: 1800,
  usd: 0.0031,
};

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || "请求失败，请稍后重试。";
  } catch {
    return "请求失败，请稍后重试。";
  }
}

export default function Home() {
  const [form, setForm] = useState<CaseForm>(initialForm);
  const [draft, setDraft] = useState("");
  const [activeStep, setActiveStep] = useState<Step>("draft");
  const [errors, setErrors] = useState<Partial<Record<keyof CaseForm, string>>>({});
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [organizeNotes, setOrganizeNotes] = useState<string[]>([]);
  const [organizeSuggestions, setOrganizeSuggestions] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [apiError, setApiError] = useState("");
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const filledCount = [
    form.caseType,
    form.age,
    form.sex,
    form.chiefComplaint,
    form.duration,
    form.currentPlan,
    form.doctorQuestion,
  ].filter(Boolean).length;

  function updateField(
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function organizeDraft() {
    const text = draft.trim();
    if (!text) return;

    setIsOrganizing(true);
    setApiError("");
    setResult(null);
    setMeta(null);

    try {
      const response = await fetch("/api/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: text }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as {
        form: CaseForm;
        notes?: string[];
        suggestions?: string[];
        usage?: ApiMeta["usage"];
        costUsd?: number;
        model?: string;
        promptVersion?: string;
      };

      setForm(body.form);
      setOrganizeNotes(body.notes ?? []);
      setOrganizeSuggestions(body.suggestions ?? []);
      setMeta({
        usage: body.usage,
        costUsd: body.costUsd,
        model: body.model,
        promptVersion: body.promptVersion,
      });
      setErrors({});
      setBlockedReasons([]);
      setMissingContext([]);
      setActiveStep("review");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "整理病案失败，请稍后重试。");
    } finally {
      setIsOrganizing(false);
    }
  }

  async function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateCaseForm(form);
    setErrors(validation.errors);
    setBlockedReasons(validation.blockedReasons);
    setMissingContext(validation.missingContext);
    setApiError("");
    setResult(null);

    if (Object.keys(validation.errors).length || validation.blockedReasons.length) {
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as {
        result: AnalysisResult;
        usage?: ApiMeta["usage"];
        costUsd?: number;
        model?: string;
        promptVersion?: string;
        validation?: ReturnType<typeof validateCaseForm>;
      };

      setResult(body.result);
      setMeta({
        usage: body.usage,
        costUsd: body.costUsd,
        model: body.model,
        promptVersion: body.promptVersion,
      });
      setMissingContext(body.validation?.missingContext ?? validation.missingContext);
      setActiveStep("result");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "生成分析失败，请稍后重试。");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">医生端测试版</p>
        <h1>输入病案，生成分析</h1>
        <p className="hero-copy">草稿整理与分析现在会通过服务端调用DeepSeek。</p>
      </section>

      <section className="notice-bar">
        <AlertTriangle size={18} />
        <span>本工具仅供注册中医师临床参考，不替代医生判断。</span>
      </section>

      <div className="work-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">流程</p>
              <h2>草稿整理 → 结构复核 → 生成分析</h2>
            </div>
            <span className="quiet-label">资料 {filledCount}/7</span>
          </div>

          <div className="steps" aria-label="流程步骤">
            <button
              type="button"
              className={activeStep === "draft" ? "active" : ""}
              onClick={() => setActiveStep("draft")}
            >
              1 草稿整理
            </button>
            <button
              type="button"
              className={activeStep === "review" ? "active" : ""}
              onClick={() => setActiveStep("review")}
              disabled={!form.chiefComplaint && !form.currentPlan}
            >
              2 结构复核
            </button>
            <button
              type="button"
              className={activeStep === "result" ? "active" : ""}
              onClick={() => setActiveStep("result")}
              disabled={!result}
            >
              3 分析结果
            </button>
          </div>

          {apiError ? <div className="blocked-box"><strong>请求失败</strong><span>{apiError}</span></div> : null}

          {activeStep === "draft" ? (
            <div className="draft-panel">
              <label className="field-block">
                <span>医生草稿</span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={14}
                  placeholder="可以直接粘贴或输入病案。系统会先整理成结构化字段，医生复核后再提交分析。"
                />
              </label>
              <button
                className="primary-button"
                type="button"
                onClick={organizeDraft}
                disabled={!draft.trim() || isOrganizing}
              >
                {isOrganizing ? "整理中..." : "整理成结构"}
              </button>
            </div>
          ) : null}

          {activeStep === "review" ? (
            <form className="case-form" onSubmit={submitCase}>
              {(organizeNotes.length > 0 || organizeSuggestions.length > 0) && (
                <div className="reminder-box">
                  <strong>整理提示</strong>
                  {[...organizeNotes, ...organizeSuggestions].map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              )}

              <div className="form-row three">
                <Field label="病案类型" badge="必填" error={errors.caseType}>
                  <select name="caseType" value={form.caseType} onChange={updateField}>
                    <option>方药分析</option>
                    <option>针灸方案</option>
                    <option>综合调理</option>
                  </select>
                </Field>

                <Field label="年龄" badge="建议补充" error={errors.age}>
                  <input name="age" value={form.age} onChange={updateField} inputMode="numeric" />
                </Field>

                <Field label="性别" badge="建议补充" error={errors.sex}>
                  <select name="sex" value={form.sex} onChange={updateField}>
                    <option value="">未填写</option>
                    <option>女</option>
                    <option>男</option>
                    <option>其他</option>
                  </select>
                </Field>
              </div>

              <Field label="主诉" badge="必填" error={errors.chiefComplaint}>
                <textarea name="chiefComplaint" value={form.chiefComplaint} onChange={updateField} rows={3} />
              </Field>

              <Field label="病程" badge="建议补充" error={errors.duration}>
                <input name="duration" value={form.duration} onChange={updateField} />
              </Field>

              <Field label="体质与生活背景" badge="建议补充">
                <input name="constitution" value={form.constitution} onChange={updateField} />
              </Field>

              <Field label="病史与治疗反应" badge="建议补充">
                <textarea name="history" value={form.history} onChange={updateField} rows={4} />
              </Field>

              <Field label="当前方案" badge="必填" error={errors.currentPlan}>
                <textarea name="currentPlan" value={form.currentPlan} onChange={updateField} rows={4} />
              </Field>

              <div className="form-row two">
                <Field
                  label="方药内容"
                  badge={form.caseType === "方药分析" ? "必填" : "可选"}
                  error={errors.herbs}
                >
                  <textarea name="herbs" value={form.herbs} onChange={updateField} rows={4} />
                </Field>

                <Field
                  label="穴位与操作"
                  badge={form.caseType === "针灸方案" ? "必填" : "可选"}
                  error={errors.acupoints}
                >
                  <textarea name="acupoints" value={form.acupoints} onChange={updateField} rows={4} />
                </Field>
              </div>

              <Field label="医生问题" badge="必填" error={errors.doctorQuestion}>
                <textarea name="doctorQuestion" value={form.doctorQuestion} onChange={updateField} rows={3} />
              </Field>

              {Object.keys(errors).length > 0 || blockedReasons.length > 0 ? (
                <div className="blocked-box">
                  <strong>暂不能提交</strong>
                  {Object.values(errors).map((error) => (
                    <span key={error}>{error}</span>
                  ))}
                  {blockedReasons.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              ) : null}

              {missingContext.length > 0 ? (
                <div className="reminder-box">
                  <strong>建议下次补充</strong>
                  {missingContext.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}

              <button className="primary-button" type="submit" disabled={isAnalyzing}>
                <Sparkles size={18} />
                {isAnalyzing ? "分析中..." : "生成分析"}
              </button>

              <p className="cost-note">
                预计单次分析约 {estimatedTrialCost.inputTokens.toLocaleString()} 输入tokens、
                {estimatedTrialCost.outputTokens.toLocaleString()} 输出tokens，约
                US${estimatedTrialCost.usd.toFixed(4)}。实际费用会按病案长度变化。
              </p>
            </form>
          ) : null}
        </section>

        <section className="panel result-column">
          {result ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">分析结果</p>
                  <h2>{result.title}</h2>
                </div>
                <span className="pill">{form.caseType}</span>
              </div>

              <p className="result-summary">{result.summary}</p>

              <div className="result-sections">
                {result.sections.map((section) => (
                  <article className="result-card" key={section.title}>
                    <h3>{section.title}</h3>
                    <ul>
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>

              <article className="caution-card">
                <h3>风险提示</h3>
                {result.cautions.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </article>

              {meta ? (
                <p className="cost-note">
                  本次调用约 {meta.usage?.total_tokens ?? 0} tokens，费用约 US${(meta.costUsd ?? 0).toFixed(6)}。
                </p>
              ) : null}
            </>
          ) : (
            <div className="empty-result">
              <Sparkles size={30} />
              <h2>等待提交</h2>
              <p>草稿整理并复核后，分析结果会显示在这里。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  badge,
  error,
  children,
}: {
  label: string;
  badge?: "必填" | "建议补充" | "可选";
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`field-block ${error ? "has-error" : ""}`}>
      <span>
        {label}
        {badge ? <em className={`field-badge ${badge === "必填" ? "required" : ""}`}>{badge}</em> : null}
      </span>
      {children}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}
