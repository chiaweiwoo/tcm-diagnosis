import { describe, expect, it } from "vitest";
import { parseLocalDoctorExamplesMarkdown } from "./localDoctorExamples";

describe("parseLocalDoctorExamplesMarkdown", () => {
  it("extracts example metadata and text blocks from markdown", () => {
    const markdown = `
# Real Doctor Examples

## real-example-001 | 方药分析 | PCOS / 妇科调周期

\`\`\`text
患者33岁，素食者

停经9月余。
\`\`\`

## real-example-002 | 针灸方案 | 弹响指 / 针灸优化

\`\`\`text
患者女54岁。
\`\`\`
`;

    const result = parseLocalDoctorExamplesMarkdown(markdown);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "real-example-001",
      caseTypeGuess: "方药分析",
      topicGuess: "PCOS / 妇科调周期",
      draft: "患者33岁，素食者\n\n停经9月余。",
    });
    expect(result[1]?.draft).toBe("患者女54岁。");
  });
});
