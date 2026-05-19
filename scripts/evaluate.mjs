#!/usr/bin/env node
/**
 * Trigger Goal 2 doctor profile evaluation for one doctor or all active doctors.
 *
 * Usage:
 *   npm run evaluate
 *   npm run evaluate -- --email dr@example.com
 *   npm run evaluate -- --doctorId <uuid>
 *   npm run evaluate -- --email dr@example.com --force --windowDays 14
 *
 * Requires in .env.local:
 *   ASSESSMENT_API_KEY
 *   APP_BASE_URL  (defaults to http://localhost:3000)
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    doctorId: { type: "string" },
    force: { type: "boolean", default: false },
    windowDays: { type: "string" },
  },
  strict: true,
});

const assessKey = process.env.ASSESSMENT_API_KEY;
const baseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!assessKey) {
  console.error("Error: ASSESSMENT_API_KEY must be set in .env.local");
  process.exit(1);
}

const body = {};
if (values.doctorId) body.doctorId = values.doctorId.trim();
if (values.email) body.doctorEmail = values.email.trim();
if (values.force) body.force = true;
if (values.windowDays) body.windowDays = Number(values.windowDays);

const target = values.doctorId || values.email || "all active doctors";
console.log(`Evaluating ${target}...`);

const res = await fetch(`${baseUrl}/api/cron/evaluate-doctors`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Assessment-Key": assessKey,
  },
  body: JSON.stringify(body),
});

let data;
try {
  data = await res.json();
} catch (error) {
  console.error(`Failed to parse response JSON (${res.status}).`);
  console.error(error);
  process.exit(1);
}

if (!res.ok) {
  console.error(`Failed (${res.status}):`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

if (typeof data?.processed !== "number" || typeof data?.failed !== "number") {
  console.error("Failed: response did not include expected counters.");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

if (data.failed > 0) {
  console.error("Failed: one or more doctor evaluations failed.");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`Done - processed: ${data.processed}, skipped: ${data.skipped}, failed: ${data.failed}`);
