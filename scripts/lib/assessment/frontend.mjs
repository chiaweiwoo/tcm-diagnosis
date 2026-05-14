import fs from "node:fs/promises";
import path from "node:path";
import { runBrowserScenarios } from "./browser.mjs";
import { reviewFrontendUX, reviewFrontendTCM, reviewFrontendVisual } from "./frontendReviewers.mjs";
import { buildHtmlReport } from "./htmlReport.mjs";

function pickRandomExamples(examples, count) {
  const eligible = examples.filter((e) => e.draft && e.draft.trim().length > 100);
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

async function cleanupRecords(baseUrl, scenarios) {
  const recordIds = scenarios
    .map((s) => s.recordId)
    .filter(Boolean);

  const cleaned = [];
  const failed = [];

  for (const id of recordIds) {
    try {
      const res = await fetch(`${baseUrl}/api/consultations/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        cleaned.push(id);
      } else {
        failed.push({ id, status: res.status });
      }
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { attempted: recordIds.length, succeeded: cleaned.length, failed };
}

function buildAggregate(scenarios) {
  const total = scenarios.length;
  const success = scenarios.filter((s) => s.status === "success").length;
  const blocked = scenarios.filter((s) => s.blockedState).length;
  const failed = scenarios.filter((s) => s.status === "failed").length;
  const allWarnings = scenarios.flatMap((s) => s.warnings ?? []);

  return { total, success, blocked, failed, warnings: allWarnings };
}

function buildMarkdownReport({ runId, generatedAt, baseUrl, scenarios, aggregate, reviewers, cleanup, selectedExamples }) {
  const lines = [];

  lines.push(`# 前端评估报告`);
  lines.push(`\n运行 ID：\`${runId}\`  \n生成时间：${generatedAt}  \n服务地址：${baseUrl}`);
  lines.push(`\n## 执行摘要`);
  lines.push(`- 场景总数：${aggregate.total}`);
  lines.push(`- 成功：${aggregate.success} ｜ 阻断：${aggregate.blocked} ｜ 失败：${aggregate.failed}`);
  if (aggregate.warnings.length > 0) {
    lines.push(`- 警告：${aggregate.warnings.length} 条`);
    aggregate.warnings.forEach((w) => lines.push(`  - ${w}`));
  }

  lines.push(`\n## 场景结果`);
  lines.push(`| 场景 | 状态 | 耗时 | 阻断 | 可见板块数 |`);
  lines.push(`|------|------|------|------|-----------|`);
  for (const s of scenarios) {
    const elapsed = s.elapsedMs ? `${(s.elapsedMs / 1000).toFixed(1)}s` : "—";
    const sections = s.sectionsVisible?.length ?? "—";
    const blocked = s.blockedState ? "是" : "否";
    lines.push(`| ${s.name} | ${s.status} | ${elapsed} | ${blocked} | ${sections} |`);
  }

  lines.push(`\n## UX 流程评审（产品分析师视角）`);
  lines.push(`> 模型：${reviewers.ux.model}`);
  lines.push(`\n${reviewers.ux.text}`);

  lines.push(`\n## 临床输出评审（资深中医师视角）`);
  lines.push(`> 模型：${reviewers.tcm.model}`);
  lines.push(`\n${reviewers.tcm.text}`);

  lines.push(`\n## 视觉评审（截图分析）`);
  if (reviewers.visual.skipped) {
    lines.push(`_（无截图可用，已跳过）_`);
  } else {
    lines.push(`> 模型：${reviewers.visual.model}`);
    lines.push(`\n${reviewers.visual.text}`);
  }

  lines.push(`\n## 测试记录清理`);
  lines.push(`- 尝试删除：${cleanup.attempted} 条`);
  lines.push(`- 成功：${cleanup.succeeded} 条`);
  if (cleanup.failed.length > 0) {
    lines.push(`- 失败：${cleanup.failed.map((f) => f.id).join(", ")}`);
    lines.push(`  请手动从数据库或管理界面删除上述记录。`);
  }

  return lines.join("\n");
}

export async function runFrontendAssessment({ baseUrl, examples, screenshotDir, runId, exampleCount = 3 }) {
  const generatedAt = new Date().toISOString();
  const selectedExamples = pickRandomExamples(examples, exampleCount);

  if (selectedExamples.length === 0) {
    throw new Error("No eligible examples found (need drafts > 100 chars). Check local-data/real-doctor-examples.md");
  }

  console.error(`[frontend] Running ${selectedExamples.length} Scenario A examples + Scenario B + Scenario C`);
  console.error(`[frontend] Selected: ${selectedExamples.map((e) => e.id).join(", ")}`);

  // Run browser automation
  const { scenarios, screenshots } = await runBrowserScenarios({
    baseUrl,
    examples: selectedExamples,
    screenshotDir,
    runId,
  });

  // Cleanup assessment records
  const cleanup = await cleanupRecords(baseUrl, scenarios);

  const aggregate = buildAggregate(scenarios);

  // Collect key screenshots for visual review (one from each scenario type)
  const keyScreenshots = [
    ...scenarios.flatMap((s) => s.screenshots ?? []).slice(0, 6),
  ];

  console.error("[frontend] Running reviewers...");

  const observations = { runId, generatedAt, baseUrl, scenarios };

  const [uxReview, tcmReview, visualReview] = await Promise.allSettled([
    reviewFrontendUX(observations),
    reviewFrontendTCM(observations),
    reviewFrontendVisual(keyScreenshots),
  ]);

  const reviewers = {
    ux: uxReview.status === "fulfilled" ? uxReview.value : { model: "error", text: `UX review failed: ${uxReview.reason}`, usage: null },
    tcm: tcmReview.status === "fulfilled" ? tcmReview.value : { model: "error", text: `TCM review failed: ${tcmReview.reason}`, usage: null },
    visual: visualReview.status === "fulfilled" ? visualReview.value : { model: "error", text: `Visual review failed: ${visualReview.reason}`, usage: null, skipped: false },
  };

  const reportData = {
    runId,
    generatedAt,
    baseUrl,
    selectedExamples: selectedExamples.map((e) => ({ id: e.id, caseTypeGuess: e.caseTypeGuess })),
    scenarios,
    aggregate,
    reviewers,
    cleanup,
    screenshots,
  };

  const htmlReport = await buildHtmlReport(reportData);

  const markdownReport = buildMarkdownReport({
    runId,
    generatedAt,
    baseUrl,
    scenarios,
    aggregate,
    reviewers,
    cleanup,
    selectedExamples,
  });

  return { reportData, markdownReport, htmlReport };
}
