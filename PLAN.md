# Analytics & Identity Refactor — Execution Plan

> Companion to AGENTS.md. AGENTS.md = the destination (invariants, architecture, tone).
> PLAN.md = the path (sprint order, migrations, file paths, exact schemas).
> Execute sprint-by-sprint. Do not skip ahead. Each sprint ends with: commit + push + CI green.

---

## Identity model — how new doctors are onboarded

There is no signup page. The app does not create accounts. New doctors are onboarded by the admin (= the coder, with source-code access) via a CLI script:

- `scripts/allowlist-add.mjs --email doctor@example.com [--admin]`
  - Adds the email to `doctor_allowlist` (active = true, is_admin = flag).
  - If `auth.users` does not yet contain that email, creates the row via Supabase admin API (`auth.admin.createUser({ email, email_confirm: true })`).
  - The doctor can later sign in via Google OAuth; Supabase matches the existing `auth.users` row by email.

This means: every doctor has an `auth.users.id` UUID from day one, even before they have signed in. Seed scripts and analytics can reference that UUID immediately.

Admin can seed test consultations on behalf of any doctor (including themselves) via `scripts/seed-cases.mjs --email X` — it looks up X's UUID from `auth.users` and writes consultations under it using service_role.

---

## Pre-flight (one-time, manual — user does this)

Minimal. No accounts to create.

1. Add to `.env.local` (and Vercel env / GH Actions secrets, when the affected sprint deploys):
   ```
   CRON_SECRET=<openssl rand -hex 32>   # only needed from Sprint 5 onward
   APP_BASE_URL=<production URL>        # GH Actions secret only, Sprint 5
   ```
   `SUPABASE_SERVICE_ROLE_KEY`, `ASSESSMENT_API_KEY`, `DEEPSEEK_API_KEY` already exist.

   **No `ANTHROPIC_API_KEY`.** Per AGENTS.md invariant #13, this project is DeepSeek-only. Analytics narrative (Sprint 5) starts with DeepSeek Flash. Escalating to a smart non-DeepSeek model requires a formal commit-body justification.

2. ~~Place seed cases JSON at `data/seed-cases.json`~~ — **already done during planning.** 10 cases were converted from `samples_data.csv` (gitignored) and saved to `data/seed-cases.json` (also gitignored). Both entries are in `.gitignore`. Sprint 2 only needs to add the script that consumes the file.

Sonnet should re-check this section before starting each sprint and tell the user exactly what is needed for that sprint.

---

## Sprint Order (linear — do not parallelize)

| # | Sprint | Migrations | Why it comes here |
|---|---|---|---|
| 1 | Identity: doctor_id UUID + RLS | 016, 017 | Highest-risk change. Touches every consultation read/write. Stand-alone. |
| 2 | Cleanup + allowlist CLI + seed script | 018 | Low-risk bundle: drop samples, delete dead workflows, drop rates.json, add allowlist CLI, add seed script. |
| 3 | Admin users + read-only view + clone | — | Replaces impersonation. Read-only is the new admin viewing pattern. |
| 4 | Analytics tables + stats stage (no LLM) | 019, 020 | Numbers first. Verify schemas with real data before spending LLM tokens. |
| 5 | LLM narrative stage + daily GitHub Actions cron | — | Adds smart-model narration on top of stats. |

**Backlog (not in current execution):**
- Pattern alerts (manager layer) — depends on Sprint 4/5 data being collected for a few weeks first. Detectors + thresholds + alerts UI all parked. See "Pattern alerts" section at the bottom of this file. (Sprint 4 = analytics tables + stats; Sprint 5 = LLM narrative.)

---

## Sprint 1 — Identity: doctor_id UUID + RLS

### Migration 016 — add doctor_id to consultations

```sql
ALTER TABLE consultations ADD COLUMN doctor_id UUID REFERENCES auth.users(id);
UPDATE consultations c
   SET doctor_id = u.id
  FROM auth.users u
 WHERE c.doctor_email = u.email
   AND c.doctor_id IS NULL;
-- Verify: SELECT COUNT(*) FROM consultations WHERE doctor_id IS NULL;
-- Must be 0 before next line. If not, ask user.
ALTER TABLE consultations ALTER COLUMN doctor_id SET NOT NULL;
CREATE INDEX consultations_doctor_id_idx ON consultations(doctor_id);
```

### Migration 017 — RLS on consultations

```sql
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY consultations_self_select ON consultations
  FOR SELECT TO authenticated
  USING (doctor_id = auth.uid());

CREATE POLICY consultations_self_insert ON consultations
  FOR INSERT TO authenticated
  WITH CHECK (doctor_id = auth.uid());

CREATE POLICY consultations_self_update ON consultations
  FOR UPDATE TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

CREATE POLICY consultations_self_delete ON consultations
  FOR DELETE TO authenticated
  USING (doctor_id = auth.uid());
-- service_role bypasses RLS automatically.
```

### Code changes

- `src/lib/supabase/server.ts`: add `getUserScopedClient()` that uses the request's Supabase session JWT (not service_role) for doctor-side reads/writes. Keep `getServiceRoleClient()` for admin routes only.
- `src/app/api/consultations/route.ts` and `[id]/route.ts`: switch from service-role + manual `.eq("doctor_email", ...)` filters to user-scoped client. RLS now enforces isolation. Remove the manual email filter.
- `src/app/api/analyze/route.ts`: on insert, write both `doctor_id = session.user.id` and `doctor_email = session.user.email` (email kept for display).
- TypeScript types: regenerate from Supabase or hand-edit `src/lib/supabase/types.ts` to include `doctor_id` on consultation rows.

### Verification (must pass before commit)

- Sign in as doctor A, fetch history → only A's rows.
- Sign in as doctor B, fetch history → only B's rows.
- Use SQL editor as a test: `SET ROLE authenticated; SET request.jwt.claim.sub = '<doctor A uuid>'; SELECT count(*) FROM consultations WHERE doctor_id != '<A>';` → must return 0.

### Commit message: `sprint 1: doctor_id UUID + RLS on consultations`

---

## Sprint 2 — Cleanup + allowlist CLI + seed script

Low-risk bundle. All additive (new files) or deletive (orphaned code). One commit.

### 2A. Drop dead workflows + scripts

Files to delete:
- `.github/workflows/assess.yml` — references deleted scripts.
- `.github/workflows/assess-review.yml` — references deleted scripts.

### 2B. Drop cost-tracking infrastructure + slim `model_meta`

Langfuse is now the sole source of truth for tokens, cost, and latency at the provider level. `model_meta` becomes a small, queryable shape useful for analytics (Sprint 4).

**New `model_meta` shape** (written to `consultations` on analyze):
```ts
{
  model:           string,   // e.g. "deepseek-chat" — used for Sprint 4 stats
  promptVersion:   string,   // e.g. "v3-2024-09" — correlates output to prompt revisions
  durationSeconds: number,   // wall-clock end-to-end — surfaces UI slowness regressions
  repairedJson:    boolean,  // PROMOTED from Langfuse-only. Sprint 4 needs this queryable in Supabase.
}
```

**Dropped from `model_meta`**: `usage` (token counts), `costUsd`. Langfuse owns these.

Files to delete:
- `.github/workflows/update-rates.yml` — daily rates updater.
- `.github/scripts/update-rates.mjs` — the updater script.
- `config/rates.json` — local pricing.

Files to edit:
- `src/lib/ai/deepseek.ts`:
  - Remove `import RATES from "../../../config/rates.json";`
  - Remove the `costUsd` computation and any `costDetail` shape that depends on RATES.
  - Keep token-count fields in the return shape (Langfuse still needs them passed through from the trace).
- `src/app/api/analyze/route.ts`:
  - Remove `costUsd` from the response body.
  - Langfuse `costDetails` block: drop our local `total` value. Let Langfuse compute cost from token counts + model name via its own model registry.
  - `model_meta` written to `consultations` follows the new shape above (4 fields). Add `repairedJson` — currently only in the analyze response.
- `src/app/workbench.tsx`:
  - Update the local `ApiMeta` type to match the new shape: drop `usage` and `costUsd`, add `repairedJson`.
  - `setMeta(...)` call after analyze: drop `costUsd`, add `repairedJson: data.repairedJson`.
  - Any other reference to `usage` / `costUsd` in this file: remove.
- `src/lib/consultations.ts`: if `model_meta` is typed there, update to new shape.
- `AGENTS.md` "Model And Pricing Rules" section: rewrite. No more rates.json. Cost monitored exclusively via Langfuse. New `model_meta` shape documented.

### 2C. Remove sample UI + drop assessment_samples

Migration 018:
```sql
DROP TABLE IF EXISTS assessment_samples CASCADE;
```

Files to delete:
- `src/app/api/admin/samples/route.ts`
- `src/app/admin/examples/page.tsx`
- `src/app/admin/examples/` (whole dir if empty after)
- `supabase/migrations/013_assessment_samples.sql` (delete to avoid future re-seed)

Files to edit:
- `src/app/workbench.tsx`: remove `samplesOpen`, `samples`, `samplesLoading`, `handleToggleSamples`, `handleLoadSample`, the `🧪 样本` button + its dropdown wrapper, and the `SamplesPanel` component definition.
- `src/app/workbench.css`: remove `.samples-*` rules (if any survived after dropdown refactor — verify).
- `src/app/admin/AdminNav.tsx`: remove the `样本库` link.

### 2D. New file — `scripts/allowlist-add.mjs`

Usage:
```
node scripts/allowlist-add.mjs --email doctor@example.com [--admin]
node scripts/allowlist-add.mjs --email doctor@example.com --remove
```

Behavior:
- Reads `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` from env.
- For `--remove`: sets `is_active=false` on `doctor_allowlist` (soft remove). Does NOT delete the `auth.users` row.
- Otherwise:
  - Looks up email in `auth.users`. If absent, creates via `supabase.auth.admin.createUser({ email, email_confirm: true })`. Captures the new UUID.
  - Upserts into `doctor_allowlist` with `is_active=true` and `is_admin=<flag>`.
  - Prints the user's UUID for reference.

### 2E. New file — `scripts/seed-cases.mjs`

`data/seed-cases.json` is already prepared (during planning) from `samples_data.csv`. 10 real cases. Both source CSV and derived JSON are gitignored via `.gitignore` entries:
```
/samples_data.csv
/data/seed-cases.json
```
These gitignore lines are already in place — committing them is part of Sprint 2.

Shape of each entry (already conforming to `structuredCaseSchema`):
```json
{
  "form_data": {
    "prescriptionType": ["方药"|"针灸"|"综合调理", ...],
    "patientAge": <1-120>,
    "patientSex": "男"|"女",
    "chiefComplaint": "...",
    "currentIllness": "...",
    "pastHistory": "..." (optional),
    "physicalExam": "...",
    "diagnosis": "...",
    "pattern": "...",
    "prescription": "..."
  }
}
```

`scripts/seed-cases.mjs` usage:
```
node scripts/seed-cases.mjs --email doctor@example.com [--reset]
```

Behavior:
- Reads `ASSESSMENT_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from env.
- Reads `--email` from argv. Looks up that email in `auth.users` via service-role → captures `doctor_id` UUID. Errors with a clear hint to run `allowlist-add.mjs` first if not found.
- Reads `data/seed-cases.json`. Errors if missing.
- For each case:
  - POST to `${BASE_URL}/api/analyze` with header `X-Assessment-Key: ${ASSESSMENT_API_KEY}` and body `{ form, doctorIdOverride: <uuid> }`.
  - `/api/analyze` only honors `doctorIdOverride` when authenticated by the calibration key (never via session).
  - Inserts a `consultations` row under that doctor_id (service-role insert, bypasses RLS).
- `--reset`: deletes the target doctor's existing consultations first (service-role DELETE). Confirms with a prompt unless `--yes` is also passed.

Files to edit:
- `src/app/api/analyze/route.ts`: when caller is calibration-key (not session), accept optional `doctorIdOverride: string` in body. Validate it is a UUID. The seed script (not the analyze route) does the DB insert.
- `package.json`: add `"allowlist:add": "node scripts/allowlist-add.mjs"` and `"seed:cases": "node scripts/seed-cases.mjs"`. Keep `"check:deepseek"` as-is.

### 2F. AGENTS.md cleanup

Do a full conflict pass. Specific changes:
- Remove invariant #10 entirely (no longer relevant).
- Remove `🧪 样本` and `/api/admin/samples` from the Architecture diagram.
- Remove the "Assessment Samples" section.
- Remove the "assessment_samples table missing" entry from Common Pitfalls.
- Remove the `样本库` tab from the Admin UI section.
- Remove `assessment_samples` from the Database Schema table.
- Rewrite the "Model And Pricing Rules" section: cost is tracked exclusively via Langfuse; rates.json removed.
- Add a "Doctor onboarding" section pointing at `scripts/allowlist-add.mjs` and `scripts/seed-cases.mjs`.

### Commit message: `sprint 2: cleanup + allowlist cli + seed script`

---

## Sprint 3 — Admin users + read-only doctor view + clone-to-own

### New routes (pages)

- `/admin/users` — list of allowlisted doctors with: email, consultation count (last 30d), last active, view button.
- `/admin/users/[doctorId]` — read-only view of that doctor's consultations. Same 3-column result layout as workbench, but:
  - Form fields rendered as read-only `<div>` (not `<input>`)
  - No save / analyze / delete buttons
  - History sidebar same as workbench
  - Each history row has a `克隆此病案` button
  - Top banner: `正在以只读模式查看 ${email} 的记录`

### New API routes

- `GET /api/admin/users` — returns allowlisted doctors with aggregate stats. service_role.
- `GET /api/admin/users/[doctorId]/consultations` — returns consultations for a doctor. service_role.
- `POST /api/consultations/[id]/clone`:
  - Reads source consultation under service_role.
  - Inserts a new row under the *caller's* `doctor_id` (admin's own UUID).
  - Copies `form_data` only — no `analysis`, no `model_meta`.
  - Adds `metadata: { cloned_from_doctor_email: "..." }` for the banner.
  - Returns the new consultation id.
  - Caller must be admin.

### AdminNav

Add `用户` link → `/admin/users`. Keep `评估记录` (will be renamed to `分析` in Sprint 4).

### Workbench

When workbench loads a consultation that has `metadata.cloned_from_doctor_email`, show a banner: `克隆自 ${email} 的病案 — 修改与保存只影响你的账户`.

### Commit message: `sprint 3: admin users list, read-only view, clone-to-own`

---

## Sprint 4 — Analytics tables + stats stage (no LLM yet)

### Migration 019 — analytics tables

```sql
-- Global, admin-only (manager layer)
CREATE TABLE analytics_prompt_quality_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  stats JSONB NOT NULL,                  -- coverage_rate, length_dist, repaired_json_rate, etc.
  narrative TEXT,                         -- filled in Sprint 5
  narrative_model TEXT,
  narrative_tokens_in INT,
  narrative_tokens_out INT,
  narrative_cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end)
);
ALTER TABLE analytics_prompt_quality_runs ENABLE ROW LEVEL SECURITY;
-- No policies = no authenticated access. service_role only.

-- Per-doctor, doctor-growth layer
CREATE TABLE analytics_usage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  stats JSONB NOT NULL,                  -- consultation_count, active_days, peak_hour, etc.
  narrative TEXT,
  narrative_model TEXT,
  narrative_tokens_in INT,
  narrative_tokens_out INT,
  narrative_cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, window_start, window_end)
);
CREATE INDEX analytics_usage_doctor_idx ON analytics_usage_runs(doctor_id, window_end DESC);
ALTER TABLE analytics_usage_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_self_select ON analytics_usage_runs
  FOR SELECT TO authenticated USING (doctor_id = auth.uid());

-- Per-doctor, doctor-growth layer
CREATE TABLE analytics_performance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  stats JSONB NOT NULL,                  -- length_avg per field, completeness, repaired_rate, etc.
  narrative TEXT,
  narrative_model TEXT,
  narrative_tokens_in INT,
  narrative_tokens_out INT,
  narrative_cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, window_start, window_end)
);
CREATE INDEX analytics_performance_doctor_idx ON analytics_performance_runs(doctor_id, window_end DESC);
ALTER TABLE analytics_performance_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_self_select ON analytics_performance_runs
  FOR SELECT TO authenticated USING (doctor_id = auth.uid());

-- Per-doctor, manager-only
CREATE TABLE analytics_admin_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,              -- 'modality_drift', 'risk_flag_spike', etc.
  severity TEXT NOT NULL,                -- 'info', 'watch', 'concern'
  payload JSONB NOT NULL,                -- {before, after, delta, window}
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ
);
CREATE INDEX analytics_admin_alerts_doctor_idx ON analytics_admin_alerts(doctor_id, triggered_at DESC);
ALTER TABLE analytics_admin_alerts ENABLE ROW LEVEL SECURITY;
-- No policies = service_role only.
```

### Migration 020 — analytics dashboard view

```sql
CREATE VIEW analytics_doctor_dashboard AS
SELECT
  u.doctor_id,
  u.window_start,
  u.window_end,
  u.stats AS usage_stats,
  u.narrative AS usage_narrative,
  p.stats AS performance_stats,
  p.narrative AS performance_narrative,
  u.created_at
FROM analytics_usage_runs u
LEFT JOIN analytics_performance_runs p
  ON p.doctor_id = u.doctor_id
 AND p.window_start = u.window_start
 AND p.window_end = u.window_end;
-- Inherits RLS from underlying tables.
```

### Stats SQL — concrete queries

Put each in `src/lib/analytics/stats.ts` as a named async function returning typed JSON.

**Prompt quality (global, window: last 7 days):**
- `count_consultations`: `SELECT count(*) FROM consultations WHERE created_at >= $1 AND created_at < $2`
- `coverage_rate_by_section`: for each of 6 analysis sections, count rows where the section text is non-empty and not equal to the known fallback string. Return `{section: pct}`.
- `length_dist_by_section`: `SELECT section, avg(length), percentile_cont(0.5), percentile_cont(0.9) FROM ...`
- `repaired_json_rate`: `SELECT avg(case when model_meta->>'repairedJson' = 'true' then 1 else 0 end) FROM ...`
- `prescription_type_dist`: count by each modality (`方药`, `针灸`, `综合调理`)
- `risk_flag_rate`: % of consultations where 风险与提醒 section is non-empty
- `avg_latency_ms`: from `model_meta`
- `avg_cost_usd`: from `model_meta`

**Usage (per-doctor, window: last 30 days):**
- `consultation_count`
- `active_days`: distinct date(created_at)
- `avg_per_active_day`
- `peak_hour`: most common hour-of-day
- `hour_histogram`: 24-element array
- `prescription_type_dist`
- `top_diagnoses`: top 10 by frequency
- `top_complaints`: top 10 by frequency (truncate to first 8 chars for grouping)

**Performance (per-doctor, window: last 30 days):**
- `length_avg_per_field`: 8 fields, avg char count
- `optional_field_completeness`: % populated for optional fields if any are added later
- `risk_flag_rate`: per this doctor
- `repaired_json_rate`: per this doctor
- `top_diagnosis_pattern_pairs`: top 10 `(diagnosis, pattern)` co-occurrences

### API + UI

- `GET /api/admin/analytics/prompt-quality?window=7d`: returns latest run row.
- `GET /api/admin/analytics/users/[doctorId]?window=30d`: returns dashboard view row for that doctor.
- `GET /api/analytics/me?window=30d`: doctor's own usage + performance (RLS-protected).
- `/admin/analytics` page: rename from `/admin/assessments` directory. Lists prompt-quality runs + per-doctor links.
- `/admin/users/[doctorId]` page (from Sprint 3): add an Analytics tab showing this doctor's latest usage + performance.
- `/me/analytics` page: doctor's own view. Cards: 用法 (usage stats) + 表现 (performance stats). Narrative section empty for now.

### Commit message: `sprint 4: analytics tables + stats stage`

---

## Sprint 5 — LLM narrative stage + daily GitHub Actions cron

### Model — DeepSeek Flash first, escalate only on tone failure

Per AGENTS.md invariant #13, this project is DeepSeek-only by default. Start with Flash, justify before escalating.

**Step 1 — implement with DeepSeek Flash (`DEEPSEEK_MODEL_FAST`):**
- Reuse the existing `callDeepSeekJson` infrastructure from `src/lib/ai/deepseek.ts`.
- Same env (`DEEPSEEK_API_KEY`), same Langfuse wiring.
- No new SDK, no new API key. Cost per narrative ≈ $0.0001.

**Step 2 — review before merge:**
- Run the three narrative prompts against 5-10 real analytics runs (use seeded test data from Sprint 2).
- Eyeball each output against the AGENTS.md tone principles: strengths-first, observations-not-verdicts, questions-not-commands, no precision theater.
- Pass → ship with Flash. Stop here.

**Step 3 — escalation (only if Step 2 fails):**
- Switch to DeepSeek Pro (`deepseek-reasoner`). Same SDK, just change the model id. Cost ~3x Flash.
- Re-run Step 2. If pass → ship with Pro. Add a one-paragraph note to the commit body explaining which tone failure forced the escalation.

**Step 4 — non-DeepSeek (only if Step 3 also fails):**
- Stop. Open a discussion with the user. Per invariant #13, introducing Claude or any non-DeepSeek model requires explicit written justification + a documented review of why even Pro was insufficient. Do not do this autonomously.

### Logging

Extend existing Langfuse wiring to capture analytics narrative calls. Tokens, model, latency, cost (computed by Langfuse). The stats JSON passed to the model is OK to log (no PII — only aggregate counts). Never log the narrative output text — even though it goes through Langfuse's model that supports cost computation, the text itself stays in Supabase per invariant #8.

Cost ceiling per run: log warning if a single narrative exceeds $0.05 (much tighter than the original Claude-era ceiling).

### Prompts

Three system prompts in `src/lib/analytics/prompts.ts`:
- `PROMPT_QUALITY_NARRATIVE_SYSTEM_PROMPT` — admin-facing, direct, can be ranked.
- `USAGE_NARRATIVE_SYSTEM_PROMPT` — doctor-growth tone (see AGENTS.md tone principles).
- `PERFORMANCE_NARRATIVE_SYSTEM_PROMPT` — doctor-growth tone.

Each prompt must follow the prompt-audit checklist (run `/prompt-audit` before commit per global rule).

### Cron — GitHub Actions

Why GitHub Actions over Vercel Cron:
- Free, no Vercel Pro plan needed.
- Logs visible in the GH Actions UI alongside `update-rates.yml`.
- Consistent with existing CI tooling.
- Easy to trigger manually via `workflow_dispatch` for testing.

**`.github/workflows/analytics-daily.yml`** (new):
```yaml
name: Analytics daily cron
on:
  schedule:
    - cron: "0 18 * * *"   # 18:00 UTC ≈ 02:00 SGT next day
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Hit analytics-daily endpoint
        run: |
          curl --fail -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_BASE_URL }}/api/cron/analytics-daily"
```

GitHub secrets required: `CRON_SECRET`, `APP_BASE_URL` (e.g. `https://tcm-diagnosis.vercel.app`).

**`src/app/api/cron/analytics-daily/route.ts`** (new):
- Verifies `Authorization: Bearer ${CRON_SECRET}` header. Returns 401 otherwise.
- For each doctor in `doctor_allowlist`:
  - Compute window: last 30 days ending now (truncated to day).
  - Smart skip: if `analytics_usage_runs` exists for this window AND no new `consultations` created since that run's `created_at`, skip.
  - Otherwise: run stats, call LLM, upsert into `analytics_usage_runs` and `analytics_performance_runs`.
- Once per day, also: run prompt-quality stats + narrative for last 7 days, upsert into `analytics_prompt_quality_runs`.
- `export const maxDuration = 300;` — Vercel route timeout. For >10 doctors this may hit limits; if so, the workflow shifts to running the analytics work inside the GH Action runner directly (which has no 5-min cap) rather than via the HTTP endpoint. Decide when scale demands.

### Commit message: `sprint 5: llm narrative + daily gh actions cron`

---

## Naming changes (apply across all sprints as touched)

| Old | New | Sprint where renamed |
|---|---|---|
| `/admin/assessments` | `/admin/analytics` | 5 |
| `assessment_jobs` table | `analytics_prompt_quality_runs` etc (replaced) | 5 |
| `evaluation` / `assessment` in UI | `分析` / `analytics` | 5 |

Existing `assessment_jobs` and `assessment_job_results` tables: drop in migration 021 after Sprint 4 confirms the new tables work. Track this — do not forget.

---

## Verification before each sprint ends

1. Migration ran cleanly in Supabase SQL editor (user runs it, Sonnet confirms via `list_migrations`).
2. `pnpm tsc --noEmit` passes.
3. `pnpm lint` passes.
4. Manual smoke test of the changed path (see AGENTS.md audit checklist).
5. CI green: `gh run list --limit 1`.
6. AGENTS.md updated for any architecture/invariant change (with conflict pass — never just append).
7. Commit pushed to `main` via `git push origin HEAD:main`.

---

## What this plan deliberately does NOT cover

- **Pattern alerts (manager layer)** — backlogged. Builds on Sprint 4/5 data. Detectors, thresholds, alerts UI all deferred until we have weeks of real data flowing.
- Doctor feedback capture (accepted/rejected suggestions) — deferred, still in AGENTS.md deferred scope.
- External citation retrieval — deferred.
- Cohort comparison UI — wait for real data.
- Email/push delivery for alerts — wait to see if dashboard cards get ignored.
- Public signup / account-creation page — explicitly out of scope. All doctor onboarding is admin-driven via `scripts/allowlist-add.mjs`.

Anything in this list that becomes urgent: stop, re-plan, do not improvise.

---

## Pattern alerts (backlog — for when we have data)

Parked design, ready to pick up when Sprint 4/5 has been collecting data for a few weeks.

Detectors live in `src/lib/analytics/alerts.ts`, thresholds in `src/lib/analytics/alertConfig.ts`. One function per detector. Each compares current window vs baseline window and returns null or an alert object.

Pilot detector set:

1. `detectModalityDrift(doctorId)` — current 30d vs prior 90d baseline. If any modality's ratio dropped > 30% relative, emit `modality_drift` (severity `watch`).
2. `detectRiskFlagSpike(doctorId)` — current week vs trailing 4-week avg. If current > 2x avg AND current > 3 absolute, emit `risk_flag_spike` (severity `concern`).
3. `detectRepairedJsonSpike(doctorId)` — current week vs trailing 4-week avg. If current > 3x avg, emit `repaired_json_spike` (severity `info` — points to prompt issue, not doctor issue).
4. `detectActivityDropoff(doctorId)` — if consultation count for current week < 25% of trailing 4-week avg AND doctor was previously active, emit `activity_dropoff` (severity `watch`).

Integration: daily cron calls each detector per doctor. Inserts into `analytics_admin_alerts`. Admin dashboard surfaces unacknowledged alerts. Doctor-facing pages never query this table.

Thresholds will need tuning against real data — do not ship the pilot numbers untouched.
