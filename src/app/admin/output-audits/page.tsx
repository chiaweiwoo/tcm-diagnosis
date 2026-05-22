import { getServiceRoleClient } from "@/lib/supabase/server";
import { OutputAuditList } from "./OutputAuditList";
import type { OutputAuditRow } from "@/lib/analytics/outputAudit";

async function loadAudits(): Promise<OutputAuditRow[]> {
  const admin = getServiceRoleClient();
  const { data } = await admin
    .from("analytics_output_audits")
    .select("id,created_at,window_start,window_end,prior_review_id,prompt_version_at_run,sample_size,model,review")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as OutputAuditRow[];
}

export default async function OutputAuditsPage() {
  const audits = await loadAudits();

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <h1>AI 输出审查</h1>
          <p className="admin-meta">
            通过 GitHub Actions 触发 · 对全体医生近 14 天 AI 输出进行系统审查 · 仅管理员可见
          </p>
        </div>
      </div>

      <OutputAuditList initialAudits={audits} />
    </main>
  );
}
