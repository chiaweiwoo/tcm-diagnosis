import { afterEach, describe, expect, it, vi } from "vitest";
import { callDeepSeekJson, DeepSeekError, extractJsonObject } from "./deepseek";

describe("DeepSeek JSON parsing", () => {
  it("extracts JSON from fenced code", () => {
    expect(extractJsonObject('```json\n{"status":"ok"}\n```')).toBe('{"status":"ok"}');
  });

  it("extracts JSON from surrounding prose", () => {
    expect(extractJsonObject('Here:\n{"status":"ok"}\nDone')).toBe('{"status":"ok"}');
  });
});

describe("DeepSeek JSON repair fallback", () => {
  const originalEnv = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv) {
      process.env.DEEPSEEK_API_KEY = originalEnv;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("repairs malformed JSON when repairJson is enabled", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"keyPoints":["A"]' }, finish_reason: "length" }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"keyPoints":["A"]}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      } as Response);

    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeekJson<{ keyPoints: string[] }>({
      messages: [{ role: "user", content: "test" }],
      repairJson: true,
    });

    expect(result.repairedJson).toBe(true);
    expect(result.data.keyPoints).toEqual(["A"]);
    expect(result.usage?.total_tokens).toBe(40);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws directly on malformed JSON when repairJson is disabled", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"keyPoints":["A"]' }, finish_reason: "length" }],
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callDeepSeekJson<{ keyPoints: string[] }>({
        messages: [{ role: "user", content: "test" }],
        repairJson: false,
      }),
    ).rejects.toBeInstanceOf(DeepSeekError);
  });

  it("omits response_format when jsonMode is false", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { total_tokens: 3 },
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await callDeepSeekJson<{ ok: boolean }>({
      messages: [{ role: "user", content: "test" }],
      jsonMode: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.response_format).toBeUndefined();
  });

  it("includes finish reason and token diagnostics when content is empty", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: null }, finish_reason: "length" }],
        usage: { prompt_tokens: 2913, completion_tokens: 3000, total_tokens: 5913 },
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callDeepSeekJson<{ ok: boolean }>({
        messages: [{ role: "user", content: "test" }],
        maxTokens: 3000,
      }),
    ).rejects.toMatchObject({
      details: {
        finishReason: "length",
        maxTokens: 3000,
        jsonMode: true,
        usage: { total_tokens: 5913 },
      },
    });
  });
});
