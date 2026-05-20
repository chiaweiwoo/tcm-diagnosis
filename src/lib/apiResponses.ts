import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "READ_ONLY_RECORD"
  | "NO_CONSULTATIONS"
  | "DRAFT_TOO_LONG"
  | "VALIDATION_BLOCKED"
  | "AI_REQUEST_FAILED"
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
