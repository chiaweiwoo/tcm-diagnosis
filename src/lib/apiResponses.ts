import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CASE_ID_TOO_LONG"
  | "READ_ONLY_RECORD"
  | "NO_CONSULTATIONS"
  | "DRAFT_TOO_LONG"
  | "VALIDATION_BLOCKED"
  | "AI_REQUEST_FAILED"
  | "VIEW_AS_FORBIDDEN"
  | "VIEW_AS_TARGET_NOT_FOUND"
  | "VIEW_AS_READ_ONLY"
  | "CONFLICT"
  | "CANNOT_TOGGLE_SELF"
  | "INTERNAL_ERROR";

export type ApiErrorBody = {
  error: string;
  code: ApiErrorCode;
  details?: Record<string, unknown>;
};

export function apiError(
  status: number,
  code: ApiErrorCode,
  error: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json<ApiErrorBody>(
    details ? { error, code, details } : { error, code },
    { status },
  );
}
