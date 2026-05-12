"use client";

import {
  Activity,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";
import { CaseForm, validateCaseForm } from "@/lib/caseValidation";
import "./workbench.css";

type MockResult = {
  title: string;
  summary: string;
  sections: Array<{ title: string; items: string[] }>;
  cautions: string[];
};

const samples: Record<"pcos" | "trigger", CaseForm> = {
  pcos: {
    caseType: "方药分析",
    age: "33",
    sex: "女",
    constitution: "素食者，气血化源可能不足",
    chiefComplaint: "停经9月余，PCOS，经药物催经后月经点滴不畅，少许痛经",
    duration: "9月余",
    history: "有PCOS。服用荷尔蒙药物2周催经，停药后月经来潮。服药5日后月经干净，现以调理下次月经周期为主。",
    currentPlan:
      "经后调理颗粒5日：六味地黄5g，巴戟天1g，女贞子1g，枸杞子1g，香附1g，熟地黄1g，肉苁蓉1g。",
    herbs:
      "前方：杏仁10g，红花10g，熟地黄10g，赤芍10g，补骨脂10g，三棱5g，莪术5g，香附10g，丹参10g，益母草10g，肉苁蓉10g，巴戟天10g。",
    acupoints: "",
    doctorQuestion: "结合现有临床研究与以上病案，判断经后调理方是否需要调整，并提出可操作建议。",
    modelMode: "快速模式",
  },
  trigger: {
    caseType: "针灸方案",
    age: "54",
    sex: "女",
    constitution: "未详",
    chiefComplaint: "右侧拇指弹响指半年余，针刺数次后拇指尚无法弯曲",
    duration: "半年余",
    history: "掌面掌指关节压痛，活动时酸楚。既往针刺后改善有限。",
    currentPlan: "针刺阿是穴、合谷穴。",
    herbs: "",
    acupoints: "阿是穴，合谷穴",
    doctorQuestion: "根据可查询的临床研究文献，对现有针灸方案进行改良，目标为提升疗效并降低操作风险。",
    modelMode: "快速模式",
  },
};

const historyRows = [
  { title: "PCOS经后调理", meta: "方药分析 · 已生成 · 医生反馈：有帮助" },
  { title: "右拇指弹响指", meta: "针灸方案 · 已生成 · 等待复核" },
  { title: "膝痛术后恢复", meta: "综合调理 · 被拦截：资料不足" },
];

function buildMockResult(form: CaseForm): MockResult {
  if (form.caseType === "针灸方案") {
    return {
      title: "针灸方案改良预览",
      summary:
        "本次建议以局部解剖定位与活动功能恢复为核心，保留有效远端配穴，同时加强A1滑车区与拇短屈肌相关软组织松解思路。",
      sections: [
        {
          title: "方案改良重点",
          items: [
            "优先评估拇指A1滑车处压痛、弹响位置与屈伸受限程度。",
            "局部治疗应围绕屈肌腱鞘区域，不宜只依赖单一阿是穴描述。",
            "每次治疗后记录疼痛、弹响频率、主动屈曲角度与晨僵变化。",
          ],
        },
        {
          title: "局部取穴建议",
          items: [
            "拇指A1滑车处屈肌腱桡侧与尺侧各一针，作为最关键改动。",
            "加鱼际，以处理拇指掌侧肌群紧张与局部气血不畅。",
            "可评估拇短屈肌肌腹干针或局部松解，但需由熟悉手部解剖者操作。",
          ],
        },
        {
          title: "远端配穴建议",
          items: [
            "合谷可维持，用于手部疼痛与经络循行配伍。",
            "可加内关、曲池，配合上肢气血运行与疼痛调节。",
            "若炎症或肿胀明显，应降低刺激量并重新评估方案。",
          ],
        },
      ],
      cautions: [
        "避免直接刺入肌腱或血管神经风险区域。",
        "若持续锁指、夜间痛加重或功能明显下降，应建议转诊评估。",
      ],
    };
  }

  return {
    title: "方药分析预览",
    summary:
      "本次建议围绕肾虚夹瘀、冲任失调与素食者气血化源不足进行讨论；当前经后调理方方向可保留，但剂量与补肾养血配伍偏弱。",
    sections: [
      {
        title: "辨证假设",
        items: [
          "停经日久兼PCOS，可从肾虚、痰瘀、冲任失调方向综合考虑。",
          "经行点滴不畅与少许痛经提示瘀阻因素仍需关注。",
          "素食者需特别评估铁、维生素B12、维生素D等营养基础。",
        ],
      },
      {
        title: "调方建议",
        items: [
          "巴戟天、女贞子、枸杞子可考虑上调至2至3g区间，具体依颗粒规格与医师经验调整。",
          "可考虑加菟丝子以加强补肾调冲任方向。",
          "可考虑加当归1至2g，兼顾养血活血与内膜状态。",
        ],
      },
      {
        title: "检查与监测",
        items: [
          "建议复核性激素六项、AMH、甲状腺功能。",
          "建议检查空腹胰岛素、血糖，以评估胰岛素抵抗。",
          "建议血常规、铁蛋白、维生素B12、维生素D，并结合BBT或B超监测排卵。",
        ],
      },
    ],
    cautions: [
      "不能承诺促排或月经恢复，需结合检查与连续周期观察。",
      "活血药物使用需关注出血量、妊娠可能与患者体质反应。",
    ],
  };
}

export default function Home() {
  const [form, setForm] = useState<CaseForm>(samples.pcos);
  const [errors, setErrors] = useState<Partial<Record<keyof CaseForm, string>>>({});
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [missingContext, setMissingContext] = useState<string[]>([]);
  const [result, setResult] = useState<MockResult | null>(null);

  const modelLabel = form.modelMode === "快速模式" ? "deepseek-v4-flash" : "deepseek-v4-pro";
  const requiredCount = [
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

  function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValidation = validateCaseForm(form);
    setErrors(nextValidation.errors);
    setBlockedReasons(nextValidation.blockedReasons);
    setMissingContext(nextValidation.missingContext);

    if (Object.keys(nextValidation.errors).length || nextValidation.blockedReasons.length) {
      setResult({
        title: "请求已被拦截",
        summary: "当前病案尚未达到提交给AI分析的最低资料要求。请补充必要临床背景后再生成分析。",
        sections: [
          {
            title: "需要处理的问题",
            items: [
              ...Object.values(nextValidation.errors),
              ...nextValidation.blockedReasons,
            ].filter(Boolean),
          },
        ],
        cautions: [
          "系统会保存拦截原因，供后续优化表单与提示词。",
          ...nextValidation.missingContext,
        ],
      });
      return;
    }

    setResult(buildMockResult(form));
  }

  function loadSample(sample: "pcos" | "trigger") {
    setForm(samples[sample]);
    setErrors({});
    setBlockedReasons([]);
    setMissingContext([]);
    setResult(null);
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">医生端 · 中医病案分析</p>
          <h1>输入病案，生成分析</h1>
          <p className="hero-copy">
            先用模拟结果测试流程；真实DeepSeek调用稍后接入。
          </p>
        </div>
      </section>

      <section className="notice-bar">
        <AlertTriangle size={18} />
        <span>本工具仅供注册中医师临床参考，不替代医生判断；任何建议均需结合面诊、检查与执业规范复核。</span>
      </section>

      <div className="dashboard-grid">
        <section className="main-panel" id="input">
          <div className="section-heading">
            <div>
              <p className="eyebrow">结构化输入</p>
              <h2>病案输入</h2>
            </div>
            <div className="sample-actions">
              <button type="button" onClick={() => loadSample("pcos")}>载入PCOS样本</button>
              <button type="button" onClick={() => loadSample("trigger")}>载入弹响指样本</button>
            </div>
          </div>

          <div className="compact-status">
            <span>资料完整度 {requiredCount}/7</span>
            <small>缺少资料会提示，不会随意硬挡。</small>
          </div>

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
                <input name="age" value={form.age} onChange={updateField} inputMode="numeric" placeholder="例：33" />
              </Field>
              <Field label="性别" badge="建议补充" error={errors.sex}>
                <select name="sex" value={form.sex} onChange={updateField}>
                  <option value="">请选择</option>
                  <option>女</option>
                  <option>男</option>
                  <option>其他</option>
                </select>
              </Field>
            </div>

            <Field label="体质与生活背景" badge="建议补充">
              <input
                name="constitution"
                value={form.constitution}
                onChange={updateField}
                placeholder="例：素食者、睡眠差、运动量少"
              />
            </Field>

            <div className="form-row two">
              <Field label="主诉" badge="必填" error={errors.chiefComplaint}>
                <textarea
                  name="chiefComplaint"
                  value={form.chiefComplaint}
                  onChange={updateField}
                  rows={3}
                  placeholder="请写明主要症状与影响"
                />
              </Field>
              <Field label="病程" badge="建议补充" error={errors.duration}>
                <textarea
                  name="duration"
                  value={form.duration}
                  onChange={updateField}
                  rows={3}
                  placeholder="例：半年余、9月余"
                />
              </Field>
            </div>

            <Field label="病史与治疗反应" badge="建议补充">
              <textarea
                name="history"
                value={form.history}
                onChange={updateField}
                rows={4}
                placeholder="请补充检查、既往诊断、用药、针灸后反应等"
              />
            </Field>

            <Field label="当前方案" badge="必填" error={errors.currentPlan}>
              <textarea
                name="currentPlan"
                value={form.currentPlan}
                onChange={updateField}
                rows={4}
                placeholder="请填写正在使用的方药、穴位、手法或调理方案"
              />
            </Field>

            <div className="form-row two">
              <Field label="方药内容" badge={form.caseType === "方药分析" ? "必填" : "可选"} error={errors.herbs}>
                <textarea
                  name="herbs"
                  value={form.herbs}
                  onChange={updateField}
                  rows={4}
                  placeholder="方药分析必填：药名、剂量、天数"
                />
              </Field>
              <Field label="穴位与操作" badge={form.caseType === "针灸方案" ? "必填" : "可选"} error={errors.acupoints}>
                <textarea
                  name="acupoints"
                  value={form.acupoints}
                  onChange={updateField}
                  rows={4}
                  placeholder="针灸方案必填：穴位、刺激量、疗程"
                />
              </Field>
            </div>

            <div className="form-row two compact">
              <Field label="医生问题" badge="必填" error={errors.doctorQuestion}>
                <textarea
                  name="doctorQuestion"
                  value={form.doctorQuestion}
                  onChange={updateField}
                  rows={3}
                  placeholder="例：请判断当前方案可如何改良，并指出风险"
                />
              </Field>
              <Field label="模型模式" badge="可选">
                <select name="modelMode" value={form.modelMode} onChange={updateField}>
                  <option>快速模式</option>
                  <option>深度模式</option>
                </select>
                <p className="field-hint">{modelLabel}</p>
              </Field>
            </div>

            {blockedReasons.length > 0 && (
              <div className="blocked-box">
                <strong>提交已拦截</strong>
                {blockedReasons.map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
            )}

            {missingContext.length > 0 && (
              <div className="reminder-box">
                <strong>建议下次补充</strong>
                {missingContext.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            )}

            <div className="submit-row">
              <button className="primary-button" type="submit">
                <Sparkles size={18} />生成分析预览
              </button>
              <p>当前为本地模拟结果；真实DeepSeek调用将在服务端接入。</p>
            </div>
          </form>
        </section>

        {result ? (
          <section className="result-panel" id="result">
            <div className="section-heading">
              <div>
                <p className="eyebrow">AI输出</p>
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
              <h3><AlertTriangle size={18} />风险提示</h3>
              {result.cautions.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </article>
          </section>
        ) : (
          <section className="empty-panel">
            <Sparkles size={28} />
            <h2>提交后显示分析结果</h2>
            <p>可先载入样本快速测试，也可以直接输入新病案。</p>
          </section>
        )}

        <section className="history-panel" id="history">
          <div className="section-heading">
            <div>
              <p className="eyebrow">留存记录</p>
              <h2>历史记录</h2>
            </div>
            <Activity size={20} />
          </div>
          <div className="history-list">
            {historyRows.map((row) => (
              <button key={row.title} type="button">
                <span>{row.title}</span>
                <small>{row.meta}</small>
              </button>
            ))}
          </div>
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
