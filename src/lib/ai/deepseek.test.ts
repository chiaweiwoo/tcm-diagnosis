import { describe, expect, it } from "vitest";
import { estimateDeepSeekCost } from "./deepseek";

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
