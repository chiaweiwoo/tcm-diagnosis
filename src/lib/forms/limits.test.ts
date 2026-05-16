import { describe, it, expect } from "vitest";
import { getFieldLimit, getRemainingChars, isAtLimit, charCountLabel } from "./limits";
import { FIELD_LIMITS } from "./caseSchema";

describe("getFieldLimit", () => {
  it("returns the correct limit for chiefComplaint", () => {
    expect(getFieldLimit("chiefComplaint")).toBe(FIELD_LIMITS.chiefComplaint);
  });

  it("returns the correct limit for prescription", () => {
    expect(getFieldLimit("prescription")).toBe(FIELD_LIMITS.prescription);
  });
});

describe("getRemainingChars", () => {
  it("returns full limit when value is empty", () => {
    expect(getRemainingChars("chiefComplaint", "")).toBe(FIELD_LIMITS.chiefComplaint);
  });

  it("returns remaining chars correctly", () => {
    const used = "头痛眩晕";
    expect(getRemainingChars("chiefComplaint", used)).toBe(FIELD_LIMITS.chiefComplaint - used.length);
  });

  it("clamps to 0 when over limit", () => {
    const over = "头".repeat(FIELD_LIMITS.chiefComplaint + 50);
    expect(getRemainingChars("chiefComplaint", over)).toBe(0);
  });
});

describe("isAtLimit", () => {
  it("returns false when under limit", () => {
    expect(isAtLimit("diagnosis", "头痛")).toBe(false);
  });

  it("returns true when exactly at limit", () => {
    const exact = "头".repeat(FIELD_LIMITS.diagnosis);
    expect(isAtLimit("diagnosis", exact)).toBe(true);
  });

  it("returns true when over limit", () => {
    const over = "头".repeat(FIELD_LIMITS.diagnosis + 1);
    expect(isAtLimit("diagnosis", over)).toBe(true);
  });
});

describe("charCountLabel", () => {
  it("formats label correctly", () => {
    expect(charCountLabel("chiefComplaint", "头痛眩晕")).toBe(`4 / ${FIELD_LIMITS.chiefComplaint}`);
  });

  it("shows 0 for empty value", () => {
    expect(charCountLabel("diagnosis", "")).toBe(`0 / ${FIELD_LIMITS.diagnosis}`);
  });
});
