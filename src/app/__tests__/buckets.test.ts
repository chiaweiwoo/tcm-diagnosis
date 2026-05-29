/**
 * Unit tests for bucketCautions — deterministic, no network.
 * These are the source of truth for the nudge floor.
 */
import { describe, it, expect } from "vitest";
import { bucketCautions, RECURRENCE_FLOOR } from "../../lib/nudge/buckets";

// Helper: generate N copies of a string
function repeat(s: string, n: number): string[] {
  return Array.from({ length: n }, () => s);
}

describe("bucketCautions", () => {
  it("returns empty surfaced when all cautions are below floor", () => {
    const cautions = [
      "建议转诊排除器质性病变",
      "注意针刺深度",
    ];
    const result = bucketCautions(cautions);
    expect(result.surfaced).toHaveLength(0);
    expect(result.total).toBe(2);
  });

  it("surfaces a bucket when count >= RECURRENCE_FLOOR", () => {
    const cautions = repeat("建议转诊进一步检查", RECURRENCE_FLOOR);
    const result = bucketCautions(cautions);
    expect(result.surfaced.length).toBeGreaterThan(0);
    expect(result.surfaced[0].key).toBe("转诊 / 排除器质病变");
    expect(result.surfaced[0].count).toBe(RECURRENCE_FLOOR);
  });

  it("uses first-match-wins — each caution assigned to at most one bucket", () => {
    // A caution matching both 转诊 and 影像 should only count once
    const cautions = repeat("建议影像检查排除器质病变转诊专科", RECURRENCE_FLOOR);
    const result = bucketCautions(cautions);
    const totalMapped = result.surfaced.reduce((sum, b) => sum + b.count, 0);
    expect(totalMapped).toBeLessThanOrEqual(result.covered);
  });

  it("collects at most 5 examples per bucket", () => {
    const cautions = repeat("建议转诊排除器质性病变", 10);
    const result = bucketCautions(cautions);
    const bucket = result.surfaced.find((b) => b.key === "转诊 / 排除器质病变");
    expect(bucket).toBeDefined();
    expect(bucket!.examples.length).toBeLessThanOrEqual(5);
  });

  it("sorts surfaced buckets by count descending", () => {
    const cautions = [
      ...repeat("建议转诊排除器质性病变", 5),
      ...repeat("注意针刺进针深度避免气胸", 3),
    ];
    const result = bucketCautions(cautions);
    expect(result.surfaced.length).toBeGreaterThanOrEqual(2);
    expect(result.surfaced[0].count).toBeGreaterThanOrEqual(result.surfaced[1].count);
  });

  it("strips boilerplate and empty strings in caller code (buckets work on clean input)", () => {
    // Raw strings without boilerplate — verify 慢病监测 bucket
    const cautions = repeat("请定期监测血压血糖甲状腺功能", RECURRENCE_FLOOR);
    const result = bucketCautions(cautions);
    const bucket = result.surfaced.find((b) => b.key === "慢病监测");
    expect(bucket).toBeDefined();
    expect(bucket!.count).toBe(RECURRENCE_FLOOR);
  });

  it("multiple buckets surfaced correctly", () => {
    const cautions = [
      ...repeat("活血药慎用防止出血", RECURRENCE_FLOOR),
      ...repeat("针刺深度注意血管神经", RECURRENCE_FLOOR),
      ...repeat("推拿手法力度适中", RECURRENCE_FLOOR),
    ];
    const result = bucketCautions(cautions);
    expect(result.surfaced.length).toBe(3);
  });
});

import { parseAiOutput, mergeWithAi } from "../../lib/nudge/computeNudge";

describe("parseAiOutput and mergeWithAi", () => {
  it("parseAiOutput correctly parses description field from AI JSON array", () => {
    const rawJson = JSON.stringify([
      {
        key: "影像排除",
        description: "临床排除器质性病变",
        examples: ["原话1", "原话2"],
      },
    ]);
    const parsed = parseAiOutput(rawJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe("影像排除");
    expect(parsed[0].description).toBe("临床排除器质性病变");
    expect(parsed[0].examples).toEqual(["原话1", "原话2"]);
  });

  it("parseAiOutput handles unwrapping from themes property", () => {
    const rawJson = JSON.stringify({
      themes: [
        {
          key: "手法推拿",
          description: "手法力度适中防损伤",
          examples: ["推拿暴力"],
        },
      ],
    });
    const parsed = parseAiOutput(rawJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe("手法推拿");
    expect(parsed[0].description).toBe("手法力度适中防损伤");
    expect(parsed[0].examples).toEqual(["推拿暴力"]);
  });

  it("mergeWithAi blends surfaced buckets with AI output and fallback descriptions", () => {
    const surfaced = [
      { key: "转诊 / 排除器质病变", count: 4, examples: ["原话A"] },
      { key: "慢病监测", count: 3, examples: ["原话B"] },
    ];
    const aiItems = [
      { key: "转诊及影像", description: "转诊排除器质性病变", examples: ["原话A"] },
      // Second item missing to test fallback
    ];

    const merged = mergeWithAi(surfaced, aiItems);
    expect(merged).toHaveLength(2);
    expect(merged[0].key).toBe("转诊及影像");
    expect(merged[0].description).toBe("转诊排除器质性病变");

    // Second fallback tests
    expect(merged[1].key).toBe("慢病监测");
    expect(merged[1].description).toBe("高血压、糖尿病等慢性病调理期间，需嘱咐患者定期监测生理指标");
  });
});
