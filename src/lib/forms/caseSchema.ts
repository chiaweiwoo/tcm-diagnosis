import { z } from "zod";

export const PRESCRIPTION_TYPES = ["方药", "针灸", "综合调理"] as const;
export type PrescriptionType = (typeof PRESCRIPTION_TYPES)[number];

export const SEX_VALUES = ["男", "女"] as const;
export type SexValue = (typeof SEX_VALUES)[number];

export const FIELD_LIMITS = {
  consultationName: 60,
  chiefComplaint: 200,
  currentIllness: 2000,
  pastHistory: 1000,
  physicalExam: 1000,
  diagnosis: 100,
  pattern: 100,
  prescription: 2000,
  doctorQuestion: 500,
} as const;

const MSG = {
  REQUIRED: "此项必填 Required",
  TOO_SHORT: "描述不完整 Insufficient detail",
  BLOCKED: "内容不符合临床边界 Policy violation",
};

// Patterns that indicate guaranteed efficacy language or patient self-use — hard block
const BLOCKED_CONTENT_PATTERN = /保证|治愈|包好|一定好|我是患者|我自己可以吃|我该怎么办/;

function containsBlockedContent(val: string) {
  return BLOCKED_CONTENT_PATTERN.test(val);
}

export const structuredCaseSchema = z
  .object({
    consultationName: z
      .string()
      .max(FIELD_LIMITS.consultationName, `不超过${FIELD_LIMITS.consultationName}字`)
      .optional()
      .default(""),

    prescriptionType: z
      .array(z.enum(PRESCRIPTION_TYPES))
      .min(1, MSG.REQUIRED),

    patientAge: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .regex(/^\d+$/, "请填写数字 Number only")
      .refine((v) => {
        const n = parseInt(v, 10);
        return n >= 1 && n <= 120;
      }, "范围 1-120 range"),

    patientSex: z.enum(SEX_VALUES, { error: MSG.REQUIRED }),

    chiefComplaint: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .min(2, MSG.TOO_SHORT)
      .max(FIELD_LIMITS.chiefComplaint, `不超过${FIELD_LIMITS.chiefComplaint}字`),

    currentIllness: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .min(5, MSG.TOO_SHORT)
      .max(FIELD_LIMITS.currentIllness, `不超过${FIELD_LIMITS.currentIllness}字`),

    pastHistory: z
      .string()
      .max(FIELD_LIMITS.pastHistory, `不超过${FIELD_LIMITS.pastHistory}字`)
      .optional()
      .default(""),

    physicalExam: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .min(2, MSG.TOO_SHORT)
      .max(FIELD_LIMITS.physicalExam, `不超过${FIELD_LIMITS.physicalExam}字`),

    diagnosis: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .min(2, MSG.TOO_SHORT)
      .max(FIELD_LIMITS.diagnosis, `不超过${FIELD_LIMITS.diagnosis}字`),

    pattern: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .min(2, MSG.TOO_SHORT)
      .max(FIELD_LIMITS.pattern, `不超过${FIELD_LIMITS.pattern}字`),

    prescription: z
      .string()
      .trim()
      .min(1, MSG.REQUIRED)
      .min(3, MSG.TOO_SHORT)
      .max(FIELD_LIMITS.prescription, `不超过${FIELD_LIMITS.prescription}字`),

    doctorQuestion: z
      .string()
      .max(FIELD_LIMITS.doctorQuestion, `不超过${FIELD_LIMITS.doctorQuestion}字`)
      .optional()
      .default(""),
  })
  .superRefine((val, ctx) => {
    // Block guaranteed efficacy or patient self-use language across key fields
    const combinedText = [
      val.chiefComplaint,
      val.currentIllness,
      val.diagnosis,
      val.prescription,
      val.doctorQuestion ?? "",
    ].join(" ");

    if (containsBlockedContent(combinedText)) {
      ctx.addIssue({
        code: "custom",
        path: ["doctorQuestion"],
        message: MSG.BLOCKED,
      });
    }
  });

export type StructuredCaseForm = z.infer<typeof structuredCaseSchema>;
