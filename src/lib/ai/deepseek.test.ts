import { describe, expect, it } from "vitest";
import { estimateDeepSeekCost, extractJsonObject } from "./deepseek";

describe("DeepSeek费用估算", () => {
  it("根据输入和输出tokens估算美元成本", () => {
    expect(
      estimateDeepSeekCost({
        prompt_tokens: 3500,
        completion_tokens: 1800,
      }),
    ).toBe(0.003089);
  });

  it("缺少usage时返回0", () => {
    expect(estimateDeepSeekCost()).toBe(0);
  });
});

describe("DeepSeek JSON解析", () => {
  it("可解析被代码块包住的JSON", () => {
    expect(extractJsonObject('```json\n{"状态":"成功"}\n```')).toBe('{"状态":"成功"}');
  });

  it("可从前后说明文字中提取JSON", () => {
    expect(extractJsonObject('好的：\n{"状态":"成功"}\n请查收')).toBe('{"状态":"成功"}');
  });
});
