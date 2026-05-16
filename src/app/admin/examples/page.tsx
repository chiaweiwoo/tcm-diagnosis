import Link from "next/link";
import { listDoctorExamples, type DoctorExample } from "@/lib/doctorExamples";

const CASE_TYPE_COLORS: Record<string, string> = {
  "方药分析": "tag-herbs",
  "针灸方案": "tag-acu",
  "综合调理": "tag-combo",
};

function ExampleCard({ ex, index }: { ex: DoctorExample; index: number }) {
  const tagClass = CASE_TYPE_COLORS[ex.case_type_guess] ?? "tag-default";

  return (
    <div className={`example-full-card ${!ex.is_active ? "example-inactive" : ""}`}>
      <div className="example-full-header">
        <span className="example-index">#{index + 1}</span>
        <code className="example-id">{ex.id}</code>
        <span className={`example-tag ${tagClass}`}>{ex.case_type_guess || "—"}</span>
        <span className="example-tag muted">{ex.topic_guess || "—"}</span>
        {!ex.is_active && <span className="example-inactive-badge">已停用</span>}
        <span className="example-updated">更新 {new Date(ex.updated_at).toLocaleDateString("zh-SG")}</span>
      </div>
      <pre className="example-draft-full">{ex.draft}</pre>
    </div>
  );
}

export default async function ExamplesPage() {
  const examples = await listDoctorExamples();
  const active = examples.filter((e) => e.is_active);
  const inactive = examples.filter((e) => !e.is_active);

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">后台管理</p>
          <h1>样本库</h1>
          <p className="admin-meta">
            {active.length} 个启用样本
            {inactive.length > 0 && <> · {inactive.length} 个已停用</>}
            {" · "}通过 <code>npm run assess:seed</code> 从本地 .md 文件同步
          </p>
        </div>
        <Link href="/" className="secondary-button compact-button">← 返回工作台</Link>
      </div>

      {examples.length === 0 ? (
        <div className="admin-empty">
          <p>样本库为空。运行以下命令将本地样本同步至数据库：</p>
          <p style={{ marginTop: 12 }}>
            <code>npm run assess:seed -- --file local-data/real-doctor-examples.md</code>
          </p>
        </div>
      ) : (
        <div className="example-full-list">
          {examples.map((ex, i) => (
            <ExampleCard key={ex.id} ex={ex} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
