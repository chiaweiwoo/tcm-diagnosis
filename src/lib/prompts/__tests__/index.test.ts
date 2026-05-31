import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrompt, getTcmAnalysisPrompt, resolvePromptVersion, PROMPT_REGISTRY } from "../index";

describe("Prompt Registry Resolution", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    // Reset env and argv before each test
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  it("resolves default latest prompt version", () => {
    const version = resolvePromptVersion("tcm-analysis");
    expect(version).toBe(PROMPT_REGISTRY["tcm-analysis"].latest);

    const { version: fullVersion, prompt } = getPrompt("tcm-analysis");
    expect(fullVersion).toBe(`tcm-analysis-${PROMPT_REGISTRY["tcm-analysis"].latest}`);
    expect(prompt).toContain("医生端中医临床复核助手");
  });

  it("resolves manual code override with highest priority", () => {
    // Set both env and CLI to mock overrides, but manual parameter should win
    process.env.TCM_ANALYSIS_PROMPT_VERSION = "v1.6";
    process.argv.push("--tcm-analysis-version", "v1.6");

    const version = resolvePromptVersion("tcm-analysis", "v1.5");
    expect(version).toBe("v1.5");

    const { version: fullVersion, prompt } = getPrompt("tcm-analysis", "v1.5");
    expect(fullVersion).toBe("tcm-analysis-v1.5");
    expect(prompt).toContain("医生端中医临床复核助手");
  });

  it("resolves CLI argument override if manual override is absent", () => {
    // Set env, but CLI argument should win over env
    process.env.TCM_ANALYSIS_PROMPT_VERSION = "v1.6";
    process.argv = [...originalArgv, "--tcm-analysis-version", "v1.5"];

    const version = resolvePromptVersion("tcm-analysis");
    expect(version).toBe("v1.5");

    const { version: fullVersion } = getPrompt("tcm-analysis");
    expect(fullVersion).toBe("tcm-analysis-v1.5");
  });

  it("resolves CLI argument override with equals sign", () => {
    process.argv = [...originalArgv, "--tcm-analysis-version=v1.5"];

    const version = resolvePromptVersion("tcm-analysis");
    expect(version).toBe("v1.5");
  });

  it("resolves environment variable override if manual and CLI overrides are absent", () => {
    process.env.TCM_ANALYSIS_PROMPT_VERSION = "v1.5";

    const version = resolvePromptVersion("tcm-analysis");
    expect(version).toBe("v1.5");

    const { version: fullVersion } = getPrompt("tcm-analysis");
    expect(fullVersion).toBe("tcm-analysis-v1.5");
  });

  it("falls back safely to latest if an invalid version is requested", () => {
    const version = resolvePromptVersion("tcm-analysis", "v99.9");
    expect(version).toBe(PROMPT_REGISTRY["tcm-analysis"].latest);

    const { version: fullVersion } = getPrompt("tcm-analysis", "v99.9");
    expect(fullVersion).toBe(`tcm-analysis-${PROMPT_REGISTRY["tcm-analysis"].latest}`);
  });

  it("getTcmAnalysisPrompt returns a callable buildUserPrompt", () => {
    const { version, prompt, buildUserPrompt } = getTcmAnalysisPrompt();
    expect(version).toBe(`tcm-analysis-${PROMPT_REGISTRY["tcm-analysis"].latest}`);
    expect(prompt).toContain("医生端中医临床复核助手");
    expect(typeof buildUserPrompt).toBe("function");

    const userPrompt = buildUserPrompt({
      consultationName: "",
      prescriptionType: "方药",
      patientAge: "45",
      patientSex: "女",
      chiefComplaint: "头痛",
      currentIllness: "头痛三天",
      pastHistory: "无",
      physicalExam: "舌红苔薄，脉弦",
      diagnosis: "头痛",
      pattern: "肝阳上亢",
      prescription: "天麻钩藤饮",
    });
    expect(userPrompt).toContain("头痛");
  });
});
