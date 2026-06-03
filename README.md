# 临床复核伙伴 — TCM Clinical Review Workbench

[![CI](https://github.com/chiaweiwoo/tcm-diagnosis/actions/workflows/ci.yml/badge.svg)](https://github.com/chiaweiwoo/tcm-diagnosis/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-tcm.chiawei.me-blue)](https://tcm.chiawei.me)

A doctor-facing workbench that helps registered TCM practitioners review structured clinical cases with AI-assisted analysis. Doctors fill in a 9-field Chinese medicine form; the system returns an instant clinical review in simplified Chinese and persists a searchable consultation history.

> **Not patient-facing.** Access is restricted to allowlisted doctors only.

---

## Features

- **Structured 9-field form** — chief complaint, current illness, past history, physical exam (tongue + pulse required), diagnosis, pattern (证型), and prescription (方药 / 针灸 / 推拿 / 综合调理)
- **AI clinical review** — three-column output: 判断 (assessment) / 方案 (treatment plan) / 随访监测 (follow-up), plus 重点结论 (key conclusions) and 风险与提醒 (risk alerts)
- **辨证警示 diagnostic alert** — fires when AI detects critical inconsistencies (diagnosis↔symptom mismatch, pattern↔prescription 寒热矛盾, missed red-flag symptoms)
- **Stale-analysis warning** — banner appears when form inputs diverge from the last analyzed snapshot
- **Consultation history** — auto-saved, paginated, with Case ID / Follow-up Case ID / AI feedback fields; **随访 button** in the history modal pre-populates form from any prior case (one-click; auto-focuses Case ID input; "随访自 #XXXXX" chip shown after follow-up)
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

Historical ingestion is a staged pipeline, not a one-shot import. Every run starts from a chosen Excel export and stops at review gates before the next stage.

Required source columns:

- `Order Ref` or `External ID`
- `Created on`
- `Diagnosed By 诊断医师`
- `Patient 患者`
- `Age`
- `Presenting Complaint 主诉`
- `History of Presenting Complaint 现病史`
- `Diagnosis 诊断`
- `Treatment 治疗描述`
- `Past Medical History 既往史`
- `Medical Examination 体格检查`

Default ingestion window:

- Day-based latest 31 days from `MAX(Created on)`
- `Age`-invalid rows are dropped only when they are under 10% of the selected window; otherwise stop and fix the export
- `External ID` may replace `Order Ref` only when it is a stable Odoo row id such as `__export__.pos_order_69213`

Run order:

```bash
# 1. Deterministic pre-LLM package
npm run hist:prepare -- --file "C:\path\to\pos.order.xls" --out-dir "output\historical_ingestion\batch_name"

# 2. Validate the pre-LLM package
npm run hist:validate -- --input "output\historical_ingestion\batch_name\pre_llm_payload.json"

# 3. Sample LLM extraction first
npm run hist:extract -- --input "output\historical_ingestion\batch_name\pre_llm_payload.json" --output "output\historical_ingestion\batch_name\llm_sample.json" --sample 20

# 4. Validate the sample extraction
npm run hist:validate -- --input "output\historical_ingestion\batch_name\llm_sample.json"

# 5. Dry-run sample upsert using a doctor map
npm run hist:upsert -- --input "output\historical_ingestion\batch_name\llm_sample.json" --doctor-map "scratch\historical_doctor_map.json" --dry-run

# 6. After approval and migration 033, apply sample upsert
npm run hist:upsert -- --input "output\historical_ingestion\batch_name\llm_sample.json" --doctor-map "scratch\historical_doctor_map.json" --apply

# 7. Post-push verification
npm run hist:verify -- --batch batch_name --expected "output\historical_ingestion\batch_name\llm_sample.json"
```

Notes:

- `hist:extract` uses DeepSeek Flash with batched calls, bounded parallelism, retries, and single-row fallback for failed batches.
- Do sample extraction and sample upsert first. Only run the full month after the sample path is approved.
- Create `scratch\historical_doctor_map.json` from `scratch\historical_doctor_map.example.json` before any dry-run or apply step.
- Placeholder doctor emails such as `users_129@gmail.com` are allowed for historical import review, but they must still resolve to real Supabase `auth.users.id` rows before insert.
- Run `supabase/migrations/033_consultations_doctor_case_unique.sql` in the Supabase SQL Editor before any real upsert. It adds the `(doctor_id, case_id)` uniqueness required for idempotent import.

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
