import Link from "next/link";

export default function AdminUsagePage() {
  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">AI 调用监控</p>
          <h1>Token 用量</h1>
          <p className="admin-meta">已迁移至 Langfuse</p>
        </div>
        <Link href="/admin/assessments" className="secondary-button compact-button">← 评估列表</Link>
      </div>
      <section className="admin-section">
        <p style={{ color: "var(--meta-color)", marginBottom: "1rem" }}>
          调用监控已迁移至 Langfuse。Token 用量、延迟、成本请在 Langfuse 控制台查看。
        </p>
        <a
          href="https://cloud.langfuse.com"
          target="_blank"
          rel="noopener noreferrer"
          className="secondary-button"
        >
          打开 Langfuse 控制台 →
        </a>
      </section>
    </main>
  );
}
