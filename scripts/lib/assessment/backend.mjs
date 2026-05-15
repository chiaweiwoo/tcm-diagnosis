import { postJson } from "./http.mjs";

function trimList(items, limit = 3) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function summarizeAnalysis(result) {
  if (!result) return null;
  return {
    title: result.title ?? "",
    keyPoints: trimList(result.keyPoints, 4),
    summary: result.summary ?? "",
    groups: Array.isArray(result.groups)
      ? result.groups.map((g) => ({
          title: g.title,
          sections: Array.isArray(g.sections)
            ? g.sections.map((s) => ({ title: s.title, items: trimList(s.items, 3) }))
            : [],
        }))
      : [],
    cautions: trimList(result.cautions, 4),
    evidence: trimList(result.evidence, 4),
  };
}

function buildAggregateSummary(results, mode) {
  const stat = { count: 0, success: 0, blocked: 0, failed: 0, repairTriggered: 0, averageLatencyMs: 0, averageCostUsd: 0 };
  const blockedReasonGroups = {};

  for (const item of results.examples) {
    const run = item.modes[mode];
    if (!run) continue;
    stat.count += 1;
    if (run.status === "success") stat.success += 1;
    if (run.status === "blocked") {
      stat.blocked += 1;
      for (const reason of (run.blockedReasons ?? [])) {
        blockedReasonGroups[reason] = (blockedReasonGroups[reason] ?? 0) + 1;
      }
    }
    if (run.status === "failed") stat.failed += 1;
    if (run.repairedJson) stat.repairTriggered += 1;
    stat.averageLatencyMs += run.latencyMs ?? 0;
    stat.averageCostUsd += run.costUsd ?? 0;
  }

  const organizeStats = {
    success: results.examples.filter((e) => e.organize.status === "success").length,
    failed: results.examples.filter((e) => e.organize.status === "failed").length,
    total: results.examples.length,
  };

  if (stat.count > 0) {
    stat.averageLatencyMs = Math.round(stat.averageLatencyMs / stat.count);
    stat.averageCostUsd = Number((stat.averageCostUsd / stat.count).toFixed(6));
  }

  return {
    runId: results.runId,
    generatedAt: results.generatedAt,
    exampleCount: results.examples.length,
    mode,
    organizeStats,
    modeStats: { [mode]: stat },
    blockedReasonGroups,
    examples: results.examples.map((item) => ({
      id: item.id,
      caseTypeGuess: item.caseTypeGuess,
      topicGuess: item.topicGuess,
      draftPreview: item.draftPreview,
      organize: {
        status: item.organize.status,
        latencyMs: item.organize.latencyMs,
        formSummary: item.organize.formSummary,
        notes: trimList(item.organize.notes, 4),
        suggestions: trimList(item.organize.suggestions, 4),
      },
      modes: {
        [mode]: item.modes[mode]
          ? {
              status: item.modes[mode].status,
              latencyMs: item.modes[mode].latencyMs,
              model: item.modes[mode].model,
              costUsd: item.modes[mode].costUsd,
              repairedJson: item.modes[mode].repairedJson,
              error: item.modes[mode].error,
              blockedReasons: trimList(item.modes[mode].blockedReasons, 3),
              result: summarizeAnalysis(item.modes[mode].result),
            }
          : null,
      },
    })),
  };
}

export async function runBackendAssessment({ baseUrl, examples, runId, mode }) {
  const generatedAt = new Date().toISOString();
  const results = { runId, generatedAt, baseUrl, examples: [] };

  async function runExample(example) {
    const organize = await postJson(`${baseUrl}/api/organize`, { draft: example.draft });
    const item = {
      id: example.id,
      caseTypeGuess: example.caseTypeGuess,
      topicGuess: example.topicGuess,
      draftPreview: example.draft.replace(/\s+/g, " ").slice(0, 160),
      organize: {
        status: organize.ok ? "success" : "failed",
        latencyMs: organize.latencyMs,
        notes: organize.payload.notes ?? [],
        suggestions: organize.payload.suggestions ?? [],
        formSummary: [],
        response: organize.payload,
      },
      modes: {},
    };

    if (organize.ok) {
      const form = organize.payload.form ?? {};
      item.organize.formSummary = [
        form.caseType ? `病案类型:${form.caseType}` : "",
        form.chiefComplaint ? "主诉" : "",
        form.currentPlan ? "当前方案" : "",
        form.doctorQuestion ? "医生问题" : "",
        form.tonguePulse ? "舌脉与四诊" : "",
      ].filter(Boolean);

      const analyze = await postJson(`${baseUrl}/api/analyze`, { form, mode });
      item.modes[mode] = {
        status: analyze.ok
          ? "success"
          : analyze.payload?.code === "VALIDATION_BLOCKED"
            ? "blocked"
            : "failed",
        latencyMs: analyze.latencyMs,
        model: analyze.payload?.model ?? null,
        costUsd: analyze.payload?.costUsd ?? 0,
        repairedJson: analyze.payload?.repairedJson ?? false,
        error: analyze.ok ? null : analyze.payload?.error ?? "Unknown error",
        blockedReasons: analyze.payload?.details?.blockedReasons ?? [],
        result: analyze.ok ? analyze.payload.result : null,
        validation: analyze.payload?.validation ?? analyze.payload?.details ?? null,
      };
    }

    return item;
  }

  // All examples run in parallel — independent of each other
  results.examples = await Promise.all(examples.map(runExample));
  const aggregate = buildAggregateSummary(results, mode);
  return { results, aggregate };
}
