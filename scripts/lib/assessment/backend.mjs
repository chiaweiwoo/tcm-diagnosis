import fs from "node:fs/promises";
import path from "node:path";
import { postJson } from "./http.mjs";
import { reviewBackendAssessment } from "./reviewers.mjs";

const REVIEW_MODES = ["smart", "normal"];

function trimList(items, limit = 3) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function summarizeAnalysis(result) {
  if (!result) return null;

  return {
    title: result.title ?? "",
    keyPoints: trimList(result.keyPoints, 4),
    groups:
      Array.isArray(result.groups)
        ? result.groups.map((group) => ({
            title: group.title,
            sections:
              Array.isArray(group.sections)
                ? group.sections.map((section) => ({
                    title: section.title,
                  }))
                : [],
          }))
        : [],
    cautions: trimList(result.cautions, 4),
    evidence: trimList(result.evidence, 4),
  };
}

function buildAggregateSummary(results) {
  const modeStats = {
    smart: { count: 0, success: 0, blocked: 0, averageLatencyMs: 0, averageCostUsd: 0 },
    normal: { count: 0, success: 0, blocked: 0, averageLatencyMs: 0, averageCostUsd: 0 },
  };

  for (const item of results.examples) {
    for (const mode of REVIEW_MODES) {
      const run = item.modes[mode];
      if (!run) continue;
      modeStats[mode].count += 1;
      if (run.status === "success") modeStats[mode].success += 1;
      if (run.status === "blocked") modeStats[mode].blocked += 1;
      modeStats[mode].averageLatencyMs += run.latencyMs ?? 0;
      modeStats[mode].averageCostUsd += run.costUsd ?? 0;
    }
  }

  for (const mode of REVIEW_MODES) {
    if (modeStats[mode].count > 0) {
      modeStats[mode].averageLatencyMs = Math.round(modeStats[mode].averageLatencyMs / modeStats[mode].count);
      modeStats[mode].averageCostUsd = Number((modeStats[mode].averageCostUsd / modeStats[mode].count).toFixed(6));
    }
  }

  return {
    runId: results.runId,
    generatedAt: results.generatedAt,
    exampleCount: results.examples.length,
    modeStats,
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
      modes: Object.fromEntries(
        REVIEW_MODES.map((mode) => [
          mode,
          item.modes[mode]
            ? {
                status: item.modes[mode].status,
                latencyMs: item.modes[mode].latencyMs,
                model: item.modes[mode].model,
                costUsd: item.modes[mode].costUsd,
                error: item.modes[mode].error,
                blockedReasons: trimList(item.modes[mode].blockedReasons, 3),
                result: summarizeAnalysis(item.modes[mode].result),
              }
            : null,
        ]),
      ),
    })),
  };
}

function renderBackendMarkdown(results, aggregate, reviewer) {
  const lines = [];
  lines.push("# Backend Assessment Report", "");
  lines.push(`- Run ID: \`${results.runId}\``);
  lines.push(`- Generated at: ${results.generatedAt}`);
  lines.push(`- Base URL: ${results.baseUrl}`);
  lines.push(`- Example count: ${results.examples.length}`, "");

  lines.push("## Mode Comparison", "");
  for (const mode of REVIEW_MODES) {
    const stats = aggregate.modeStats[mode];
    lines.push(`### ${mode === "smart" ? "智能" : "常规"}`);
    lines.push(`- Runs: ${stats.count}`);
    lines.push(`- Success: ${stats.success}`);
    lines.push(`- Blocked: ${stats.blocked}`);
    lines.push(`- Avg latency: ${stats.averageLatencyMs} ms`);
    lines.push(`- Avg cost: US$${stats.averageCostUsd}`, "");
  }

  lines.push("## Example Outcomes", "");
  for (const item of results.examples) {
    lines.push(`### ${item.id} · ${item.topicGuess}`);
    lines.push(`- Case type guess: ${item.caseTypeGuess}`);
    lines.push(`- Draft preview: ${item.draftPreview}`);
    lines.push(`- Organize: ${item.organize.status} (${item.organize.latencyMs} ms)`);
    if (item.organize.formSummary.length) {
      lines.push(`- Organized fields: ${item.organize.formSummary.join(" / ")}`);
    }
    for (const mode of REVIEW_MODES) {
      const run = item.modes[mode];
      if (!run) continue;
      lines.push(
        `- ${mode === "smart" ? "智能" : "常规"}: ${run.status} · ${run.latencyMs} ms · ${run.model ?? "n/a"} · US$${run.costUsd ?? 0}`,
      );
      if (run.error) {
        lines.push(`  - Error: ${run.error}`);
      }
      if (run.blockedReasons?.length) {
        for (const reason of run.blockedReasons) {
          lines.push(`  - Blocked: ${reason}`);
        }
      }
      if (run.result?.keyPoints?.length) {
        for (const point of run.result.keyPoints.slice(0, 3)) {
          lines.push(`  - Key point: ${point}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("## DeepSeek Review", "");
  lines.push(reviewer.text, "");

  return lines.join("\n");
}

export async function runBackendAssessment({
  baseUrl,
  examples,
  output,
  runId,
}) {
  const generatedAt = new Date().toISOString();
  const results = {
    runId,
    generatedAt,
    baseUrl,
    examples: [],
  };

  for (const example of examples) {
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

      for (const mode of REVIEW_MODES) {
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
          error: analyze.ok ? null : analyze.payload?.error ?? "Unknown error",
          blockedReasons: analyze.payload?.details?.blockedReasons ?? [],
          result: analyze.ok ? analyze.payload.result : null,
          validation: analyze.payload?.validation ?? analyze.payload?.details ?? null,
        };
      }
    }

    results.examples.push(item);
  }

  const aggregate = buildAggregateSummary(results);
  await fs.writeFile(path.join(output.outputDir, "backend-results.json"), JSON.stringify(results, null, 2));

  const reviewer = await reviewBackendAssessment(aggregate);
  const markdown = renderBackendMarkdown(results, aggregate, reviewer);
  const jsonReport = {
    ...results,
    aggregate,
    reviewer,
  };

  await fs.writeFile(path.join(output.outputDir, "backend-report.json"), JSON.stringify(jsonReport, null, 2));
  await fs.writeFile(path.join(output.outputDir, "backend-report.md"), markdown, "utf8");

  return {
    results,
    aggregate,
    reviewer,
    markdown,
  };
}
