import { describe, it, expect } from "vitest";
import { stratifyAndSample } from "./sampling";

describe("stratifyAndSample", () => {
  it("should preserve all items if total count is under cap", () => {
    const rows = [
      {
        form_data: { chiefComplaint: "月经不调", diagnosis: "痛经" }, // 妇科调理
        analysis_result: null,
        analyzed_at: "2026-05-20T10:00:00.000Z",
      },
      {
        form_data: { chiefComplaint: "咳嗽", diagnosis: "感冒" }, // 呼吸咳嗽
        analysis_result: null,
        analyzed_at: "2026-05-21T10:00:00.000Z",
      },
    ];

    const result = stratifyAndSample(rows, 10);
    expect(result).toHaveLength(2);
    // Should be sorted chronologically (ascending)
    expect(result[0].analyzed_at).toBe("2026-05-20T10:00:00.000Z");
    expect(result[1].analyzed_at).toBe("2026-05-21T10:00:00.000Z");
  });

  it("should cap at the specified limit using stratified round-robin", () => {
    // Generate a set of rows
    // 5 妇科调理 (月经)
    // 3 呼吸咳嗽 (咳嗽)
    // 2 皮肤问题 (湿疹)
    const rows: Array<{
      form_data: Record<string, unknown>;
      analysis_result: null;
      analyzed_at: string;
    }> = [];

    // Add 妇科调理
    for (let i = 0; i < 5; i++) {
      rows.push({
        form_data: { chiefComplaint: `月经不调${i}`, diagnosis: "妇科" },
        analysis_result: null,
        analyzed_at: `2026-05-10T10:00:0${i}.000Z`,
      });
    }
    // Add 呼吸咳嗽
    for (let i = 0; i < 3; i++) {
      rows.push({
        form_data: { chiefComplaint: `咳嗽${i}`, diagnosis: "感冒" },
        analysis_result: null,
        analyzed_at: `2026-05-11T10:00:0${i}.000Z`,
      });
    }
    // Add 皮肤问题
    for (let i = 0; i < 2; i++) {
      rows.push({
        form_data: { chiefComplaint: `湿疹${i}`, diagnosis: "皮肤" },
        analysis_result: null,
        analyzed_at: `2026-05-12T10:00:0${i}.000Z`,
      });
    }

    // Set cap to 5.
    // Buckets sorted newest first inside.
    // Round robin will pick from 呼吸咳嗽, 妇科调理, 皮肤问题 (sorted alphabetically: 呼吸咳嗽, 妇科调理, 皮肤问题)
    // Round 1:
    //   - 呼吸咳嗽: 1 item (newest one)
    //   - 妇科调理: 1 item (newest one)
    //   - 皮肤问题: 1 item (newest one)
    //   Subtotal = 3 items.
    // Round 2:
    //   - 呼吸咳嗽: 1 item (second newest)
    //   - 妇科调理: 1 item (second newest)
    //   Subtotal = 5 items (cap hit!)
    const result = stratifyAndSample(rows, 5);
    expect(result).toHaveLength(5);

    // Verify chronological sorting (ascending)
    for (let i = 0; i < result.length - 1; i++) {
      const t1 = new Date(result[i].analyzed_at).getTime();
      const t2 = new Date(result[i + 1].analyzed_at).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    }
  });
});
