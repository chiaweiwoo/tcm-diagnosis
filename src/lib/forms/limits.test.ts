import { describe, it, expect } from "vitest";
import { getFieldLimit, getRemainingChars, isAtLimit, charCountLabel } from "./limits";
import { FIELD_LIMITS } from "./caseSchema";

describe("limits utilities", () => {
  it("getFieldLimit returns the correct ceiling from FIELD_LIMITS", () => {
    expect(getFieldLimit("chiefComplaint")).toBe(FIELD_LIMITS.chiefComplaint);
    expect(getFieldLimit("prescription")).toBe(FIELD_LIMITS.prescription);
  });

  it("getRemainingChars counts down from limit and clamps at 0", () => {
    expect(getRemainingChars("chiefComplaint", "")).toBe(FIELD_LIMITS.chiefComplaint);
    expect(getRemainingChars("chiefComplaint", "头痛眩晕")).toBe(FIELD_LIMITS.chiefComplaint - 4);
    expect(getRemainingChars("chiefComplaint", "头".repeat(FIELD_LIMITS.chiefComplaint + 50))).toBe(0);
  });

  it("isAtLimit returns true when value length >= limit", () => {
    expect(isAtLimit("diagnosis", "头痛")).toBe(false);
    expect(isAtLimit("diagnosis", "头".repeat(FIELD_LIMITS.diagnosis))).toBe(true);
    expect(isAtLimit("diagnosis", "头".repeat(FIELD_LIMITS.diagnosis + 1))).toBe(true);
  });

  it("charCountLabel formats as 'used / limit'", () => {
    expect(charCountLabel("chiefComplaint", "头痛眩晕")).toBe(`4 / ${FIELD_LIMITS.chiefComplaint}`);
    expect(charCountLabel("diagnosis", "")).toBe(`0 / ${FIELD_LIMITS.diagnosis}`);
  });
});
