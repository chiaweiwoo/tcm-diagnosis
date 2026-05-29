/**
 * LLM-based prescription clustering for Doctor Profile Snapshot.
 * Sends anonymised case data (id + diagnosis + pattern + prescription excerpt) to
 * DeepSeek Flash and returns clinically-equivalent groups (N >= 3).
 *
 * Invariant 8: clinical text → DeepSeek (permitted). Langfuse: not wired here.
 * Fail-open: any error returns [].
 */

import { callDeepSeekJson, getDeepSeekFastModel } from "@/lib/ai/deepseek";
import { PRESC_CLUSTER_SYSTEM_PROMPT } from "./profilePrompts";

export type PrescriptionCluster = {
  caseIds: string[];
  label: string;
  n: number;
};

type CaseInput = {
  id: string;
  diagnosis: string;
  pattern: string;
  prescription: string;
};

type ClusterApiResponse = {
  clusters: Array<{
    caseIds?: unknown;
    label?: unknown;
    n?: unknown;
  }>;
};

function parseClusterResponse(raw: ClusterApiResponse): PrescriptionCluster[] {
  if (!raw?.clusters || !Array.isArray(raw.clusters)) return [];

  return raw.clusters
    .filter(
      (c) =>
        Array.isArray(c.caseIds) &&
        c.caseIds.length >= 3 &&
        typeof c.label === "string" &&
        c.label.trim().length > 0,
    )
    .map((c) => ({
      caseIds: (c.caseIds as string[]).map(String),
      label: String(c.label).trim(),
      n: typeof c.n === "number" ? c.n : (c.caseIds as unknown[]).length,
    }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
}

export async function clusterPrescriptions(
  cases: CaseInput[],
): Promise<PrescriptionCluster[]> {
  if (cases.length < 3) return [];

  const lines = cases.map(
    (c) =>
      `[${c.id}] 诊断：${c.diagnosis || "—"} | 证型：${c.pattern || "—"} | 处方：${c.prescription.slice(0, 200)}`,
  );

  const userContent = [
    `=== 处方聚合分析（共 ${cases.length} 条病案）===`,
    lines.join("\n"),
  ].join("\n");

  try {
    const result = await callDeepSeekJson<ClusterApiResponse>({
      model: getDeepSeekFastModel(),
      maxTokens: 1200,
      repairJson: true,
      retryOnEmpty: false,
      jsonMode: true,
      messages: [
        { role: "system", content: PRESC_CLUSTER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    return parseClusterResponse(result.data);
  } catch {
    return [];
  }
}
