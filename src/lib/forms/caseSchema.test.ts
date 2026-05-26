import { describe, it, expect } from "vitest";
import { structuredCaseSchema, FIELD_LIMITS } from "./caseSchema";
import { VALID_FIXTURES, MINIMAL_VALID } from "./fixtures";

// Lean test set: cover the schema invariants the API contract depends on.
// We don't test zod itself — only our rules: enums, ranges, blocked content.

const parse = (data: unknown) => structuredCaseSchema.safeParse(data);

describe("structuredCaseSchema", () => {
  it("accepts all valid fixtures and the minimal valid case", () => {
    for (const fixture of [...VALID_FIXTURES, MINIMAL_VALID]) {
      const result = parse(fixture);
      expect(result.success, `fixture ${fixture.consultationName} should pass`).toBe(true);
    }
  });

  it("accepts each valid prescriptionType string", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: "方药" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, prescriptionType: "针灸" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, prescriptionType: "推拿" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, prescriptionType: "综合调理" }).success).toBe(true);
  });

  it("rejects unknown prescription type value", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: "拔罐" }).success).toBe(false);
  });

  it("rejects array prescriptionType", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: ["方药"] }).success).toBe(false);
  });

  it("rejects unknown sex value", () => {
    expect(parse({ ...MINIMAL_VALID, patientSex: "其他" }).success).toBe(false);
  });

  it("rejects ages outside 1-120 and non-numeric input", () => {
    for (const age of ["0", "121", "三十", "-5", "30.5", ""]) {
      expect(parse({ ...MINIMAL_VALID, patientAge: age }).success, `age=${age}`).toBe(false);
    }
  });

  it("enforces chiefComplaint non-empty and max length", () => {
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "   " }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "头" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "头".repeat(FIELD_LIMITS.chiefComplaint + 1) }).success).toBe(false);
  });

  it("enforces currentIllness non-empty and max length", () => {
    expect(parse({ ...MINIMAL_VALID, currentIllness: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, currentIllness: "   " }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, currentIllness: "短" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, currentIllness: "痛".repeat(FIELD_LIMITS.currentIllness + 1) }).success).toBe(false);
  });

  it("enforces diagnosis and prescription non-empty", () => {
    expect(parse({ ...MINIMAL_VALID, diagnosis: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, prescription: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, prescription: "推拿" }).success).toBe(true);
  });

  it("requires physicalExam non-empty", () => {
    expect(parse({ ...MINIMAL_VALID, physicalExam: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, physicalExam: "   " }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, physicalExam: "舌" }).success).toBe(true);
  });

  it("requires pattern non-empty", () => {
    expect(parse({ ...MINIMAL_VALID, pattern: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, pattern: "   " }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, pattern: "虚" }).success).toBe(true);
  });

  it("defaults consultationName to empty string when omitted; rejects missing pastHistory", () => {
    // consultationName is optional — omitting it should still parse
    const { consultationName, ...withoutName } = MINIMAL_VALID;
    void consultationName;
    const nameResult = parse(withoutName);
    expect(nameResult.success).toBe(true);
    if (nameResult.success) {
      expect(nameResult.data.consultationName).toBe("");
    }

    // pastHistory is now required — omitting it must fail
    const { pastHistory, ...withoutHistory } = MINIMAL_VALID;
    void pastHistory;
    expect(parse(withoutHistory).success).toBe(false);
  });

  it("requires pastHistory non-empty", () => {
    expect(parse({ ...MINIMAL_VALID, pastHistory: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, pastHistory: "   " }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, pastHistory: "无" }).success).toBe(true);
  });

  it("blocks guaranteed-cure language and patient self-use phrases", () => {
    const blockedExamples = [
      { ...MINIMAL_VALID, prescription: "保证此方治愈所有症状天麻钩藤饮加减" },
      { ...MINIMAL_VALID, chiefComplaint: "希望治愈高血压全部症状" },
      { ...MINIMAL_VALID, currentIllness: "我是患者，近2周头痛明显，无发热无呕吐。" },
    ];
    for (const example of blockedExamples) {
      expect(parse(example).success).toBe(false);
    }
  });
});
