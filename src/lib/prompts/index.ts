import * as tcmAnalysisV1_5 from "./registry/tcm-analysis/v1.5";
import * as tcmAnalysisV1_6 from "./registry/tcm-analysis/v1.6";
import * as riskNudgeV1_1 from "./registry/risk-nudge/v1.1";
import * as prescClusterV1_0 from "./registry/presc-cluster/v1.0";
import * as doctorEvalV1_5 from "./registry/doctor-eval/v1.5";
import * as outputAuditV3_0 from "./registry/output-audit/v3.0";

export const PROMPT_REGISTRY = {
  "tcm-analysis": {
    latest: "v1.6",
    versions: {
      "v1.5": tcmAnalysisV1_5,
      "v1.6": tcmAnalysisV1_6,
    }
  },
  "risk-nudge": {
    latest: "v1.1",
    versions: {
      "v1.1": riskNudgeV1_1,
    }
  },
  "presc-cluster": {
    latest: "v1.0",
    versions: {
      "v1.0": prescClusterV1_0,
    }
  },
  "doctor-eval": {
    latest: "v1.5",
    versions: {
      "v1.5": doctorEvalV1_5,
    }
  },
  "output-audit": {
    latest: "v3.0",
    versions: {
      "v3.0": outputAuditV3_0,
    }
  }
} as const;

export type PromptKey = keyof typeof PROMPT_REGISTRY;

/**
 * Command Line Argument Parser to extract prompt-specific version overrides.
 * Handled styles:
 *   --tcm-analysis-version=v1.5
 *   --tcm-analysis-version v1.5
 */
export function getCliOverrides(): Record<string, string> {
  if (typeof process === "undefined" || !process.argv) {
    return {};
  }

  const overrides: Record<string, string> = {};
  const argv = process.argv;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const cleanArg = arg.slice(2);
      if (cleanArg.includes("=")) {
        const [flag, val] = cleanArg.split("=");
        if (flag.endsWith("-version")) {
          const key = flag.substring(0, flag.length - 8); // remove "-version"
          if (val) overrides[key] = val;
        }
      } else {
        if (cleanArg.endsWith("-version")) {
          const key = cleanArg.substring(0, cleanArg.length - 8);
          const nextVal = argv[i + 1];
          if (nextVal && !nextVal.startsWith("-")) {
            overrides[key] = nextVal;
          }
        }
      }
    }
  }

  return overrides;
}

/**
 * Resolves the active version key based on the priority:
 * 1. Code override
 * 2. CLI override flag (--<key>-version)
 * 3. Environment Variable (<KEY>_PROMPT_VERSION)
 * 4. Fallback to latest
 */
export function resolvePromptVersion(key: PromptKey, manualOverride?: string): string {
  const group = PROMPT_REGISTRY[key];

  // 1. Explicit manual override
  if (manualOverride && manualOverride in group.versions) {
    return manualOverride;
  }

  // 2. CLI argument overrides
  const cliOverrides = getCliOverrides();
  if (cliOverrides[key] && cliOverrides[key] in group.versions) {
    return cliOverrides[key];
  }

  // 3. Environment variable configuration
  const envVarName = `${key.toUpperCase().replace("-", "_")}_PROMPT_VERSION`;
  const envValue = process.env[envVarName];
  if (envValue && envValue in group.versions) {
    return envValue;
  }

  // 4. Pointer default
  return group.latest;
}

/**
 * Retrieves the fully resolved system prompt text and version identifier.
 */
export function getPrompt(key: PromptKey, manualOverride?: string) {
  const versionKey = resolvePromptVersion(key, manualOverride);
  const group = PROMPT_REGISTRY[key];
  const moduleData = (group.versions as any)[versionKey];

  let promptText = "";
  if (typeof moduleData.prompt === "string") {
    promptText = moduleData.prompt;
  } else if (typeof moduleData.buildPrompt === "function") {
    promptText = moduleData.buildPrompt();
  }

  return {
    version: `${key}-${versionKey}`,
    prompt: promptText,
    // Provide user prompt builder access if it exists in the active module
    buildUserPrompt: moduleData.buildTcmAnalysisUserPrompt as typeof tcmAnalysisV1_6.buildTcmAnalysisUserPrompt | undefined,
  };
}
