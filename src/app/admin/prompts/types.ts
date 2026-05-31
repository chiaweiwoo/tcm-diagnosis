import type { PromptHistoryEntry } from "@/lib/prompts/history";
import type { PromptMeta } from "@/lib/prompts";

export type FamilyView = {
  family: string;
  activeVersion: string;
  source: string;
  envVarName: string;
  callers: string[];
  versions: VersionView[];
  isActive: boolean;
};

export type VersionView = PromptHistoryEntry & {
  meta: PromptMeta | null;
};
