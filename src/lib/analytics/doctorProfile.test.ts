import { describe, expect, it } from "vitest";
import {
  computeMean,
  computeZeroRate,
  computePercentile,
  isCautionsFallbackOnly,
} from "./doctorProfile";

describe("computeMean", () => {
  it("returns 0 for empty array", () => {
    expect(computeMean([])).toBe(0);
  });

  it("computes mean rounded to 1 decimal", () => {
    expect(computeMean([1, 2, 3])).toBe(2);
    expect(computeMean([1, 1, 2])).toBe(1.3);
    expect(computeMean([0, 0, 0, 3])).toBe(0.8);
  });
});

describe("computeZeroRate", () => {
  it("returns 0 for empty array", () => {
    expect(computeZeroRate([])).toBe(0);
  });

  it("counts fraction of zeros", () => {
    expect(computeZeroRate([0, 0, 1, 1])).toBe(0.5);
    expect(computeZeroRate([1, 2, 3])).toBe(0);
    expect(computeZeroRate([0, 0, 0])).toBe(1);
  });

  it("rounds to 3 decimal places", () => {
    // 1/3 ≈ 0.333
    expect(computeZeroRate([0, 1, 1])).toBe(0.333);
  });
});

describe("computePercentile", () => {
  it("returns 0 for empty array", () => {
    expect(computePercentile([], 50)).toBe(0);
  });

  it("returns min at p=0 and max at p=100", () => {
    expect(computePercentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(computePercentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it("returns median at p=50 for odd-length array", () => {
    expect(computePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("interpolates for fractional positions", () => {
    // [1,2,3,4] — p=25 → idx=0.75 → 1 + (2-1)*0.75 = 1.75
    expect(computePercentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75);
  });

  it("sorts input before computing", () => {
    expect(computePercentile([5, 1, 3, 2, 4], 100)).toBe(5);
    expect(computePercentile([5, 1, 3, 2, 4], 0)).toBe(1);
  });
});

describe("isCautionsFallbackOnly", () => {
  const FALLBACK = "请结合面诊与必要检查复核后执行。";

  it("detects single fallback string", () => {
    expect(isCautionsFallbackOnly([FALLBACK])).toBe(true);
  });

  it("returns false when real cautions are present", () => {
    expect(isCautionsFallbackOnly(["活血药需结合出血风险复核"])).toBe(false);
    expect(isCautionsFallbackOnly([FALLBACK, "额外提醒"])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(isCautionsFallbackOnly([])).toBe(false);
  });
});
