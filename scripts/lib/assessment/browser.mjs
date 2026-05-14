import path from "node:path";
import { chromium } from "playwright";

const ORGANIZE_TIMEOUT = 90_000;
const ANALYZE_TIMEOUT = 150_000;
const NAV_TIMEOUT = 30_000;

// Draft that will always be hard-blocked (no current plan, no timeline, vague intent)
const BLOCKED_DRAFT = `患者：45岁男性
主诉：腰痛
帮我看看。`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeScreenshot(page, screenshotDir, name) {
  try {
    const filePath = path.join(screenshotDir, name);
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } catch {
    return null;
  }
}

async function extractObservations(page) {
  return page.evaluate(() => {
    const sectionsVisible = [];
    const sectionText = {};

    document.querySelectorAll(".result-group").forEach((el) => {
      const titleEl = el.querySelector(".section-title");
      const title = titleEl?.textContent?.trim() ?? "";
      if (title) {
        sectionsVisible.push(title);
        const fullText = el.innerText?.trim() ?? "";
        sectionText[title] = fullText.slice(0, 400);
      }
    });

    const elapsedEl = Array.from(document.querySelectorAll("*")).find(
      (el) => el.childNodes.length === 1 && el.textContent?.includes("已用时"),
    );

    const blockedBoxes = document.querySelectorAll(".blocked-box");
    const blockedText = Array.from(blockedBoxes)
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" | ");

    const modelLabel = document.querySelector(".model-label")?.textContent?.trim() ?? null;
    const devBadge = document.querySelector(".dev-bypass-badge")?.textContent?.trim() ?? null;
    const stageTitle = document.querySelector(".status-card h4")?.textContent?.trim() ?? null;

    return {
      sectionsVisible,
      sectionText,
      elapsedText: elapsedEl?.textContent?.trim() ?? null,
      blockedState: blockedBoxes.length > 0 && blockedText.length > 0,
      blockedReason: blockedText || null,
      modelLabel,
      devBadge,
      stageTitle,
    };
  });
}

async function waitForOrganizeOrBlock(page) {
  await Promise.race([
    page.waitForSelector(".organize-preview-panel", { timeout: ORGANIZE_TIMEOUT }),
    page.waitForSelector(".blocked-box", { timeout: ORGANIZE_TIMEOUT }),
  ]);
}

async function waitForAnalyzeComplete(page) {
  // Wait for the loading shell to be gone and real content to appear
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(".loading-review-panel");
      if (loading) return false;
      const keyPoints = document.querySelector("#key-points, .result-group.key-conclusion");
      if (!keyPoints) return false;
      return (keyPoints.textContent?.trim().length ?? 0) > 20;
    },
    { timeout: ANALYZE_TIMEOUT },
  );
}

// ── Scenario A: clean new draft success flow ─────────────────────────────────

export async function runScenarioA(page, screenshotDir, example, runId) {
  const scenarioName = `A-${example.id}`;
  const consultationName = `ASSESSMENT-FRONTEND-${scenarioName}-${runId}`;
  const screenshots = [];
  const startedAt = Date.now();
  let recordId = null;

  // Intercept consultation creation to capture the record ID
  page.on("response", async (resp) => {
    if (resp.url().includes("/api/consultations") && resp.request().method() === "POST") {
      try {
        const body = await resp.json();
        if (body?.record?.id) recordId = body.record.id;
      } catch {
        // ignore
      }
    }
  });

  try {
    // Step 1: empty workbench
    const shot = await safeScreenshot(page, screenshotDir, `${scenarioName}-01-empty.png`);
    if (shot) screenshots.push(shot);

    // Step 2: fill consultation name
    const nameInput = page.locator('input[placeholder*="代号"]').first();
    await nameInput.fill(consultationName);

    // Step 3: fill draft
    const draftArea = page.locator("textarea").first();
    await draftArea.fill(example.draft);
    const shot2 = await safeScreenshot(page, screenshotDir, `${scenarioName}-02-draft.png`);
    if (shot2) screenshots.push(shot2);

    // Step 4: submit
    await page.click(".primary-button");
    await sleep(1500);
    const shot3 = await safeScreenshot(page, screenshotDir, `${scenarioName}-03-organizing.png`);
    if (shot3) screenshots.push(shot3);

    // Step 5: wait for organize complete or blocked
    await waitForOrganizeOrBlock(page);
    const obs1 = await extractObservations(page);
    const shot4 = await safeScreenshot(page, screenshotDir, `${scenarioName}-04-organized.png`);
    if (shot4) screenshots.push(shot4);

    if (obs1.blockedState) {
      return {
        name: scenarioName,
        status: "blocked-unexpected",
        exampleId: example.id,
        elapsedMs: Date.now() - startedAt,
        recordId,
        organizeStarted: true,
        analyzeStarted: false,
        blockedState: true,
        blockedReason: obs1.blockedReason,
        sectionsVisible: [],
        sectionText: {},
        elapsedText: null,
        modelLabel: obs1.modelLabel,
        screenshots,
        warnings: ["Scenario A expected success but was blocked"],
      };
    }

    // Step 6: wait for analyze loading shell
    await page.waitForSelector(".loading-review-panel", { timeout: 30_000 }).catch(() => null);
    const shot5 = await safeScreenshot(page, screenshotDir, `${scenarioName}-05-analyzing.png`);
    if (shot5) screenshots.push(shot5);

    // Step 7: wait for analyze complete
    await waitForAnalyzeComplete(page);
    const obs2 = await extractObservations(page);
    const shot6 = await safeScreenshot(page, screenshotDir, `${scenarioName}-06-result.png`);
    if (shot6) screenshots.push(shot6);

    return {
      name: scenarioName,
      status: "success",
      exampleId: example.id,
      elapsedMs: Date.now() - startedAt,
      recordId,
      organizeStarted: true,
      analyzeStarted: true,
      blockedState: false,
      blockedReason: null,
      sectionsVisible: obs2.sectionsVisible,
      sectionText: obs2.sectionText,
      elapsedText: obs2.elapsedText,
      modelLabel: obs2.modelLabel,
      devBadge: obs2.devBadge,
      stageTitle: obs2.stageTitle,
      screenshots,
      warnings: [],
    };
  } catch (err) {
    const shot = await safeScreenshot(page, screenshotDir, `${scenarioName}-error.png`);
    if (shot) screenshots.push(shot);
    return {
      name: scenarioName,
      status: "failed",
      exampleId: example.id,
      elapsedMs: Date.now() - startedAt,
      recordId,
      organizeStarted: false,
      analyzeStarted: false,
      blockedState: false,
      blockedReason: null,
      sectionsVisible: [],
      sectionText: {},
      elapsedText: null,
      modelLabel: null,
      screenshots,
      warnings: [`Scenario failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// ── Scenario B: stage-one blocked flow ───────────────────────────────────────

export async function runScenarioB(page, screenshotDir, runId) {
  const scenarioName = "B-blocked";
  const consultationName = `ASSESSMENT-FRONTEND-${scenarioName}-${runId}`;
  const screenshots = [];
  const startedAt = Date.now();
  let recordId = null;

  page.on("response", async (resp) => {
    if (resp.url().includes("/api/consultations") && resp.request().method() === "POST") {
      try {
        const body = await resp.json();
        if (body?.record?.id) recordId = body.record.id;
      } catch {
        // ignore
      }
    }
  });

  try {
    const shot1 = await safeScreenshot(page, screenshotDir, `${scenarioName}-01-empty.png`);
    if (shot1) screenshots.push(shot1);

    const nameInput = page.locator('input[placeholder*="代号"]').first();
    await nameInput.fill(consultationName);

    const draftArea = page.locator("textarea").first();
    await draftArea.fill(BLOCKED_DRAFT);
    const shot2 = await safeScreenshot(page, screenshotDir, `${scenarioName}-02-draft.png`);
    if (shot2) screenshots.push(shot2);

    await page.click(".primary-button");
    await sleep(1500);

    await waitForOrganizeOrBlock(page);
    const obs = await extractObservations(page);

    const shot3 = await safeScreenshot(page, screenshotDir, `${scenarioName}-03-outcome.png`);
    if (shot3) screenshots.push(shot3);

    return {
      name: scenarioName,
      status: obs.blockedState ? "success" : "blocked-not-triggered",
      elapsedMs: Date.now() - startedAt,
      recordId,
      organizeStarted: true,
      analyzeStarted: false,
      blockedState: obs.blockedState,
      blockedReason: obs.blockedReason,
      sectionsVisible: obs.sectionsVisible,
      sectionText: {},
      elapsedText: obs.elapsedText,
      modelLabel: obs.modelLabel,
      screenshots,
      warnings: obs.blockedState ? [] : ["Expected block did not fire"],
    };
  } catch (err) {
    const shot = await safeScreenshot(page, screenshotDir, `${scenarioName}-error.png`);
    if (shot) screenshots.push(shot);
    return {
      name: scenarioName,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      recordId,
      organizeStarted: false,
      analyzeStarted: false,
      blockedState: false,
      blockedReason: null,
      sectionsVisible: [],
      sectionText: {},
      elapsedText: null,
      modelLabel: null,
      screenshots,
      warnings: [`Scenario B failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// ── Scenario C: history reload flow ──────────────────────────────────────────

export async function runScenarioC(page, screenshotDir, savedRecordId, expectedSections, runId) {
  const scenarioName = "C-reload";
  const screenshots = [];
  const startedAt = Date.now();

  try {
    // Fresh navigation triggers history load
    await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await sleep(1000);

    const shot1 = await safeScreenshot(page, screenshotDir, `${scenarioName}-01-history.png`);
    if (shot1) screenshots.push(shot1);

    if (!savedRecordId) {
      return {
        name: scenarioName,
        status: "skipped",
        reason: "No saved record from Scenario A to reload",
        screenshots,
        warnings: [],
      };
    }

    // Select the saved record from the history dropdown
    const select = page.locator("select").first();
    await select.selectOption(savedRecordId).catch(() => null);
    await sleep(2000);

    const obs = await extractObservations(page);
    const shot2 = await safeScreenshot(page, screenshotDir, `${scenarioName}-02-reloaded.png`);
    if (shot2) screenshots.push(shot2);

    const missingAfterReload = expectedSections.filter(
      (s) => !obs.sectionsVisible.includes(s),
    );

    return {
      name: scenarioName,
      status: "success",
      elapsedMs: Date.now() - startedAt,
      reloadedRecordId: savedRecordId,
      sectionsVisible: obs.sectionsVisible,
      sectionText: obs.sectionText,
      expectedSections,
      missingSectionsAfterReload: missingAfterReload,
      stageTitle: obs.stageTitle,
      screenshots,
      warnings: missingAfterReload.length > 0
        ? [`Section drift after reload: missing ${missingAfterReload.join(", ")}`]
        : [],
    };
  } catch (err) {
    const shot = await safeScreenshot(page, screenshotDir, `${scenarioName}-error.png`);
    if (shot) screenshots.push(shot);
    return {
      name: scenarioName,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      screenshots,
      warnings: [`Scenario C failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// ── Main browser runner ───────────────────────────────────────────────────────

export async function runBrowserScenarios({ baseUrl, examples, screenshotDir, runId }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
  });

  const scenarios = [];
  let firstSuccessfulRecordId = null;
  let firstSuccessfulSections = [];
  let allScreenshots = [];

  try {
    // Check dev bypass is active
    const checkPage = await context.newPage();
    await checkPage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    const isWorkbench = await checkPage.locator(".hero-panel, .app-shell").count();
    if (isWorkbench === 0) {
      throw new Error(
        "Dev bypass is not active on this server. Set DEV_AUTH_BYPASS=true and DEV_AUTH_EMAIL in .env.local and restart the dev server.",
      );
    }
    await checkPage.close();

    // Run Scenario A for each chosen example
    for (const example of examples) {
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await sleep(500);

      const result = await runScenarioA(page, screenshotDir, example, runId);
      scenarios.push(result);
      allScreenshots.push(...result.screenshots.filter(Boolean));

      if (result.status === "success" && !firstSuccessfulRecordId && result.recordId) {
        firstSuccessfulRecordId = result.recordId;
        firstSuccessfulSections = result.sectionsVisible;
      }

      await page.close();
    }

    // Run Scenario B (blocked flow)
    const pageB = await context.newPage();
    await pageB.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await sleep(500);
    const scenarioB = await runScenarioB(pageB, screenshotDir, runId);
    scenarios.push(scenarioB);
    allScreenshots.push(...scenarioB.screenshots.filter(Boolean));
    await pageB.close();

    // Run Scenario C (history reload) using first successful A result
    const pageC = await context.newPage();
    await pageC.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await sleep(1000);
    const scenarioC = await runScenarioC(
      pageC,
      screenshotDir,
      firstSuccessfulRecordId,
      firstSuccessfulSections,
      runId,
    );
    scenarios.push(scenarioC);
    allScreenshots.push(...scenarioC.screenshots.filter(Boolean));
    await pageC.close();
  } finally {
    await browser.close();
  }

  return { scenarios, screenshots: allScreenshots };
}
