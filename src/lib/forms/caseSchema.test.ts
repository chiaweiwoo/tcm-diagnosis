import { describe, it, expect } from "vitest";
import { structuredCaseSchema, PRESCRIPTION_TYPES, SEX_VALUES, FIELD_LIMITS } from "./caseSchema";
import { VALID_FIXTURES, MINIMAL_VALID } from "./fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(data: unknown) {
  return structuredCaseSchema.safeParse(data);
}

function fail(data: unknown) {
  const result = structuredCaseSchema.safeParse(data);
  expect(result.success).toBe(false);
  return result;
}

function errorPaths(data: unknown): string[] {
  const result = structuredCaseSchema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((i) => String(i.path[0] ?? "root"));
}

// ---------------------------------------------------------------------------
// All valid fixtures pass
// ---------------------------------------------------------------------------

describe("valid fixtures", () => {
  VALID_FIXTURES.forEach((fixture, idx) => {
    it(`fixture ${String(idx + 1).padStart(3, "0")} passes (${fixture.consultationName})`, () => {
      const result = pass(fixture);
      expect(result.success).toBe(true);
    });
  });

  it("minimal valid fixture passes", () => {
    const result = pass(MINIMAL_VALID);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// prescriptionType
// ---------------------------------------------------------------------------

describe("prescriptionType", () => {
  it("accepts all valid prescription types", () => {
    for (const pt of PRESCRIPTION_TYPES) {
      const result = pass({ ...MINIMAL_VALID, prescriptionType: pt });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown prescription type", () => {
    fail({ ...MINIMAL_VALID, prescriptionType: "推拿" });
  });

  it("rejects missing prescription type", () => {
    const { prescriptionType: _, ...rest } = MINIMAL_VALID;
    fail(rest);
  });
});

// ---------------------------------------------------------------------------
// patientAge
// ---------------------------------------------------------------------------

describe("patientAge", () => {
  it("accepts valid ages 1-120", () => {
    for (const age of ["1", "18", "65", "120"]) {
      const result = pass({ ...MINIMAL_VALID, patientAge: age });
      expect(result.success, `age ${age} should be valid`).toBe(true);
    }
  });

  it("rejects age 0", () => {
    fail({ ...MINIMAL_VALID, patientAge: "0" });
  });

  it("rejects age 121", () => {
    fail({ ...MINIMAL_VALID, patientAge: "121" });
  });

  it("rejects non-numeric age", () => {
    fail({ ...MINIMAL_VALID, patientAge: "三十岁" });
  });

  it("rejects decimal age", () => {
    fail({ ...MINIMAL_VALID, patientAge: "30.5" });
  });

  it("rejects empty age", () => {
    fail({ ...MINIMAL_VALID, patientAge: "" });
  });

  it("rejects negative age string", () => {
    fail({ ...MINIMAL_VALID, patientAge: "-5" });
  });
});

// ---------------------------------------------------------------------------
// patientSex
// ---------------------------------------------------------------------------

describe("patientSex", () => {
  it("accepts 男 and 女", () => {
    for (const sex of SEX_VALUES) {
      const result = pass({ ...MINIMAL_VALID, patientSex: sex });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown sex value", () => {
    fail({ ...MINIMAL_VALID, patientSex: "其他" });
  });
});

// ---------------------------------------------------------------------------
// chiefComplaint
// ---------------------------------------------------------------------------

describe("chiefComplaint", () => {
  it("rejects complaint shorter than 5 chars", () => {
    fail({ ...MINIMAL_VALID, chiefComplaint: "头痛" });
  });

  it("accepts complaint of exactly 5 chars", () => {
    const result = pass({ ...MINIMAL_VALID, chiefComplaint: "头痛眩晕失眠" });
    expect(result.success).toBe(true);
  });

  it("rejects complaint over the limit", () => {
    fail({ ...MINIMAL_VALID, chiefComplaint: "头".repeat(FIELD_LIMITS.chiefComplaint + 1) });
  });

  it("accepts complaint at the exact limit", () => {
    const result = pass({ ...MINIMAL_VALID, chiefComplaint: "头".repeat(FIELD_LIMITS.chiefComplaint) });
    expect(result.success).toBe(true);
  });

  it("rejects empty complaint", () => {
    fail({ ...MINIMAL_VALID, chiefComplaint: "" });
  });
});

// ---------------------------------------------------------------------------
// currentIllness
// ---------------------------------------------------------------------------

describe("currentIllness", () => {
  it("rejects illness shorter than 10 chars", () => {
    fail({ ...MINIMAL_VALID, currentIllness: "短" });
  });

  it("accepts illness with exactly 10 chars", () => {
    const result = pass({ ...MINIMAL_VALID, currentIllness: "头痛2周余，无其他。" });
    expect(result.success).toBe(true);
  });

  it("rejects illness over the limit", () => {
    fail({ ...MINIMAL_VALID, currentIllness: "痛".repeat(FIELD_LIMITS.currentIllness + 1) });
  });
});

// ---------------------------------------------------------------------------
// diagnosis
// ---------------------------------------------------------------------------

describe("diagnosis", () => {
  it("rejects diagnosis shorter than 2 chars", () => {
    fail({ ...MINIMAL_VALID, diagnosis: "头" });
  });

  it("accepts diagnosis of exactly 2 chars", () => {
    const result = pass({ ...MINIMAL_VALID, diagnosis: "头痛" });
    expect(result.success).toBe(true);
  });

  it("rejects empty diagnosis", () => {
    fail({ ...MINIMAL_VALID, diagnosis: "" });
  });
});

// ---------------------------------------------------------------------------
// prescription
// ---------------------------------------------------------------------------

describe("prescription", () => {
  it("rejects prescription shorter than 5 chars", () => {
    fail({ ...MINIMAL_VALID, prescription: "无" });
  });

  it("accepts prescription of exactly 5 chars", () => {
    const result = pass({ ...MINIMAL_VALID, prescription: "参术苓草枣" });
    expect(result.success).toBe(true);
  });

  it("rejects prescription over the limit", () => {
    fail({ ...MINIMAL_VALID, prescription: "药".repeat(FIELD_LIMITS.prescription + 1) });
  });
});

// ---------------------------------------------------------------------------
// optional fields default to ""
// ---------------------------------------------------------------------------

describe("optional fields", () => {
  it("consultationName defaults to empty string when omitted", () => {
    const { consultationName: _, ...rest } = MINIMAL_VALID;
    const result = pass(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.consultationName).toBe("");
  });

  it("pastHistory defaults to empty string when omitted", () => {
    const { pastHistory: _, ...rest } = MINIMAL_VALID;
    const result = pass(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pastHistory).toBe("");
  });

  it("physicalExam defaults to empty string when omitted", () => {
    const { physicalExam: _, ...rest } = MINIMAL_VALID;
    const result = pass(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.physicalExam).toBe("");
  });

  it("pattern defaults to empty string when omitted", () => {
    const { pattern: _, ...rest } = MINIMAL_VALID;
    const result = pass(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pattern).toBe("");
  });

  it("doctorQuestion defaults to empty string when omitted", () => {
    const { doctorQuestion: _, ...rest } = MINIMAL_VALID;
    const result = pass(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.doctorQuestion).toBe("");
  });
});

// ---------------------------------------------------------------------------
// blocked content guard
// ---------------------------------------------------------------------------

describe("blocked content", () => {
  it("blocks 保证 in prescription", () => {
    const paths = errorPaths({ ...MINIMAL_VALID, prescription: "保证此方治愈所有症状天麻钩藤饮加减" });
    expect(paths).toContain("doctorQuestion");
  });

  it("blocks 治愈 in chiefComplaint", () => {
    const paths = errorPaths({ ...MINIMAL_VALID, chiefComplaint: "希望治愈高血压全部症状" });
    expect(paths).toContain("doctorQuestion");
  });

  it("blocks 我是患者 in currentIllness", () => {
    const paths = errorPaths({
      ...MINIMAL_VALID,
      currentIllness: "我是患者，近2周头痛明显，无发热无呕吐。",
    });
    expect(paths).toContain("doctorQuestion");
  });

  it("does not block normal clinical content", () => {
    const result = pass(MINIMAL_VALID);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// field limit constants are sane
// ---------------------------------------------------------------------------

describe("FIELD_LIMITS sanity", () => {
  it("all limits are positive integers", () => {
    for (const [key, val] of Object.entries(FIELD_LIMITS)) {
      expect(typeof val, key).toBe("number");
      expect(val > 0, key).toBe(true);
      expect(Number.isInteger(val), key).toBe(true);
    }
  });

  it("prescription limit >= chiefComplaint limit", () => {
    expect(FIELD_LIMITS.prescription).toBeGreaterThanOrEqual(FIELD_LIMITS.chiefComplaint);
  });
});
