import "server-only";
import historyJson from "./_history.generated.json";

export type PromptHistoryEntry = {
  path: string;
  family: string;
  version: string;
  contents: string;
  currentlyInTree: boolean;
  firstCommit: { sha: string; isoDate: string; author: string; message: string; body: string };
  lastCommit: { sha: string; isoDate: string; author: string; message: string; body: string };
  commitCount: number;
};

export type PromptHistoryManifest = {
  generatedAt: string;
  entries: PromptHistoryEntry[];
};

export function getPromptHistory(): PromptHistoryManifest {
  return historyJson as PromptHistoryManifest;
}
