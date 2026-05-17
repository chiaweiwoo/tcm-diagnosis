#!/usr/bin/env node
/**
 * scripts/evaluate.mjs
 *
 * Trigger Goal 1+2 evaluation for one doctor or all active doctors.
 *
 * Usage:
 *   npm run evaluate                        # all active doctors
 *   npm run evaluate -- --email dr@example.com   # single doctor
 *   npm run evaluate -- --force             # ignore smart-skip
 *
 * Requires in .env.local:
 *   CRON_SECRET
 *   APP_BASE_URL  (defaults to http://localhost:3000)
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    force: { type: "boolean", default: false },
  },
  strict: true,
});

const secret  = process.env.CRON_SECRET;
const baseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!secret) {
  console.error("Error: CRON_SECRET must be set in .env.local");
  process.exit(1);
}

const body = {};
if (values.email) body.doctorEmail = values.email.trim();
if (values.force) body.force = true;

console.log(values.email
  ? `Evaluating ${values.email}…`
  : "Evaluating all active doctors…"
);

const res = await fetch(`${baseUrl}/api/cron/evaluate-doctors`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-cron-secret": secret,
  },
  body: JSON.stringify(body),
});

const data = await res.json();

if (!res.ok) {
  console.error(`Failed (${res.status}):`, data);
  process.exit(1);
}

console.log(`Done — processed: ${data.processed}, skipped: ${data.skipped}, failed: ${data.failed}`);
