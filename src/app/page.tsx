"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";
import { CaseForm, validateCaseForm } from "@/lib/caseValidation";
import "./workbench.css";

type MockResult = {
  title: string;
  summary: string;
  sections: Array<{ title: string; items: string[] }>;
  cautions: string[];
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

function buildMockResult(form: CaseForm): MockResult {
  if (form.caseType === "针灸方案") {
    return {
      title: "针灸方案分析预览",
      summary:
        "当前为模拟输出。正式接入后，系统会根据医生输入、资料完整度与安全检查生成更稳定的结构化建议。",
      sections: [
        {
          title: "方案判断",
          items: [
            "先确认局部压痛点、活动受限程度与既往治疗反应。",
            "保留当前方案中合理部分，再提出最小必要改动。",
          ],
        },
        {
          title: "改良方向",
          items: [
            "优先选择容易执行、风险较低、便于复诊观察的穴位组合。",
            "若涉及局部深刺或干针，应提示医生复核解剖风险。",
          ],
        },
      ],
      cautions: ["若症状持续加重、锁指明显或功能下降，应建议进一步评估。"],
    };
  }

  return {
    title: "方药分析预览",
    summary:
      "当前为模拟输出。正式接入后，系统会根据医生输入、资料完整度与安全检查生成更稳定的结构化建议。",
    sections: [
      {
        title: "方案判断",
        items: [
          "先判断当前方药方向是否与主诉、病程和治疗目标一致。",
          "保留当前方案中合理部分，再提出最小必要改动。",
        ],
      },
      {
        title: "改良方向",
        items: [
          "优先考虑新加坡门诊较容易取得、患者较容易执行的药材或颗粒方案。",
          "若资料不足，应降低置信度，并提示下次问诊需要补充的信息。",
        ],
      },
    ],
    cautions: ["不承诺疗效；涉及活血、妊娠可能、出血风险时需医生复核。"],
  };
}

export default function Home() {
  const [form, setForm] = useState<CaseForm>(initialForm);
  const [draft, setDraft] = useState("");
  const [activeTab, setActiveTab] = useState<"draft" | "review">("draft");
  const [errors, setErrors] = useState<Partial<Record<keyof CaseForm, string>>>({});
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [result, setResult] = useState<MockResult | null>(null);

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

  function organizeDraft() {
    const text = draft.trim();
    const isAcupuncture = /针|穴|弹响|拇指|疼痛|酸楚/.test(text);
    const isHerb = /方|药|颗粒|经|PCOS|停经|月经|剂量/.test(text);

    setForm((current) => ({
      ...current,
      caseType: isAcupuncture && !isHerb ? "针灸方案" : "方药分析",
      chiefComplaint: text.slice(0, 120),
      currentPlan: text,
      herbs: isHerb ? text : "",
      acupoints: isAcupuncture ? text : "",
      doctorQuestion: "请整理病案重点，判断当前方案可如何改良，并指出风险与需要补充的信息。",
    }));
    setErrors({});
    setBlockedReasons([]);
    setMissingContext([]);
    setResult(null);
    setActiveTab("review");
  }

  function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateCaseForm(form);
    setErrors(validation.errors);
    setBlockedReasons(validation.blockedReasons);
    setMissingContext(validation.missingContext);

    if (Object.keys(validation.errors).length || validation.blockedReasons.length) {
      setResult(null);
      return;
    }

    setResult(buildMockResult(form));
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">医生端测试版</p>
        <h1>输入病案，生成分析</h1>
        <p className="hero-copy">当前为模拟结果，用来确认输入、校验与输出流程。</p>
      </section>

      <section className="notice-bar">
        <AlertTriangle size={18} />
        <span>本工具仅供注册中医师临床参考，不替代医生判断。</span>
      </section>

      <div className="work-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">第一步</p>
              <h2>输入与复核</h2>
            </div>
            <span className="quiet-label">资料 {filledCount}/7</span>
          </div>

          <div className="tabs" role="tablist" aria-label="输入流程">
            <button
              type="button"
              className={activeTab === "draft" ? "active" : ""}
              onClick={() => setActiveTab("draft")}
            >
              草稿整理
            </button>
            <button
              type="button"
              className={activeTab === "review" ? "active" : ""}
              onClick={() => setActiveTab("review")}
            >
              结构复核
            </button>
          </div>

          {activeTab === "draft" ? (
            <div className="draft-panel">
              <label className="field-block">
                <span>医生草稿</span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={14}
                  placeholder="可以直接粘贴或输入病案。下一步会先模拟整理成结构化字段，医生复核后再提交。"
                />
              </label>
              <button className="primary-button" type="button" onClick={organizeDraft} disabled={!draft.trim()}>
                整理成结构
              </button>
            </div>
          ) : (
          <form className="case-form" onSubmit={submitCase}>
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
              <textarea
                name="chiefComplaint"
                value={form.chiefComplaint}
                onChange={updateField}
                rows={3}
                placeholder="例如：右侧拇指弹响指半年余，活动受限"
              />
            </Field>

            <Field label="病程" badge="建议补充" error={errors.duration}>
                <input name="duration" value={form.duration} onChange={updateField} placeholder="例如：半年余" />
            </Field>

            <Field label="体质与生活背景" badge="建议补充">
              <input
                name="constitution"
                value={form.constitution}
                onChange={updateField}
                placeholder="例如：素食者、睡眠差、压力大"
              />
            </Field>

            <Field label="病史与治疗反应" badge="建议补充">
              <textarea
                name="history"
                value={form.history}
                onChange={updateField}
                rows={4}
                placeholder="检查、既往诊断、用药或治疗后的反应"
              />
            </Field>

            <Field label="当前方案" badge="必填" error={errors.currentPlan}>
              <textarea
                name="currentPlan"
                value={form.currentPlan}
                onChange={updateField}
                rows={4}
                placeholder="正在使用的方药、穴位、手法或调理方案"
              />
            </Field>

            <div className="form-row two">
              <Field
                label="方药内容"
                badge={form.caseType === "方药分析" ? "必填" : "可选"}
                error={errors.herbs}
              >
                <textarea
                  name="herbs"
                  value={form.herbs}
                  onChange={updateField}
                  rows={4}
                  placeholder="药名、剂量、天数"
                />
              </Field>

              <Field
                label="穴位与操作"
                badge={form.caseType === "针灸方案" ? "必填" : "可选"}
                error={errors.acupoints}
              >
                <textarea
                  name="acupoints"
                  value={form.acupoints}
                  onChange={updateField}
                  rows={4}
                  placeholder="穴位、刺激量、疗程"
                />
              </Field>
            </div>

            <Field label="医生问题" badge="必填" error={errors.doctorQuestion}>
              <textarea
                name="doctorQuestion"
                value={form.doctorQuestion}
                onChange={updateField}
                rows={3}
                placeholder="例如：请判断当前方案如何改良，并指出风险"
              />
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

            <button className="primary-button" type="submit">
              <Sparkles size={18} />
              生成分析预览
            </button>

            <p className="cost-note">
              预计单次真实调用约 {estimatedTrialCost.inputTokens.toLocaleString()} 输入tokens、
              {estimatedTrialCost.outputTokens.toLocaleString()} 输出tokens，约
              US${estimatedTrialCost.usd.toFixed(4)}。实际费用会按病案长度变化。
            </p>
          </form>
          )}
        </section>

        <section className="panel result-column">
          {result ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">第二步</p>
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
            </>
          ) : (
            <div className="empty-result">
              <Sparkles size={30} />
              <h2>等待提交</h2>
              <p>填写病案后，结果会显示在这里。</p>
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
    <label className="field-block">
      <span>
        {label}
        {badge ? <em className={`field-badge ${badge === "必填" ? "required" : ""}`}>{badge}</em> : null}
      </span>
      {children}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}
