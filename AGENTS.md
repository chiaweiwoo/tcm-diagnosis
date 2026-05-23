# TCM Diagnosis — AI Session Memory

Auto-loaded by Claude Code. Records hard invariants and architectural decisions that
MUST be preserved across all future AI-assisted changes.

**Scope: This session is `chiaweiwoo/tcm-diagnosis` only. Do not commit or push to any other repository. If the user shares code or issues from another project, discuss only — do not edit or push.**

---

## CRITICAL INVARIANTS — DO NOT VIOLATE

### 1. Single branch — no PRs, no feature branches

Always work on `main`. No pull requests. No feature branches unless the user explicitly asks.

AI agents work inside a git worktree (`claude/reverent-kilby-a695cc`). Always push via:
```bash
git fetch origin main && git rebase origin/main
git push origin HEAD:main
```
Never push the worktree branch itself. Never use `--force`.

### 2. No secrets in browser or frontend code

- No `NEXT_PUBLIC_DEEPSEEK_*` env vars — ever.
- `ASSESSMENT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY` are server-side / CLI only.
- Enforced by: `src/lib/apiAuth.ts` (route guard), `src/lib/logging.ts` (service role only)

### 3. API routes require authentication

`/api/analyze` and `/api/consultations/*` require either:
- A valid Supabase session cookie (doctor via browser), OR
- `X-Assessment-Key` header matching `ASSESSMENT_API_KEY` env var (calibration CLI)

Neither → 401. Enforced by `src/lib/apiAuth.ts` called at the top of both routes.
`ASSESSMENT_API_KEY` must be set in Vercel env vars, `.env.local`, and GitHub Actions secrets.

`/api/admin/*` routes require a valid Supabase session AND `is_admin = true` on `doctor_allowlist`. Returns 403 otherwise.

`/api/cron/evaluate-doctors` uses `X-Assessment-Key` header (same `ASSESSMENT_API_KEY`). GitHub Actions secret name is `ASSESSMENT_API_KEY`; base URL secret is `ASSESS_BASE_URL`.

### 4. DEV_AUTH_BYPASS must never reach production

Guard is in `src/lib/auth.ts → assertDevBypassIsLocalOnly()`. It throws if `NODE_ENV !== "development"`. Never remove this check. Never add `NEXT_PUBLIC_DEV_AUTH_BYPASS`.

### 5. Doctor allowlist is source of truth for access

Read from Supabase `doctor_allowlist` table first. Fall back to `ALLOWED_DOCTOR_EMAILS` env var only when Supabase is unreachable. Signed-in but non-allowlisted users must be signed out immediately with a Chinese message.

### 6. Field limits are defined in src/lib/forms/limits.ts

`FIELD_LIMITS` in `src/lib/forms/caseSchema.ts` defines per-field character ceilings. Enforced by zod schema before any AI call. Do not raise limits without reviewing prompt token budgets.

### 7. Prompt contract is strict JSON — repair before failing

If DeepSeek returns malformed JSON, attempt syntax-only repair before returning an error. Never silently drop data. `repairedJson: true` flag must be logged when repair occurs.

### 8. Clinical data never leaves Supabase — no exceptions

Clinical text (doctor form inputs + AI analysis output) must only be stored in Supabase (`consultations` table). It must **never** be sent to any external observability or analytics service.

The only permitted external recipient of clinical content is **DeepSeek** (the AI provider — intentional).

Concretely:
- Langfuse receives **tokens, model, latency, cost, metadata only** — never form fields or AI response text.
- Error logs (`error_logs` table in Supabase) must not include form field values.
- Any new logging, tracing, or analytics integration must be reviewed against this rule before merging.

Enforced by code convention in `src/lib/langfuse.ts` and `src/app/api/analyze/route.ts`.

### 9. Update AGENTS.md and README.md when behavior changes

Any meaningful change to product behavior, architecture, security rules, or calibration workflow must be reflected in this file before the session ends. README updates are required when user-visible behavior changes.

### 10. doctor_id (UUID) is the stable identity, not email

`auth.users.id` UUID is the only stable identifier for a doctor. Email can change. Auth provider behavior can change.

All new tables that reference a doctor must use `doctor_id UUID` (FK to `auth.users.id`). `consultations.doctor_id` was added in migration 016 (backfilled from auth.users, NOT NULL enforced). RLS policies on per-doctor tables must read `auth.uid()`, not email.

Email is retained only as a denormalized display field. Never use it as a join key in new code.

### 11. RLS is the last line of defense

Per-doctor tables (`consultations`) must have Row Level Security policies that restrict reads to `doctor_id = auth.uid()`. Admin routes use service_role to bypass RLS — but only those routes. The database itself must refuse cross-doctor reads even if application code asks. A missed `.eq("doctor_id", ...)` in a future PR must not be able to cause a data leak.

### 12. Model selection — DeepSeek by default, smart model only with written justification

- **Clinical analysis is DeepSeek-only.** Chinese clinical content, established prompts. Never route clinical content through any other provider.
- **Doctor evaluation (Goal 1+2) uses DeepSeek.** Use Flash (`DEEPSEEK_MODEL_FAST`). Escalate to Pro (`deepseek-reasoner`) only if tone or quality demonstrably fails.
- **Any commit that introduces a smart model (Claude, GPT, etc.) must include a written justification in the commit body explaining why DeepSeek Pro was insufficient, with concrete examples.**
- **No `ANTHROPIC_API_KEY` in this project.**

### 13. Doctor-facing profile data — descriptive subset only

The workbench (`/`) displays the doctor's own clinical profile in the left sidebar (`我的画像`).

- **Endpoint:** `GET /api/me/profile` — requires valid session, uses service_role to read `analytics_doctor_evaluations`.
- **Descriptive subset** (may be shown to the doctor): `profileSummary`, `keyObservations`, `treatmentStyle`, `aiRecurringThemes` (theme + frequency only, no caseNumbers).
- **Analytical subset** (admin-only, must NEVER appear in doctor-facing responses): `strengths`, `gaps`, `guidancePoints`, `patientDistribution`, `fieldCompleteness`.
- The server strips analytical fields before returning. Never return raw `doctor_profile` JSONB to a doctor session.
- `aiRecurringThemes.caseNumbers` is also stripped — case-level granularity is admin-only.
- Cache: `Cache-Control: private, max-age=300, stale-while-revalidate=600`. Profile only updates when admin triggers a new evaluation.

---

## Product Purpose

Doctor-facing TCM clinical workbench. Not patient-facing.

Helps registered TCM doctors:
- Fill in a structured 9-field clinical form (no free-text draft)
- Receive simplified-Chinese clinical review output directly
- Save consultation history for later comparison
- Leave optional `病案编号 Case ID`, `随访病案编号 Follow-up Case ID`, and `给AI回馈 Feedback to AI` notes on analyzed records

---

## Collaboration Preferences

- Chat with the project owner in English.
- Product UI, validation messages, stored labels, and AI output must use simplified Chinese.
- Favor practical, compact workflows over broad setup complexity.
- Think from the doctor's reading flow first; usability matters as much as model quality.
- Use smaller commits when making larger changes so debugging and review stay tractable.

---

## Stack

- Frontend: Next.js + TypeScript on Vercel
- UI: focused CSS (`workbench.css`, `admin/admin.css`) + `lucide-react` icons
- Branding: `src/lib/branding.ts` — `BRANDING.name/subtitle/author/icon` used in header, login, and workbench footer
- Validation: `zod` schema in `src/lib/forms/caseSchema.ts` (`structuredCaseSchema`, `StructuredCaseForm`)
- Auth and data: Supabase (Google OAuth, allowlist, JSONB storage)
- AI provider: DeepSeek only, through server-side routes (`src/app/api/`)

---

## Architecture

```
Doctor (browser)
  └── POST /api/analyze                        → DeepSeek flash model → clinical review JSON (3-column layout)
  └── /api/consultations/*                     → Supabase (save / load / delete history)
  └── POST /api/consultations/[id]/clone       → clone another doctor's consultation to own account (admin only)
  └── GET  /api/me/profile                     → descriptive profile subset (strips analytical fields, invariant 13)

Admin (browser, is_admin=true only)
  └── GET  /api/admin/users                    → doctor list with 30-day stats
  └── GET  /api/admin/users/[doctorId]/consultations → per-doctor consultation list (service_role)
  └── GET  /api/admin/analytics/evaluate/[doctorId] → latest doctor profile evaluation
  └── POST /api/admin/analytics/evaluate/[doctorId] → trigger new doctor profile evaluation (14d window)
  └── GET  /api/admin/analytics/output-audit       → list fleet-wide AI output audits (v3, current)
  └── POST /api/admin/analytics/output-audit       → trigger new AI output audit (v3)
  └── GET  /api/admin/analytics/session-review     → legacy v1 (reads analytics_output_audits post-migration)
  └── /admin/users                             → doctor list page
  └── /admin/users/[doctorId]                  → 2-tab view: 病案列表 | 临床画像
  └── /admin/output-audits                     → fleet-wide AI output audits (v3, current)

GH Actions (ASSESSMENT_API_KEY auth, workflow_dispatch only — no schedule)
  └── POST /api/cron/evaluate-doctors          → bulk doctor profile evaluation (14d window, skips empty doctors)
                                                  triggerable via workflow_dispatch with optional email input
  └── POST /api/cron/evaluate-doctors-draft    → read-only experimental doctor-review draft
                                                  (Flash case-card compression + Pro synthesis; no DB writes)

Workbench header (admin only):
  └── ⚙ Settings2 icon → /admin → redirects to /admin/users
```

---

## CSS Architecture

- `src/app/globals.css` — **full canonical token set**: `--brand`, `--text`, `--text-muted`, `--bg`, `--surface`, `--border`, `--border-strong`, `--border-focus`, `--error`, `--error-bg`, `--warn`, `--warn-bg`, `--radius`, `--radius-lg`, `--shadow`, `--shadow-md`. Always the primary source — all routes load it.
- `src/app/workbench.css` — workbench-only styles. Also declares its own `:root` block (harmless duplicate) for IDE tooling. Loaded only on `/` route.
- `src/app/admin/admin.css` — admin UI styles. Has a `:root` alias block that maps legacy names (`--muted`, `--foreground`, `--paper`, `--line`, `--sage`, `--mint`, `--clinic-red`, `--clinic-red-soft`) to canonical globals.css tokens.

Never define a token only in `workbench.css` — admin pages won't see it. Add it to `globals.css` first.

---

## Clinical Pipeline Rules

- Single-step pipeline: doctor fills structured form → POST /api/analyze → result. No organize step.
- Analyze always uses `DEEPSEEK_MODEL_FAST` (flash). No mode selector exposed to doctors.
- All clinical fields remain editable at all times — including after analysis. Doctors can modify inputs and save without forcing a re-analysis. When clinical inputs differ from the snapshot at last analysis, the workbench shows a stale-analysis warning banner. The `analysis_stale` DB column persists this warning across page reloads.
- Metadata fields (`病案编号 Case ID`, `随访病案编号 Follow-up Case ID`, `给AI回馈 Feedback to AI`) save through the header `保存` button.
- Two-level unsaved-changes warning on navigation: clinical inputs changed → "建议先保存并重新分析" (re-analyze prompt); metadata-only changed → generic save reminder.
- Core analysis sections must be structurally stable — all sections always present, even if empty with a fallback string.
- Analyze output reading order: 辨证警示 (if triggered) → 重点结论 → 当前思路 → 建议优化 → 可选思路 → 风险与提醒 → 随访监测 → 证据状态.
- UI result layout: 3 columns — 判断 (当前思路) / 方案 (建议优化+可选) / 随访监测. Plus optional 辨证警示 red banner (top, above 重点结论), 重点结论 green banner, and 风险与提醒 warning box.
- Saved history must pass through the same normalization path as fresh analysis (`ensureAnalysisResult` in `src/lib/ai/analysisResult.ts`).

### 辨证警示 Diagnostic Alert
- AI field: `criticalRisk: { summary: string; highlights: string[] } | null` — present in `AnalysisJson` and `AnalysisResult`.
- Fires when AI detects a critical diagnostic inconsistency: diagnosis↔symptoms mismatch, pattern↔prescription寒热矛盾, or missed red-flag symptom.
- Prompt instructs no false alarms and requires echoing the critical point in `重点结论` as well.
- UI: `<DiagnosticAlertBanner>` renders above 重点结论 when `criticalRisk` is non-null. `<HighlightedText>` wraps matched phrases in `<mark class="critical-highlight">`.
- Normalization: missing or malformed field defaults to `null` (backward compat).
- Prompt version bumped to `tcm-analysis-v1.2` with this change.

### Result color coding
- `辨证警示` banner: red (`#FEF2F2` bg, `#DC2626` border, 6px left border)
- `重点结论` banner: green (`#F0FDF4` bg, `#16A34A` border)
- `风险与提醒` banner: yellow (`#FEFCE8` bg, `#CA8A04` border)
- 判断 column: green header (`result-column--green`)
- 方案 column: slate/silver header (`result-column--slate`)
- 随访监测 column: teal header (`result-column--teal`)

---

## Structured Form Fields

Doctor fills 9 visible fields. All validated by `structuredCaseSchema` in `src/lib/forms/caseSchema.ts`.

Required fields (hard-block if missing/invalid):
- `prescriptionType`: `PrescriptionType[]` — array of "方药" | "针灸" | "综合调理", min 1 item (multi-select chip toggle)
- `patientAge`: numeric 1-120
- `patientSex`: "男" | "女"
- `chiefComplaint`: 2-200 chars
- `currentIllness`: 5-2000 chars
- `pastHistory`: 1-1000 chars (if no relevant history, doctor writes "无")
- `physicalExam`: 2-1000 chars (tongue + pulse required)
- `diagnosis`: 2-100 chars
- `pattern`: 2-100 chars (证型)
- `prescription`: 3-2000 chars

Optional fields (in schema but not shown in form UI): `consultationName`

> `doctorQuestion` has been removed from the schema, prompt, and all fixtures. Historical `form_data` rows may still contain the key — it is silently ignored.

History item display name: auto-built from `patientSex + patientAge岁 + chiefComplaint` (no stored name field).

**Validation:** Single-layer zod schema (hard-block). Block patterns (hard-reject): guaranteed efficacy (`保证`, `治愈`, `包好`), patient self-use (`我是患者`, `我自己可以吃`).

**Live validation UI:** Split into two:
- `displayErrors`: debounced (250 ms) — used for per-field red/green borders and `<FieldError>` messages. Avoids zod parse blocking every keystroke.
- `liveErrors`: synchronous `useMemo` — used only for submit-button `disabled` gating and in `handleAnalyze` before calling the API.
Errors show once field is touched (`touched` set). Submit button disabled when `liveErrors` is non-empty.

---

## CRUD State Machine (Status Bar)

`SaveStatus = "new" | "unsaved" | "saving" | "saved"`

| Trigger | Transition |
|---|---|
| `handleNew()` | → `"new"`, `savedAt = null` |
| `setField(...)` | → `"unsaved"` (unless currently `"saving"`) |
| `handleSelectHistory` success | → `"saved"`, `savedAt = record.updated_at` |
| `handleAnalyze` / `handleSave` start | → `"saving"` |
| save success | → `"saved"`, `savedAt = new Date()` |
| save failure | → `"unsaved"` |

Status bar renders below submit button inside `form-card`. Toast fires on: analyze error, save success/failure, delete, history load success/failure.

---

## Admin UI

Admin entry point: `⚙` icon (Settings2) in workbench header, visible only when `isAdmin=true`.

Admin guard: `src/app/admin/layout.tsx` — server-side, redirects to `/?reason=not_admin` if not admin.

Admin nav (2 tabs, `src/app/admin/AdminNav.tsx`):
- **用户** — `/admin/users` — doctor list with 30-day stats + link to per-doctor view
- **AI 输出审查** — `/admin/output-audits` — fleet-wide AI output audits (v3)

`/admin` redirects to `/admin/users`.

`AdminNav` is a client component (needs `usePathname()` for active link highlighting). Admin layout is a server component.

Per-doctor read-only view (`/admin/users/[doctorId]`) — 2-tab layout via `?tab=` searchParam:
- **病案列表** — compact paginated table (15/page) of consultation records
- **临床画像** — `doctorProfile` from `analytics_doctor_evaluations`; includes 运行评估 button (14-day window, append-only)

Each consultation row has a **拷贝此病案** button — clones `form_data` only to admin's own account.
Clone inserts a new draft consultation under admin's UUID with `model_meta = { cloned_from_doctor_email: "..." }`.
Workbench shows a blue info banner when a cloned consultation is loaded; banner disappears after re-analysis.

Token usage: tracked in Langfuse only. No admin page for it.
Activity logs: written to Supabase `activity_logs` but no admin UI page for now.

Only `chiaweiwoo123@gmail.com` is seeded as admin.

---

## Doctor Evaluation (Goal 2 — medical doctor review)

**On-demand only.** No scheduled cron. Triggered by:
- Admin UI button on `/admin/users/[doctorId]` → 临床画像 tab
- GH Actions `workflow_dispatch` (`.github/workflows/evaluate-doctors.yml`) for bulk runs
- Local CLI: `npm run evaluate -- [--email doctor@example.com]`

Route: `POST /api/admin/analytics/evaluate/[doctorId]`
- Admin session auth required
- Window: **14 days rolling**, append-only (no upsert)
- Empty window → 400 `NO_CONSULTATIONS` with friendly Chinese message

Bulk route: `POST /api/cron/evaluate-doctors`
- Auth: `X-Assessment-Key` header
- Body: `{ doctorEmail?: string }`
- Doctors with 0 consultations in window → skipped silently (not failed)
- 3-attempt retry with exponential backoff in the GH Actions workflow

Draft experiment route: `POST /api/cron/evaluate-doctors-draft`
- Auth: `X-Assessment-Key` header
- Body: `{ doctorEmail: string, windowDays?: number, mode?: "medical_profile_v2" }`
- Read-only; never inserts into `analytics_doctor_evaluations`
- Used by `.github/workflows/evaluate-doctor-draft.yml` to inspect sandbox artifacts without writing rows
- Pipeline: all rows are seen by code; Flash compresses them into compact case cards; code aggregates case types / treatment logic / AI risk / strength signals; Pro writes the six medical sections; optional Flash cleanup if Pro is too long
- Logs must show only sanitized summary/diagnostics; no full consultation input in GitHub logs

### Current pipeline (medical v2)

Goal 2 is now a doctor-readable clinical review, not an operational audit. The canonical stored route uses the Flash + Pro medical-review pipeline and writes into `analytics_doctor_evaluations.doctor_profile` through the existing append-only insert path.

- Flash compresses each consultation into compact case cards with bounded parallelism and deterministic fallback.
- TypeScript aggregates medical signals from the cards.
- DeepSeek Pro synthesizes the final Chinese clinical review.
- The result is adapted into the existing `DoctorProfile` storage shape so no DB migration is required.
- Do not show explicit `x/y`, percentages, or visible frequency counts in the admin profile UI.
- The visible UI is split into `描述性分析` and `复盘与沟通`.
- Pie charts / patient distribution are no longer shown in the profile UI; time-series remains as light `近期记录背景`.

The draft workflow `.github/workflows/evaluate-doctor-draft.yml` remains available for sandbox inspection and artifacts, but it is not the canonical storage path. The canonical storage workflow is `.github/workflows/evaluate-doctors.yml`.

### Legacy deterministic pipeline (kept for helpers/tests)

**Stage 1 — Observer** (`analyzeConsultations()`, pure TypeScript, no LLM):
- `computeFieldCompleteness()` — pastHistory + physicalExam fill rates across ALL rows
- `computePatientDistribution()` — sex, age buckets (儿童/青年/中年/老年), prescription types
- `extractThemeCandidates()` → top 5 AI themes by frequency (from sampled cases)
- `detectGaps()` — dual-evidence rule in code: inputRate < 70% AND aiAskRate ≥ 30%
- `detectStrengthSignals()` — 4 heuristics: high_completeness, tongue_pulse_consistency, pattern_diversity, detailed_prescription, chief_complaint_specificity
- Samples up to `MAX_EVAL_CASES=20` cases (stratified by prescription type, most recent first)

**Stage 2 — Narrator** (`narrateFindings()`, LLM — flash model only):
- Receives compact findings (~30 lines) + case excerpts (one line each)
- Outputs prose only: profileSummary (3-4 sentences), keyObservations (≤4 bullets), strengths (≤6), gapsNarrative (evidence + guidance per gap), guidancePoints (≤4)
- Cannot invent field names, rates, gap candidates, or case numbers

**Merge** (`mergeProfile()`): joins Stage 1 structural fields + Stage 2 prose into stored `DoctorProfile`.

`DoctorProfile` schema (v1.3):
- `profileSummary` (string) — Stage 2
- `keyObservations` (string[]) — Stage 2, free-form observations
- `patientDistribution` (object | null) — Stage 1: sex/ageBuckets/prescriptionTypes
- `fieldCompleteness` (array) — Stage 1, stored but not rendered in UI
- `aiRecurringThemes` (array) — Stage 1 structure, Stage 2 prose
- `strengths` (array of `{text}`) — Stage 2
- `gaps` (array) — Stage 1 rates + Stage 2 evidence/guidanceHint
- `guidancePoints` (array of `{text}`) — Stage 2

Admin UI panel (`/admin/users/[doctorId]?tab=profile`) card order:
1. 画像摘要
2. 描述性分析: 临床观察, 反复提醒的风险点, 近期记录背景
3. 复盘与沟通: 可取之处, 可讨论方向, 沟通提示

All section titles have a `(?)` help tooltip.

Prompts: `DOCTOR_EVALUATION_SYSTEM_PROMPT` (`doctor-eval-v1.3`) in `src/lib/analytics/prompts.ts`
Window helper: `buildWindow(days)` in `src/lib/analytics/stats.ts`

## AI Output Audit (Goal 1 — v3, current)

**On-demand only.** Fleet-wide audit of AI output quality across all doctors. Admin/senior-doctor use only.

Route: `POST /api/admin/analytics/output-audit`
- Admin session auth required
- No body required; no prior-audit chaining
- Returns inserted `analytics_output_audits` row

Route: `GET /api/admin/analytics/output-audit?limit=20`
- Lists audits newest first

Cron route: `POST /api/cron/output-audit` — same logic, auth via `X-Assessment-Key`

GH Workflow: `.github/workflows/ai-output-audit.yml` → calls `/api/cron/output-audit`

UI: `/admin/output-audits` — append-only list, each row collapsible, category sections + "用户反馈" section with tooltips
- Backward compat: old v1 rows (without `categories` key) are rendered with legacy renderer and "v1 旧版" badge
- Old v2 rows (with `priorImprovementStatus`) are silently ignored — field is optional on the type

v3 schema key features:
- Window anchored to `MAX(analyzed_at)` fleet-wide then −14 days (not wall-clock "now")
- Sampling: newest-first, cap 100, no stratification
- Doctor feedback corpus: `ai_feedback` within same window, cap 50, anonymised, no doctor identity
- New output field: `userFeedbackSummary: string | null` — 1-3 sentence summary of feedback patterns
- Prior-audit chaining removed; `priorImprovementStatus` / `promptVersionsCompared` dropped from v3 output
- 6 Finding categories retained: safety / hallucination / reliability / completeness / tone / structure
- `findingKey = "category:shortName"` for stable reference within a single audit
- `exampleCases[].summary` self-contained: "女 45岁 头痛 — AI建议加酸枣仁（原案未提睡眠）"
- Severity grounded in patient health risk (see `auditDefinitions.ts`)
- All term definitions in `src/lib/analytics/auditDefinitions.ts` (single source of truth for both AI rubric and UI tooltips)

Prompts: `buildOutputAuditSystemPrompt()` (injects definitions), `OUTPUT_AUDIT_PROMPT_VERSION = "output-audit-v3"` in `src/lib/analytics/prompts.ts`
Library: `runOutputAudit()` in `src/lib/analytics/outputAudit.ts`
Window helper: `buildWindowFromLatestAnalysis(client, days)` in `src/lib/analytics/stats.ts`

**Legacy:** `SESSION_REVIEW_SYSTEM_PROMPT` / `reviewSession()` / `src/lib/analytics/sessionReview.ts` — kept for backward compat; do not use for new runs.

---

## Doctor Onboarding

No signup page. All onboarding is admin-driven via CLI:

```bash
# Add a doctor (creates auth.users row if absent + upserts doctor_allowlist)
npm run allowlist:add -- --email doctor@example.com [--admin]

# Remove a doctor (soft-remove: is_active=false, auth.users preserved)
npm run allowlist:add -- --email doctor@example.com --remove

# Seed test consultations from data/seed-cases.json (gitignored)
npm run seed:cases -- --email doctor@example.com [--reset] [--yes]
```

The doctor can then sign in via Google OAuth — Supabase matches the existing `auth.users` row by email.

`data/seed-cases.json` is gitignored — create locally, never commit. Contains `form_data` objects matching `structuredCaseSchema`. `patientAge` must be a string (HTML form input convention). Seed script calls `/api/analyze` with `X-Assessment-Key` and writes results via service-role.

---

## Database Schema

Migrations: `supabase/migrations/` (numbered SQL). **Committing a migration file does NOT apply it — every file must be manually run in the Supabase SQL Editor.** The production DB only reflects migrations that have been explicitly executed there.

| Table | Purpose |
|---|---|
| `consultations` | Doctor history — form_data JSONB, analysis JSON, model meta, optional `case_id` and `ai_feedback`. Has `doctor_id` UUID FK (migration 016) with RLS (migration 017). `analysis_stale` boolean (migration 027) persists stale-analysis state across reloads. |
| `consultation_change_events` | Append-only audit log of every `consultations` UPDATE. Written by Postgres trigger (migration 026). RLS: authenticated users see only their own rows. |
| `error_logs` | Pipeline errors (no form field values) |
| `doctor_allowlist` | `email`, `is_active`, `is_admin` — access control source of truth |
| `activity_logs` | Doctor activity events (login, analyze) — no UI for now |
| `analytics_doctor_evaluations` | Per-doctor profile evaluations. No RLS (admin service_role only). Append-only — no unique constraint once migration 022_doctor_evaluations_append_only is applied. |
| `analytics_output_audits` | Fleet-wide AI output audits (Goal 1 v2). No RLS. Append-only with optional `prior_review_id` chain. Renamed from `analytics_session_reviews` via migration 028. Old v1 rows (no `categories` key) are backward-compatible. |

> **Unapplied migrations (must be run in Supabase SQL Editor):**
> - `022_drop_analytics_and_assessments.sql` — drops legacy tables (`analytics_prompt_quality_runs`, etc.)
> - `022_doctor_evaluations_append_only.sql` — drops unique constraint on `analytics_doctor_evaluations(doctor_id, window_start, window_end)`; adds index. **Required before evaluation re-runs succeed.**
> - `023_session_reviews_and_eval_cleanup.sql` — drops `output_review` column, creates `analytics_session_reviews`
> - `028_rename_session_reviews_to_output_audits.sql` — renames `analytics_session_reviews` → `analytics_output_audits`. **Must run before new audit runs or the admin page can load data.**

`consultations`: doctor reads use user-scoped Supabase client (anon key + session JWT); RLS enforces isolation. Admin routes use service_role (bypasses RLS). Never expose service_role key to browser.

---

## Langfuse Integration

SDK v3 API. Per analyze call, `trace.generation()` receives three distinct usage fields:

- **`usage`** — standard Langfuse field: `{ input, output, total, unit: "TOKENS" }`. This is the field Langfuse reads for model registry lookups and display.
- **`usageDetails`** — cache breakdown for visibility: `{ cacheHit, cacheMiss }` (prompt_cache_hit/miss_tokens from DeepSeek).
- **`costDetails`** — explicit USD cost: `{ input: inputCostUsd, output: outputCostUsd, total: totalCostUsd }`. Computed locally because DeepSeek is not in Langfuse's model registry.
- **`metadata`** — model, latency, prompt version, prescriptionType label, repairedJson flag.

Cost formula (DeepSeek cache-aware pricing):
```
inputCost  = (cacheHit × HIT_PER_M + cacheMiss × MISS_PER_M) / 1_000_000
outputCost = (outputTokens × OUT_PER_M) / 1_000_000
```
Defaults: `HIT_PER_M=0.07`, `MISS_PER_M=0.27`, `OUT_PER_M=1.10` (USD per 1M tokens).
Override via env vars: `DEEPSEEK_PRICE_INPUT_HIT`, `DEEPSEEK_PRICE_INPUT_MISS`, `DEEPSEEK_PRICE_OUTPUT`.

**No clinical text ever reaches Langfuse.** Token usage and cost are monitored at `jp.cloud.langfuse.com`.

Env var: `LANGFUSE_BASE_URL` — defaults to `https://jp.cloud.langfuse.com` if not set.

---

## Model And Pricing Rules

- Analyze: `DEEPSEEK_MODEL_FAST` (flash). No other model exposed to doctors.
- Evaluation (Goal 1+2): `DEEPSEEK_MODEL_FAST`. Escalate to `deepseek-reasoner` only if quality fails.
- Cost is tracked in Langfuse via explicit `costDetails` (not the model registry — DeepSeek is not registered there).
- `model_meta` stored in `consultations` has shape `{ model, promptVersion, durationSeconds, repairedJson }`. Token counts and cost live in Langfuse only.
- Token usage and cost are internal only — never shown to doctors.

---

## Logging Rules

Per analyze call, Langfuse receives token counts, cost, latency, prompt version, prescriptionType, repairedJson flag. **No clinical text.**

Error events go to `error_logs` in Supabase via `logServerEvent`. Must not include form field values.

Doctor activity events (login, analyze) go to `activity_logs` in Supabase via `logActivity`. No admin UI for activity logs currently.

Logging must not block doctor-facing responses (use `after()` from Next.js).

---

## Common Pitfalls

**Chinese text becomes mojibake / garbled (`???`, `â€¦`, `æ²¡`)**
- Treat this as an implementation bug, not cosmetic noise. Stop and fix encoding before continuing.
- Prefer UTF-8-safe edits (`apply_patch`) and avoid rewriting Chinese files through shell commands that may use the wrong Windows code page.
- After editing Chinese prompts/docs/UI strings, inspect the file with UTF-8 output and search for mojibake markers such as `???`, `â€`, `æ`, `ç`, `ä¸`, or `�`.
- Do not commit garbled Chinese text. If a file already contains mojibake, repair it in the same commit that touches that area.

**Push rejected (non-fast-forward)**
```
git fetch origin main && git rebase origin/main && git push origin HEAD:main
```

**Cannot rebase: unstaged changes**
```
git stash && git rebase origin/main && git stash pop && git push origin HEAD:main
```

**`ASSESSMENT_API_KEY` missing**
Add it to `.env.local` and Vercel env vars. Still required for the `/api/analyze` route guard and `/api/cron/evaluate-doctors`.

**GitHub Actions secrets**
Registered secrets: `ASSESS_BASE_URL` (e.g. `https://your-app.vercel.app`) and `ASSESSMENT_API_KEY`.
There is no `CRON_SECRET` or `VERCEL_PRODUCTION_URL` — do not reference these.

**Migration file committed but not applied to production**
Committing a `.sql` file to `supabase/migrations/` has no effect on the live DB. The error will typically be a Postgres constraint or missing-column error surfaced through the API (e.g. `duplicate key value violates unique constraint`). Fix: open Supabase SQL Editor, run the pending migration manually, then retrigger. Always check the unapplied migrations list in the Database Schema section above before assuming a schema change is live.

**evaluate-doctors returns `skipped:1` with empty doctor**
`NoConsultationsError` now counts as a skip (not failure). Check that the doctor has analyzed consultations in the last 14 days. `buildWindow` sets `windowEnd` to midnight tomorrow — intentional, includes today's records.

**DeepSeek returns malformed JSON**
Expected — repair is built in. Check `repairedJson: true` in logs. If repair triggers consistently, the prompt output format needs tightening.

**Admin pages can't see brand CSS variables**
Brand tokens (`--brand`, etc.) must be defined in `globals.css`, not only in `workbench.css`. `workbench.css` only loads on `/` route.

**Langfuse shows $0 cost / missing token counts**
Two independent failure modes — both must be correct:
1. **Wrong field for tokens**: Langfuse reads the standard `usage` field (`{ input, output, total, unit: "TOKENS" }`) for display and registry lookups. Putting token counts only in `usageDetails` (a freeform custom field) means they never reach the cost engine.
2. **Model not in registry**: DeepSeek models are not in Langfuse's built-in model registry. Even with correct token counts in `usage`, Langfuse cannot compute cost without a registry entry. Fix: pass `costDetails: { input, output, total }` with USD amounts computed locally. Use `usageDetails` for additional breakdown (e.g. cache hit/miss) — it is display-only.
- Always send all three: `usage` (standard tokens), `usageDetails` (extras), `costDetails` (explicit USD).

---

## Documentation Direction

- `README.md` is in simplified Chinese. Technical terms (env vars, CLI commands, routes, model names) stay in English.
- Keep README minimal. Do not add sections unless the user asks.
- Update README when user-visible behavior meaningfully changes.
- Update AGENTS.md whenever architecture, security rules, or calibration workflow changes.

---

## Audit Checklist Before Saying "Done"

1. Fresh run path (form fill → analyze → auto-save)
2. Load saved history path (status bar → "已保存", toast fires)
3. Blocked path (invalid form → submit disabled)
4. Save/delete via toolbar
5. Admin nav accessible from workbench header (⚙ icon, admin only)
6. Docs synced (AGENTS.md + README if needed)
7. CI green (`gh run list --limit 1`)

Do not say done until the changed path is verified, not merely coded.

---

## Deferred Scope

1. Doctor feedback capture — accepted/rejected suggestion tracking
2. External citation retrieval layer
3. **`022_drop_analytics_and_assessments.sql`** — apply in production (drops legacy analytics/assessment tables)
4. **`022_doctor_evaluations_append_only.sql`** — apply in production (drops unique constraint, adds index; blocks evaluate-doctors until applied)
5. **`023_session_reviews_and_eval_cleanup.sql`** — apply in production (drops `output_review` column, creates `analytics_session_reviews`)
6. **`028_rename_session_reviews_to_output_audits.sql`** — apply in production (renames table; required before new audits can write or the admin page can load)
7. Phase 2: doctor-facing surface (doctorFacingHint removed from v1.1 schema; revisit if needed)
8. SGT timezone alignment in `buildWindow` — 14-day on-demand window makes boundary precision a non-issue; reopen if needed
9. AI Output Audit pipeline: records where `analysis_stale=true` have mismatched form_data/analysis_result — may cause false "hallucination" findings. Consider filtering these records.
