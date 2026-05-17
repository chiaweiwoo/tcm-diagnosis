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

---

## Product Purpose

Doctor-facing TCM clinical workbench. Not patient-facing.

Helps registered TCM doctors:
- Fill in a structured 9-field clinical form (no free-text draft)
- Receive simplified-Chinese clinical review output directly
- Save consultation history for later comparison

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

Admin (browser, is_admin=true only)
  └── GET  /api/admin/users                    → doctor list with 30-day stats
  └── GET  /api/admin/users/[doctorId]/consultations → per-doctor consultation list (service_role)
  └── GET  /api/admin/analytics/evaluate/[doctorId] → latest doctor evaluation (Goal 1+2)
  └── POST /api/admin/analytics/evaluate/[doctorId] → trigger new evaluation for a doctor
  └── /admin/users                             → doctor list page
  └── /admin/users/[doctorId]                  → 3-tab view: 病案列表 | AI输出审核 | 临床画像

Cron (GitHub Actions, ASSESSMENT_API_KEY auth)
  └── POST /api/cron/evaluate-doctors          → nightly Goal 1+2 evaluation for all active doctors (02:00 CST)
                                                  also triggerable via workflow_dispatch with email + force inputs

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
- Core analysis sections must be structurally stable — all sections always present, even if empty with a fallback string.
- Analyze output reading order: 重点结论 → 当前思路 → 建议优化 → 可选思路 → 风险与提醒 → 随访监测 → 证据状态.
- UI result layout: 3 columns — 判断 (当前思路) / 方案 (建议优化+可选) / 随访监测. Plus 重点结论 banner and 风险与提醒 warning box at top.
- Saved history must pass through the same normalization path as fresh analysis (`ensureAnalysisResult` in `src/lib/ai/analysisResult.ts`).

### Result color coding
- `重点结论` banner: green (`#F0FDF4` bg, `#16A34A` border)
- `风险与提醒` banner: yellow (`#FEFCE8` bg, `#CA8A04` border)
- 判断 column: green header (`result-column--green`)
- 方案 column: slate/silver header (`result-column--slate`)
- 随访监测 column: teal header (`result-column--teal`)

---

## Structured Form Fields

Doctor fills 8 visible fields. All validated by `structuredCaseSchema` in `src/lib/forms/caseSchema.ts`.

Required fields (hard-block if missing/invalid):
- `prescriptionType`: `PrescriptionType[]` — array of "方药" | "针灸" | "综合调理", min 1 item (multi-select chip toggle)
- `patientAge`: numeric 1-120
- `patientSex`: "男" | "女"
- `chiefComplaint`: 2-200 chars
- `currentIllness`: 5-2000 chars
- `physicalExam`: 2-1000 chars (tongue + pulse required)
- `diagnosis`: 2-100 chars
- `pattern`: 2-100 chars (证型)
- `prescription`: 3-2000 chars

Optional fields (in schema but not shown in form UI): `consultationName`, `pastHistory`, `doctorQuestion`

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

Admin nav (1 tab, `src/app/admin/AdminNav.tsx`):
- **用户** — `/admin/users` — doctor list with 30-day stats + link to per-doctor view

`/admin` redirects to `/admin/users`.

`AdminNav` is a client component (needs `usePathname()` for active link highlighting). Admin layout is a server component.

Per-doctor read-only view (`/admin/users/[doctorId]`) — 3-tab layout via `?tab=` searchParam:
- **病案列表** — compact paginated table (15/page) of consultation records
- **AI输出审核** — Goal 1 output: `outputReview` from `analytics_doctor_evaluations`
- **临床画像** — Goal 2 output: `doctorProfile` from `analytics_doctor_evaluations`

Each consultation row has a **拷贝此病案** button — clones `form_data` only to admin's own account.
Clone inserts a new draft consultation under admin's UUID with `model_meta = { cloned_from_doctor_email: "..." }`.
Workbench shows a blue info banner when a cloned consultation is loaded; banner disappears after re-analysis.

Token usage: tracked in Langfuse only. No admin page for it.
Activity logs: written to Supabase `activity_logs` but no admin UI page for now.

Only `chiaweiwoo123@gmail.com` is seeded as admin.

---

## Doctor Evaluation (Goal 1 + Goal 2)

Nightly evaluation runs via GitHub Actions (`.github/workflows/evaluate-doctors.yml`):
- Schedule: `0 18 * * *` (02:00 CST)
- Auth: `X-Assessment-Key` header → `ASSESSMENT_API_KEY` GitHub secret
- Base URL: `ASSESS_BASE_URL` GitHub secret
- Smart skip: if a doctor already has an evaluation for today's window, skips (bypass with `force: true`)
- Can also be triggered manually via `workflow_dispatch` with optional `email` and `force` inputs

Route: `POST /api/cron/evaluate-doctors`
- Auth: `X-Assessment-Key` header only (no CRON_SECRET)
- Body: `{ doctorEmail?: string, force?: boolean }`
- Calls `evaluateDoctor()` in `src/lib/analytics/evaluation.ts`
- Stores result in `analytics_doctor_evaluations` table
- Window: 7 days, keyed by `(doctor_id, window_start, window_end)`

Prompts: `DOCTOR_EVALUATION_SYSTEM_PROMPT` in `src/lib/analytics/prompts.ts`
Window helper: `buildWindow(days)` in `src/lib/analytics/stats.ts`

Local escape hatch: `npm run evaluate -- [--email doctor@example.com] [--force]`
(reads `.env.local`, calls the same API endpoint)

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

Migrations: `supabase/migrations/` (numbered SQL). Applied manually in Supabase SQL editor.

| Table | Purpose |
|---|---|
| `consultations` | Doctor history — form_data JSONB, analysis JSON, model meta. Has `doctor_id` UUID FK (migration 016) with RLS (migration 017). |
| `error_logs` | Pipeline errors (no form field values) |
| `doctor_allowlist` | `email`, `is_active`, `is_admin` — access control source of truth |
| `activity_logs` | Doctor activity events (login, analyze) — no UI for now |
| `analytics_doctor_evaluations` | Per-doctor Goal 1+2 evaluation results. No RLS (admin service_role only). UNIQUE (doctor_id, window_start, window_end). (migration 021) |

> Migration 022 drops legacy tables: `analytics_prompt_quality_runs`, `analytics_usage_runs`, `analytics_performance_runs`, `analytics_admin_alerts`, `analytics_doctor_dashboard` view, `assessment_jobs`, `assessment_job_results`. Apply when ready.

`consultations`: doctor reads use user-scoped Supabase client (anon key + session JWT); RLS enforces isolation. Admin routes use service_role (bypasses RLS). Never expose service_role key to browser.

---

## Langfuse Integration

SDK v3 API. Per analyze call, Langfuse receives:
- `usageDetails`: `{ input, output, total, cacheHit, cacheMiss }` (token counts from API response)
- `metadata`: model, latency, prompt version, prescriptionType label, repairedJson flag
- Cost is computed by Langfuse's own model registry from token counts — no local `costDetails` sent.

**No clinical text ever reaches Langfuse.** Token usage and cost are monitored at `jp.cloud.langfuse.com`.

Env var: `LANGFUSE_BASE_URL` — defaults to `https://jp.cloud.langfuse.com` if not set.

---

## Model And Pricing Rules

- Analyze: `DEEPSEEK_MODEL_FAST` (flash). No other model exposed to doctors.
- Evaluation (Goal 1+2): `DEEPSEEK_MODEL_FAST`. Escalate to `deepseek-reasoner` only if quality fails.
- Cost is tracked exclusively in Langfuse via its model registry.
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

**evaluate-doctors returns `failed:1` with "no consultations in window"**
`buildWindow` sets `windowEnd` to midnight tomorrow, not today — this is intentional to include today's records. If evaluations are still empty, check that the doctor has consultations in the last 7 days.

**DeepSeek returns malformed JSON**
Expected — repair is built in. Check `repairedJson: true` in logs. If repair triggers consistently, the prompt output format needs tightening.

**Admin pages can't see brand CSS variables**
Brand tokens (`--brand`, etc.) must be defined in `globals.css`, not only in `workbench.css`. `workbench.css` only loads on `/` route.

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
3. Migration 022 applied in production (drops legacy analytics/assessment tables)
