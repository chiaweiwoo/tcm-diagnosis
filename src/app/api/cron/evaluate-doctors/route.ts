/**
 * Bulk doctor evaluation endpoint — runs Goal 2 medical doctor review
 * for all active doctors or a single doctor over the requested window.
 *
 * Triggered via GH Actions workflow_dispatch (manual only — no schedule).
 * Auth: X-Assessment-Key header must match ASSESSMENT_API_KEY env var.
 */

import { type NextRequest, NextResponse } from "next/server";
import { DeepSeekError } from "@/lib/ai/deepseek";
import { apiError } from "@/lib/apiResponses";
import {
  evaluateDoctor,
  insertDoctorEvaluation,
  NoConsultationsError,
} from "@/lib/analytics/evaluation";
import { logServerEvent } from "@/lib/logging";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;

type EvaluateRequest = {
  doctorId?: string;
  doctorEmail?: string;
  force?: boolean;
  windowDays?: number;
};

type DoctorTarget = {
  email: string;
  doctorId: string;
};

type Failure = {
  doctorEmail?: string;
  doctorId?: string;
  stage: "resolve_doctors" | "fetch_consultations" | "deepseek" | "save";
  message: string;
  details?: Record<string, unknown>;
};

function cleanWindowDays(value: unknown) {
  return typeof value === "number" && value > 0 && value <= 90 ? value : 7;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function deepSeekDetails(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof DeepSeekError)) return undefined;
  const details = Object.fromEntries(
    Object.entries(error.details ?? {}).filter(([key]) => !key.toLowerCase().includes("snippet")),
  );
  return {
    status: error.status,
    ...details,
  };
}

async function resolveDoctors({
  doctorId,
  doctorEmail,
}: {
  doctorId?: string;
  doctorEmail?: string;
}): Promise<DoctorTarget[]> {
  const admin = getServiceRoleClient();
  const [allowlistResult, usersResult] = await Promise.all([
    admin.from("doctor_allowlist").select("email").eq("is_active", true),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (allowlistResult.error) throw new Error(allowlistResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);

  const emailToId = new Map(
    usersResult.data.users.map((user) => [user.email?.toLowerCase() ?? "", user.id]),
  );
  const requestedEmail = doctorEmail?.trim().toLowerCase();
  const requestedId = doctorId?.trim();

  return (allowlistResult.data ?? [])
    .map((row) => row.email?.toLowerCase())
    .filter((email): email is string => Boolean(email))
    .map((email) => ({ email, doctorId: emailToId.get(email) }))
    .filter((doctor): doctor is DoctorTarget => Boolean(doctor.doctorId))
    .filter((doctor) => !requestedEmail || doctor.email === requestedEmail)
    .filter((doctor) => !requestedId || doctor.doctorId === requestedId);
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.ASSESSMENT_API_KEY;
  if (!expectedKey) {
    return apiError(500, "INTERNAL_ERROR", "ASSESSMENT_API_KEY is not configured.");
  }
  if (req.headers.get("X-Assessment-Key") !== expectedKey) {
    return apiError(401, "UNAUTHORIZED", "Invalid assessment key.");
  }

  let body: EvaluateRequest = {};
  try {
    body = await req.json() as EvaluateRequest;
  } catch {
    body = {};
  }

  const windowDays = cleanWindowDays(body.windowDays);
  const admin = getServiceRoleClient();

  let doctors: DoctorTarget[];
  try {
    doctors = await resolveDoctors({
      doctorId: body.doctorId,
      doctorEmail: body.doctorEmail,
    });
  } catch (error) {
    const failure: Failure = {
      stage: "resolve_doctors",
      message: safeErrorMessage(error),
    };
    return NextResponse.json({ ok: false, processed: 0, skipped: 0, failed: 1, failures: [failure] }, { status: 500 });
  }

  if ((body.doctorId || body.doctorEmail) && doctors.length === 0) {
    return NextResponse.json({
      ok: false,
      processed: 0,
      skipped: 0,
      failed: 1,
      failures: [{
        doctorEmail: body.doctorEmail,
        doctorId: body.doctorId,
        stage: "resolve_doctors",
        message: "Requested doctor was not active or not found.",
      } satisfies Failure],
    }, { status: 404 });
  }

  let processed = 0;
  let skipped = 0;
  const failures: Failure[] = [];

  for (const doctor of doctors) {
    try {
      const { evaluation, consultationCount, model } = await evaluateDoctor(admin, doctor.doctorId, windowDays);
      await insertDoctorEvaluation({
        client: admin,
        doctorId: doctor.doctorId,
        windowDays,
        evaluation,
        consultationCount,
        model,
      });
      processed++;
    } catch (error) {
      if (error instanceof NoConsultationsError) {
        skipped++;
        continue;
      }

      const message = safeErrorMessage(error);
      const stage: Failure["stage"] = error instanceof DeepSeekError
        ? "deepseek"
        : message.includes("没有已分析") || message.includes("No")
        ? "fetch_consultations"
        : "save";
      failures.push({
        doctorEmail: doctor.email,
        doctorId: doctor.doctorId,
        stage,
        message,
        details: deepSeekDetails(error),
      });
    }
  }

  if (failures.length > 0) {
    await logServerEvent({
      source: "api/cron/evaluate-doctors",
      message: "Goal 2 doctor evaluation failed.",
      details: { failures, processed, skipped, windowDays },
    });
  }

  return NextResponse.json({
    ok: failures.length === 0,
    processed,
    skipped,
    failed: failures.length,
    failures,
  }, { status: failures.length > 0 ? 500 : 200 });
}
