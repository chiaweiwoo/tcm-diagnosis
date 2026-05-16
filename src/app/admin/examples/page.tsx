import type { StructuredCaseForm } from "@/lib/forms/caseSchema";

type AssessmentSample = {
  id: string;
  label: string;
  form_data: StructuredCaseForm;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

async function listAssessmentSamples(): Promise<AssessmentSample[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const url = new URL(`${supabaseUrl}/rest/v1/assessment_samples`);
  url.searchParams.set("select", "id,label,form_data,notes,is_active,sort_order,created_at");
  url.searchParams.set("order", "sort_order.asc");

  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return (await res.json()) as AssessmentSample[];
}

const PRESCRIPTION_COLORS: Record<string, string> = {
  "方药": "sample-chip--herbs",
  "针灸": "sample-chip--acu",
  "综合调理": "sample-chip--combo",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="sample-field">
      <span className="sample-field__label">{label}</span>
      <span className="sample-field__value">{value}</span>
    </div>
  );
}

function SampleCard({ sample, index }: { sample: AssessmentSample; index: number }) {
  const f = sample.form_data;
  const types = Array.isArray(f.prescriptionType) ? f.prescriptionType : [f.prescriptionType];

  return (
    <div className={`sample-card${!sample.is_active ? " sample-card--inactive" : ""}`}>
      {/* Summary row — always visible */}
      <div className="sample-card__summary">
        <span className="sample-card__index">{index + 1}</span>
        <div className="sample-card__identity">
          <span className="sample-card__patient">
            {f.patientSex} · {f.patientAge}岁
          </span>
          <div className="sample-card__chips">
            {types.map((t) => (
              <span key={t} className={`sample-chip ${PRESCRIPTION_COLORS[t] ?? ""}`}>{t}</span>
            ))}
          </div>
        </div>
        <div className="sample-card__chief">
          <span className="sample-card__complaint">{f.chiefComplaint}</span>
          <span className="sample-card__dx">{f.diagnosis} · {f.pattern}</span>
        </div>
        {!sample.is_active && <span className="sample-card__inactive-badge">已停用</span>}
      </div>

      {/* Expandable detail */}
      <details className="sample-details">
        <summary className="sample-details__toggle">查看详情</summary>
        <div className="sample-details__body">
          <div className="sample-fields-grid">
            <Field label="现病史" value={f.currentIllness} />
            <Field label="既往史" value={f.pastHistory} />
            <Field label="体格检查" value={f.physicalExam} />
            <Field label="处方" value={f.prescription} />
          </div>
          {sample.notes && (
            <p className="sample-notes">{sample.notes}</p>
          )}
        </div>
      </details>
    </div>
  );
}

export default async function ExamplesPage() {
  const samples = await listAssessmentSamples();
  const active = samples.filter((s) => s.is_active);

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>样本库</h1>
          <p className="admin-meta">
            {active.length} 个样本 · 数据存储于 Supabase，在表格编辑器中管理
          </p>
        </div>
      </div>

      {samples.length === 0 ? (
        <div className="admin-empty">
          <p>样本库为空。请在 Supabase SQL 编辑器中运行 <code>013_assessment_samples.sql</code>。</p>
        </div>
      ) : (
        <div className="sample-list">
          {samples.map((s, i) => (
            <SampleCard key={s.id} sample={s} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
