import { readFile } from "node:fs/promises";

export type LocalDoctorExample = {
  id: string;
  caseTypeGuess: string;
  topicGuess: string;
  draft: string;
};

const EXAMPLE_HEADING = /^##\s+(real-example-\d+)\s+\|\s+([^|]+?)\s+\|\s+(.+)$/gm;

export function parseLocalDoctorExamplesMarkdown(markdown: string): LocalDoctorExample[] {
  const matches = Array.from(markdown.matchAll(EXAMPLE_HEADING));

  return matches.map((match, index) => {
    const headingEnd = match.index! + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index! : markdown.length;
    const body = markdown.slice(headingEnd, nextStart);
    const fenced = body.match(/```text\s*([\s\S]*?)```/);
    const draft = fenced?.[1]?.trim() ?? "";

    return {
      id: match[1]?.trim() ?? `real-example-${String(index + 1).padStart(3, "0")}`,
      caseTypeGuess: match[2]?.trim() ?? "",
      topicGuess: match[3]?.trim() ?? "",
      draft,
    };
  });
}

export async function loadLocalDoctorExamples(filePath: string) {
  const markdown = await readFile(filePath, "utf8");
  return parseLocalDoctorExamplesMarkdown(markdown);
}
