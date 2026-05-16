import { FIELD_LIMITS } from "./caseSchema";

export type FieldKey = keyof typeof FIELD_LIMITS;

/** Returns the max character limit for a field, or undefined if not constrained. */
export function getFieldLimit(field: FieldKey): number {
  return FIELD_LIMITS[field];
}

/** Returns remaining characters for a field value, clamped to 0. */
export function getRemainingChars(field: FieldKey, value: string): number {
  return Math.max(0, FIELD_LIMITS[field] - value.length);
}

/** Returns true when the value is at or over the field limit. */
export function isAtLimit(field: FieldKey, value: string): boolean {
  return value.length >= FIELD_LIMITS[field];
}

/** Returns a formatted label like "120 / 200" for display. */
export function charCountLabel(field: FieldKey, value: string): string {
  return `${value.length} / ${FIELD_LIMITS[field]}`;
}
