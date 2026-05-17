import { afterEach, describe, expect, it, vi } from "vitest";
import { callDeepSeekJson, DeepSeekError, extractJsonObject } from "./deepseek";

describe("DeepSeek JSON解析", () => {
  it("可解析被代码块包住的JSON", () => {
    expect(extractJsonObject('```json\n{"状态":"成功"}\n```')).toBe('{"状态":"成功"}');
  });

  it("可从前后说明文字中提取JSON", () => {
    expect(extractJsonObject('好的：\n{"状态":"成功"}\n请查收')).toBe('{"状态":"成功"}');
  });
});

describe("DeepSeek JSON修复回退", () => {
  const originalEnv = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv) {
      process.env.DEEPSEEK_API_KEY = originalEnv;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("malformed JSON可通过repairJson回退修复", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"重点结论":["A"]' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"重点结论":["A"]}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      } as Response);

    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeekJson<{ 重点结论: string[] }>({
      messages: [{ role: "user", content: "test" }],
      repairJson: true,
    });

    expect(result.repairedJson).toBe(true);
    expect(result.data.重点结论).toEqual(["A"]);
    expect(result.usage?.total_tokens).toBe(40);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("repairJson关闭时，malformed JSON直接报错", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"重点结论":["A"]' } }],
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callDeepSeekJson<{ 重点结论: string[] }>({
        messages: [{ role: "user", content: "test" }],
        repairJson: false,
      }),
    ).rejects.toBeInstanceOf(DeepSeekError);
  });
});
