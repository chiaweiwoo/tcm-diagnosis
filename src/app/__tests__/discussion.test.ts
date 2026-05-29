/**
 * Unit tests for computeDiscussion — deterministic logic and fallback reshaping.
 */
import { describe, it, expect, vi } from "vitest";
import { parseAiOutput, buildFallbackItems, needsDiscussionRecompute } from "../../lib/nudge/computeDiscussion";
import { DISCUSSION_PROMPT_VERSION } from "../../lib/nudge/discussionPrompts";

// Helper to make a dummy Supabase Client
function makeMockSupabase(dbReturn: any) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue(dbReturn),
        }),
      }),
    }),
  } as any;
}

describe("parseAiOutput", () => {
  it("correctly parses raw AI discussion items", () => {
    const rawJson = JSON.stringify([
      {
        question: "如何调和阴阳以安神？",
        caseAnchor: "失眠 3 例",
        caseGroup: "失眠×心肾不交×方药",
        reasoning: "患者多见心肾不交型失眠",
        followUp: "临床用药如何体现交通心肾？",
        n: 3,
      },
    ]);
    // The internal parseAiOutput function in computeDiscussion.ts is exposed via module loading. Let's test it.
    // parseAiOutput in computeDiscussion.ts handles arrays directly or inside `{ items: [...] }`
    const parsed = parseAiOutput(rawJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].question).toBe("如何调和阴阳以安神？");
    expect(parsed[0].caseAnchor).toBe("失眠 3 例");
    expect(parsed[0].caseGroup).toBe("失眠×心肾不交×方药");
    expect(parsed[0].reasoning).toBe("患者多见心肾不交型失眠");
    expect(parsed[0].followUp).toBe("临床用药如何体现交通心肾？");
    expect(parsed[0].n).toBe(3);
  });

  it("handles standard { items: [...] } wrapping structure", () => {
    const rawJson = JSON.stringify({
      items: [
        {
          question: "针对脾虚泄泻，如何健脾？",
          caseAnchor: "泄泻 2 例",
          caseGroup: "泄泻×脾虚湿阻×方药",
          reasoning: "泄泻常伴有湿邪困脾",
          followUp: "健脾时如何化湿？",
          n: 2,
        },
      ],
    });
    const parsed = parseAiOutput(rawJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].question).toBe("针对脾虚泄泻，如何健脾？");
    expect(parsed[0].caseAnchor).toBe("泄泻 2 例");
  });

  it("gracefully returns empty array on invalid JSON", () => {
    const parsed = parseAiOutput("invalid json string");
    expect(parsed).toHaveLength(0);
  });
});

describe("buildFallbackItems", () => {
  it("reshapes evaluation guidance points into structured discussion items", () => {
    const guidancePoints = [
      { text: "建议加强对虚实夹杂证候辨证的准确性", score: 4 },
      { text: "注意理气药在胃脘痛中的配伍剂量", score: 3 },
    ];
    const caseGroups = [
      {
        diagnosis: "胃脘痛",
        pattern: "肝胃不和",
        modality: "方药",
        n: 4,
        complaints: ["胃胀痛两胁胀满"],
      },
    ];

    const fallbacks = buildFallbackItems(guidancePoints, caseGroups);
    expect(fallbacks).toHaveLength(2);

    // First item does not match any diagnosis group, should have null anchor/group but preserve question
    expect(fallbacks[0].question).toBe("建议加强对虚实夹杂证候辨证的准确性");
    expect(fallbacks[0].caseAnchor).toBeNull();
    expect(fallbacks[0].caseGroup).toBeNull();
    expect(fallbacks[0].n).toBe(0);
    expect(fallbacks[0].reasoning).toBe("系统评估发现的可讨论临床建议");

    // Second item mentions "胃脘痛" which matches "胃脘痛" in caseGroups
    expect(fallbacks[1].question).toBe("注意理气药在胃脘痛中的配伍剂量");
    expect(fallbacks[1].caseAnchor).toBe("胃脘痛 4 例");
    expect(fallbacks[1].caseGroup).toBe("胃脘痛×肝胃不和×方药");
    expect(fallbacks[1].n).toBe(4);
  });

  it("handles null guidance points gracefully", () => {
    const fallbacks = buildFallbackItems(null, []);
    expect(fallbacks).toHaveLength(0);
  });
});

describe("needsDiscussionRecompute", () => {
  const latestDate = new Date("2026-05-29T12:00:00Z");

  it("returns true if force is true", async () => {
    const mockClient = makeMockSupabase({ data: null, error: null });
    const result = await needsDiscussionRecompute(mockClient, "doc-123", latestDate, true);
    expect(result).toBe(true);
  });

  it("returns true if no record exists in database", async () => {
    const mockClient = makeMockSupabase({ data: null, error: null });
    const result = await needsDiscussionRecompute(mockClient, "doc-123", latestDate, false);
    expect(result).toBe(true);
  });

  it("returns true if prompt version has changed", async () => {
    const mockClient = makeMockSupabase({
      data: {
        source_last_record_at: "2026-05-29T12:00:00Z",
        prompt_version: "discussion-v0-old",
      },
      error: null,
    });
    const result = await needsDiscussionRecompute(mockClient, "doc-123", latestDate, false);
    expect(result).toBe(true);
  });

  it("returns true if latest analyzed record is newer than stored watermark", async () => {
    const mockClient = makeMockSupabase({
      data: {
        source_last_record_at: "2026-05-29T11:00:00Z", // 1 hour older
        prompt_version: DISCUSSION_PROMPT_VERSION,
      },
      error: null,
    });
    const result = await needsDiscussionRecompute(mockClient, "doc-123", latestDate, false);
    expect(result).toBe(true);
  });

  it("returns false if stored watermark is equal or newer than latest analyzed record", async () => {
    const mockClient = makeMockSupabase({
      data: {
        source_last_record_at: "2026-05-29T12:00:00Z", // equal
        prompt_version: DISCUSSION_PROMPT_VERSION,
      },
      error: null,
    });
    const result = await needsDiscussionRecompute(mockClient, "doc-123", latestDate, false);
    expect(result).toBe(false);
  });
});
