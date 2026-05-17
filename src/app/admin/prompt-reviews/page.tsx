import { getServiceRoleClient } from "@/lib/supabase/server";
import { SessionReviewList } from "./SessionReviewList";
import type { SessionReviewRow } from "@/lib/analytics/sessionReview";

async function loadReviews(): Promise<SessionReviewRow[]> {
  const admin = getServiceRoleClient();
  const { data } = await admin
    .from("analytics_session_reviews")
    .select("id,created_at,window_start,window_end,prior_review_id,prompt_version_at_run,sample_size,model,review")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as SessionReviewRow[];
}

export default async function PromptReviewsPage() {
  const reviews = await loadReviews();

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <h1>提示词评估</h1>
          <p className="admin-meta">
            按需运行 · 对全体医生近 14 天 AI 输出进行系统审查 · 仅管理员可见
          </p>
        </div>
      </div>

      <SessionReviewList initialReviews={reviews} />
    </main>
  );
}
