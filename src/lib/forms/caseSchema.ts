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

// Patterns that indicate guaranteed efficacy language or patient self-use — hard block
const BLOCKED_CONTENT_PATTERN = /保证|治愈|包好|一定好|我是患者|我自己可以吃|我该怎么办/;

function containsBlockedContent(val: string) {
  return BLOCKED_CONTENT_PATTERN.test(val);
}

export const structuredCaseSchema = z
  .object({
    consultationName: z
      .string()
      .max(FIELD_LIMITS.consultationName, `会诊名称不超过${FIELD_LIMITS.consultationName}字`)
      .optional()
      .default(""),

    prescriptionType: z
      .array(z.enum(PRESCRIPTION_TYPES))
      .min(1, "请至少选择一种处方类型。"),

    patientAge: z
      .string()
      .trim()
      .min(1, "请填写患者年龄。")
      .regex(/^\d+$/, "年龄请填写数字。")
      .refine((v) => {
        const n = parseInt(v, 10);
        return n >= 1 && n <= 120;
      }, "年龄须在1-120之间。"),

    patientSex: z.enum(SEX_VALUES, { error: "请选择患者性别。" }),

    chiefComplaint: z
      .string()
      .trim()
      .min(2, "主诉至少需要2个字。")
      .max(FIELD_LIMITS.chiefComplaint, `主诉不超过${FIELD_LIMITS.chiefComplaint}字`),

    currentIllness: z
      .string()
      .trim()
      .min(5, "现病史至少需要5个字。")
      .max(FIELD_LIMITS.currentIllness, `现病史不超过${FIELD_LIMITS.currentIllness}字`),

    pastHistory: z
      .string()
      .max(FIELD_LIMITS.pastHistory, `既往史不超过${FIELD_LIMITS.pastHistory}字`)
      .optional()
      .default(""),

    physicalExam: z
      .string()
      .trim()
      .min(2, "体格检查至少需要2个字（请填写舌诊及脉诊）。")
      .max(FIELD_LIMITS.physicalExam, `体格检查不超过${FIELD_LIMITS.physicalExam}字`),

    diagnosis: z
      .string()
      .trim()
      .min(2, "诊断至少需要2个字。")
      .max(FIELD_LIMITS.diagnosis, `诊断不超过${FIELD_LIMITS.diagnosis}字`),

    pattern: z
      .string()
      .trim()
      .min(2, "请填写证型（至少2个字）。")
      .max(FIELD_LIMITS.pattern, `证型不超过${FIELD_LIMITS.pattern}字`),

    prescription: z
      .string()
      .trim()
      .min(3, "处方至少需要3个字。")
      .max(FIELD_LIMITS.prescription, `处方不超过${FIELD_LIMITS.prescription}字`),

    doctorQuestion: z
      .string()
      .max(FIELD_LIMITS.doctorQuestion, `医生问题不超过${FIELD_LIMITS.doctorQuestion}字`)
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
        message: "内容包含保证疗效或非医师使用的表述，不符合本工具的临床边界。",
      });
    }
  });

export type StructuredCaseForm = z.infer<typeof structuredCaseSchema>;
