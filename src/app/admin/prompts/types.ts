import type { PromptHistoryEntry } from "@/lib/prompts/history";

export type FamilyView = {
  family: string;
  activeVersion: string;
  source: string;
  envVarName: string;
  callers: string[];
  versions: PromptHistoryEntry[];
  isActive: boolean;
};
