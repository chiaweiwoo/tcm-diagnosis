import { PROMPT_REGISTRY, listPromptFamilies, getPromptMeta } from "@/lib/prompts";
import { getPromptHistory } from "@/lib/prompts/history";
import { PromptRegistryList } from "./PromptRegistryList";
import type { FamilyView } from "./types";

const CALLERS: Record<string, string[]> = {
  "tcm-analysis":  ["POST /api/analyze", "scripts/analyze_batch_historical.mjs"],
  "risk-nudge":    ["POST /api/cron/dr_nudge", "npm run dr_nudge"],
  "presc-cluster": ["GET /api/admin/users/[doctorId]/profile"],
  "output-audit":  ["POST /api/admin/analytics/output-audit", "POST /api/cron/output-audit"],
};

export default function PromptsPage() {
  const { generatedAt, entries } = getPromptHistory();
  const families = listPromptFamilies();
  const activeFamilyKeys = new Set(Object.keys(PROMPT_REGISTRY));

  // Group entries by family, attaching structured meta when available
  const byFamily = new Map<string, import("./types").VersionView[]>();
  for (const entry of entries) {
    const meta = getPromptMeta(entry.family, entry.version);
    const list = byFamily.get(entry.family) ?? [];
    list.push({ ...entry, meta });
    byFamily.set(entry.family, list);
  }

  // Build view models: active families first, archived after
  const activeFamilyDescriptors = families.filter((f) => activeFamilyKeys.has(f.key));
  const allFamilyNames = [...byFamily.keys()];
  const archivedFamilyNames = allFamilyNames.filter((f) => !activeFamilyKeys.has(f));

  const familyViews: FamilyView[] = [
    ...activeFamilyDescriptors.map((desc) => ({
      family: desc.key,
      activeVersion: desc.activeVersion,
      source: desc.source,
      envVarName: desc.envVarName,
      callers: CALLERS[desc.key] ?? [],
      versions: byFamily.get(desc.key) ?? [],
      isActive: true,
    })),
    ...archivedFamilyNames.map((name) => ({
      family: name,
      activeVersion: "",
      source: "archived",
      envVarName: "",
      callers: [],
      versions: byFamily.get(name) ?? [],
      isActive: false,
    })),
  ];

  const generatedDate = new Date(generatedAt).toLocaleString("zh-CN", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="admin-page">
      <div className="admin-header">
        <div>
          <h1>提示词注册表</h1>
          <p className="admin-meta">
            基于 Git 历史的提示词版本浏览器 · 构建时生成 · 仅管理员可见
          </p>
        </div>
        <div className="prompt-manifest-meta">
          清单生成时间：{generatedDate} (SGT)
        </div>
      </div>

      <PromptRegistryList families={familyViews} />
    </main>
  );
}
