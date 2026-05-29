# 临床复核伙伴 — TCM Clinical Review Workbench

[![CI](https://github.com/chiaweiwoo/tcm-diagnosis/actions/workflows/ci.yml/badge.svg)](https://github.com/chiaweiwoo/tcm-diagnosis/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-tcm.chiawei.me-blue)](https://tcm.chiawei.me)

A doctor-facing workbench that helps registered TCM practitioners review structured clinical cases with AI-assisted analysis. Doctors fill in a 9-field Chinese medicine form; the system returns an instant clinical review in simplified Chinese and persists a searchable consultation history.

> **Not patient-facing.** Access is restricted to allowlisted doctors only.

---

## Features

- **Structured 9-field form** — chief complaint, current illness, past history, physical exam (tongue + pulse required), diagnosis, pattern (证型), and prescription (herbal, acupuncture, or integrative)
- **AI clinical review** — three-column output: 判断 (assessment) / 方案 (treatment plan) / 随访监测 (follow-up), plus 重点结论 (key conclusions) and 风险与提醒 (risk alerts)
- **辨证警示 diagnostic alert** — fires when AI detects critical inconsistencies (diagnosis↔symptom mismatch, pattern↔prescription 寒热矛盾, missed red-flag symptoms)
- **Stale-analysis warning** — banner appears when form inputs diverge from the last analyzed snapshot
- **Consultation history** — auto-saved, paginated, with Case ID / Follow-up Case ID / AI feedback fields
- **Doctor Risk Nudge** — workbench left sidebar aggregator showing recurring AI caution themes (weight-only, no counts) with verbatim hover popup
- **Doctor Profile Snapshot** — admin overlay (opens on doctor row click) with quality-signal rates and flagged-case list grouped by rule (critical alerts, non-clinical noise, short exam records, high-review-count cases, near-duplicate prescriptions); on-demand cached per doctor
- **Admin tools** — doctor allowlist management, doctor profile overlay, 30-day activity sparkline per doctor, fleet-wide AI output audit, impersonation preview (`/?viewAs=<doctorId>`) for non-self doctors

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Custom CSS (`workbench.css`, `admin.css`) + `lucide-react` |
| Validation | Zod |
| Auth & Database | Supabase (Google OAuth, Row Level Security, JSONB storage) |
| AI Provider | DeepSeek (server-side only — never exposed to the browser) |
| Observability | Langfuse (tokens + latency only — no clinical text) |
| CI | GitHub Actions (Node 24, Vitest + Next.js build) |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js 24 (matches CI)
- A [Supabase](https://supabase.com) project with Google OAuth enabled
- A [DeepSeek](https://platform.deepseek.com) API key
- (Optional) A [Langfuse](https://cloud.langfuse.com) project for observability

### Installation

```bash
git clone https://github.com/chiaweiwoo/tcm-diagnosis.git
cd tcm-diagnosis
npm install
```

### Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key — server-side only, never exposed to browser |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek API key — server-side only |
| `DEEPSEEK_MODEL_FAST` | ✅ | Fast model name (e.g. `deepseek-v4-flash`) |
| `ASSESSMENT_API_KEY` | ✅ | Shared secret for CLI scripts and cron routes to call `/api/analyze`. Generate with `openssl rand -hex 32`. Must match the value in Vercel env vars and GitHub Actions secrets. |
| `ALLOWED_DOCTOR_EMAILS` | ⚠️ | Comma-separated fallback allowlist when Supabase is unreachable. Primary access is managed via the `doctor_allowlist` table. |
| `LANGFUSE_PUBLIC_KEY` | Optional | Langfuse public key for token/cost observability |
| `LANGFUSE_SECRET_KEY` | Optional | Langfuse secret key |
| `LANGFUSE_BASE_URL` | Optional | Defaults to `https://jp.cloud.langfuse.com` |
| `DEV_AUTH_BYPASS` | Dev only | Set to `true` to skip Google OAuth locally. **Never reaches production** — guarded by `NODE_ENV` check. |
| `DEV_AUTH_EMAIL` | Dev only | Email used when `DEV_AUTH_BYPASS=true`. Must be on the allowlist. |

### Run Locally

```bash
npm run dev       # http://localhost:3000
npm run test      # Vitest unit tests
npm run build     # Verify production build
```

---

## Architecture

```
Doctor (browser)
  └── POST /api/analyze              → DeepSeek flash → clinical review JSON
  └── /api/consultations/*           → Supabase (save / load / delete history)
  └── GET  /api/me/nudge             → dr_nudge themes + verbatim examples (doctor RLS-gated)

Admin (is_admin = true)
  └── /admin/users                   → doctor list with 30-day activity sparkline; row click opens profile overlay
  └── GET  /api/admin/users/[doctorId]/profile → snapshot + flagged cases (on-demand cached)
  └── /admin/output-audits           → fleet-wide AI output audit results

GitHub Actions (ASSESSMENT_API_KEY auth)
  └── POST /api/cron/dr_nudge             → daily 03:00 SGT (19:00 UTC) computation
  └── POST /api/cron/output-audit         → fleet-wide AI output audit
```

**Security invariants:**
- No DeepSeek or service role keys ever reach the browser
- All API routes require either a valid Supabase session cookie or `X-Assessment-Key` header
- Admin routes additionally require `is_admin = true` on `doctor_allowlist`
- Row Level Security on `consultations` enforces per-doctor data isolation at the database level
- Clinical text never leaves Supabase (Langfuse receives tokens and metadata only)

---

## API Routes

| Route | Auth | Description |
|---|---|---|
| `POST /api/analyze` | Session or API key | Submit structured case form, returns clinical review JSON |
| `GET /api/consultations` | Session | List current doctor's consultation history |
| `POST /api/consultations` | Session | Create new consultation record |
| `GET /api/consultations/[id]` | Session | Fetch single consultation |
| `PATCH /api/consultations/[id]` | Session | Update clinical inputs, analysis result, Case ID, feedback |
| `DELETE /api/consultations/[id]` | Session | Delete consultation |
| `GET /auth/callback` | — | Google OAuth callback + allowlist check |
| `GET /auth/signout` | — | Sign out and redirect to login |

---

## Doctor Management

All onboarding is admin-driven via CLI — there is no self-signup flow.

```bash
# Add a doctor (creates auth.users row if absent + upserts doctor_allowlist)
npm run allowlist:add -- --email doctor@example.com

# Add a doctor with admin privileges
npm run allowlist:add -- --email doctor@example.com --admin

# Deactivate a doctor (soft-remove — auth.users row preserved)
npm run allowlist:add -- --email doctor@example.com --remove

```

---

## Background Jobs

The active doctor-facing/admin-facing background job is:

- `npm run dr_nudge -- --email doctor@example.com` (or `--doctorId <uuid>`; add `--force` to bypass the watermark)

Or run it fleet-wide with no doctor target:

```bash
npm run dr_nudge
```

The corresponding GitHub Actions workflow is:

- `dr_nudge` → `POST /api/cron/dr_nudge` (daily 03:00 SGT)

### Fleet-wide AI Output Audit

Reviews AI output quality across all doctors to surface prompt-level issues. Admins trigger it from `/admin/output-audits` or via **GitHub Actions → AI Output Audit → Run workflow**.

For local consistency testing (run the same case N times, compare output stability):

```bash
node scratch/consistency_check.mjs
node scratch/consistency_check.mjs --runs 5 --email doctor@example.com
# BASE_URL=https://tcm.chiawei.me node scratch/consistency_check.mjs
```

---

## Historical Data Ingestion

Supports bulk import from Odoo Excel exports (e.g. `nova_data_may.xls`).

```bash
# 1. Clean and restructure raw export
python scratch/clean_historical_data.py

# 2. Insert into database (creates local JSON backup first)
node --env-file=.env.local scratch/ingest_ardy_data.mjs

# 3. Batch-analyze all imported draft records
node --env-file=.env.local scratch/analyze_batch_historical.mjs

# 4. Verify row counts, date boundaries, and draft→analyzed conversions
node --env-file=.env.local scratch/check_ardy_rows.mjs
```

> **Always take a Supabase SQL snapshot backup before running ingestion.** The ingest script creates a local JSON backup under `output/` (gitignored) but a server-side backup is the safer first step.

---

## Deployment

The app deploys automatically to Vercel on push to `main`.

**Required Vercel environment variables** (mirror your `.env.local` — omit dev-only keys):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL_FAST`
- `ASSESSMENT_API_KEY`
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (optional)

**Required GitHub Actions secrets:**

| Secret | Used by |
|---|---|
| `ASSESSMENT_API_KEY` | All cron workflows |
| `ASSESS_BASE_URL` | All cron workflows (e.g. `https://tcm.chiawei.me`) |

---

## Database Migrations

Migrations live in `supabase/migrations/`. **Committing a migration file does not apply it** — every file must be run manually in the Supabase SQL Editor.

Legacy note:

- `analytics_doctor_evaluations` is now treated as legacy/inactive data.
- This refactor does not drop legacy Goal 2 tables. Clean them up in a separate migration only after confirming no runtime code reads them.

---

## Contributing

This project uses a **single branch (`main`) workflow** — no feature branches, no pull requests. All changes commit directly to `main`.
