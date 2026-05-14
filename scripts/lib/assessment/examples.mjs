import fs from "node:fs/promises";

const EXAMPLE_HEADING = /^##\s+(real-example-\d+)\s+\|\s+([^|]+?)\s+\|\s+(.+)$/gm;

export async function loadAssessmentExamples(filePath) {
  const markdown = await fs.readFile(filePath, "utf8");
  const matches = Array.from(markdown.matchAll(EXAMPLE_HEADING));

  return matches.map((match, index) => {
    const headingEnd = match.index + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    const body = markdown.slice(headingEnd, nextStart);
    const fenced = body.match(/```text\s*([\s\S]*?)```/);

    return {
      id: match[1].trim(),
      caseTypeGuess: match[2].trim(),
      topicGuess: match[3].trim(),
      draft: fenced?.[1]?.trim() ?? "",
    };
  });
}
