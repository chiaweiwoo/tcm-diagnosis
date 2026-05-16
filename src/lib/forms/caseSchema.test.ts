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

  it("accepts single and multi-value prescriptionType arrays", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: ["方药"] }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, prescriptionType: ["针灸", "综合调理"] }).success).toBe(true);
  });

  it("rejects empty prescriptionType array", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: [] }).success).toBe(false);
  });

  it("rejects unknown prescription type value in array", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: ["推拿"] }).success).toBe(false);
  });

  it("rejects non-array prescriptionType", () => {
    expect(parse({ ...MINIMAL_VALID, prescriptionType: "方药" }).success).toBe(false);
  });

  it("rejects unknown sex value", () => {
    expect(parse({ ...MINIMAL_VALID, patientSex: "其他" }).success).toBe(false);
  });

  it("rejects ages outside 1-120 and non-numeric input", () => {
    for (const age of ["0", "121", "三十", "-5", "30.5", ""]) {
      expect(parse({ ...MINIMAL_VALID, patientAge: age }).success, `age=${age}`).toBe(false);
    }
  });

  it("enforces chiefComplaint min (2) and max length", () => {
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "头" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "头痛" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, chiefComplaint: "头".repeat(FIELD_LIMITS.chiefComplaint + 1) }).success).toBe(false);
  });

  it("enforces currentIllness min (5) and max length", () => {
    expect(parse({ ...MINIMAL_VALID, currentIllness: "短" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, currentIllness: "头痛3日余。" }).success).toBe(true);
    expect(parse({ ...MINIMAL_VALID, currentIllness: "痛".repeat(FIELD_LIMITS.currentIllness + 1) }).success).toBe(false);
  });

  it("enforces diagnosis min (2) and prescription min (3)", () => {
    expect(parse({ ...MINIMAL_VALID, diagnosis: "头" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, prescription: "无" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, prescription: "百会穴" }).success).toBe(true);
  });

  it("requires physicalExam (min 2 chars)", () => {
    expect(parse({ ...MINIMAL_VALID, physicalExam: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, physicalExam: "舌" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, physicalExam: "舌淡红" }).success).toBe(true);
  });

  it("requires pattern (min 2 chars)", () => {
    expect(parse({ ...MINIMAL_VALID, pattern: "" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, pattern: "虚" }).success).toBe(false);
    expect(parse({ ...MINIMAL_VALID, pattern: "气虚" }).success).toBe(true);
  });

  it("defaults optional fields to empty string when omitted", () => {
    const { consultationName, pastHistory, doctorQuestion, ...required } = MINIMAL_VALID;
    void consultationName; void pastHistory; void doctorQuestion;
    const result = parse(required);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.consultationName).toBe("");
      expect(result.data.pastHistory).toBe("");
      expect(result.data.doctorQuestion).toBe("");
    }
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
