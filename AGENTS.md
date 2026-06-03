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
`ASSESSMENT_API_KEY` must be set in Vercel env vars, `.env.local`, and GitHub Actions secrets (for `/api/cron/dr_nudge` and `/api/cron/output-audit`).

`/api/admin/*` routes require a valid Supabase session AND `is_admin = true` on `doctor_allowlist`. Returns 403 otherwise.

**`apiAuth.ts` also re-checks the allowlist and session expiry** (via `getAuthStatus`) — deactivation and expiry take effect on the very next API request, not only page navigation.

Routes using `getCurrentDoctor()` (e.g. `/api/me/nudge`) inherit the same check — `currentDoctor.ts` calls `getAuthStatus` after resolving the email.

### 4. DEV_AUTH_BYPASS must never reach production

Guard is in `src/lib/auth.ts → assertDevBypassIsLocalOnly()`. It throws if `NODE_ENV !== "development"`. Never remove this check. Never add `NEXT_PUBLIC_DEV_AUTH_BYPASS`.

### 5. Doctor allowlist is source of truth for access

Read from Supabase `doctor_allowlist` table first. Fall back to `ALLOWED_DOCTOR_EMAILS` env var only when Supabase is unreachable. Signed-in but non-allowlisted users must be signed out immediately with a Chinese message.

### 15. 3-day session expiry — forced re-auth

All users (including admins) must re-authenticate every **3 days** from their last sign-in.

- `SESSION_MAX_AGE_DAYS = 3` constant in `src/lib/auth.ts`.
- `doctor_allowlist.last_signin_at` is stamped at `/auth/callback` on every successful OAuth sign-in (service-role UPDATE).
- `getAuthStatus(email)` in `src/lib/auth.ts` checks `last_signin_at`; returns `"expired"` if stale.
- Page guards (`src/app/page.tsx`, `src/app/admin/layout.tsx`) redirect expired users to `/auth/signout?reason=session_expired` → `/login?reason=session_expired` with Chinese notice 「会话已过期，请重新登录。」
- API guards (`apiAuth.ts`, `currentDoctor.ts`) return 401 immediately for expired sessions.
- Do not silently extend sessions or remove this check. The 3-day window is intentional.
- **Migration 034** must be applied before this feature is live (adds `last_signin_at` column + backfills existing rows with `now()` so existing users get a fresh 3-day window at deploy time).

### 16. Doctor allowlist management — add via UI, never delete

Admin can add doctors to `doctor_allowlist` via `/admin/users` UI (`POST /api/admin/users/add`). Rules:
- Only `@gmail.com` addresses are accepted (Google OAuth is the only sign-in path).
- New entries are always created as `is_admin: false`. Promote to admin via CLI only.
- **No deletion from UI or API** — deactivate (`is_active: false`) to revoke access. Records are permanent.
- `POST /api/admin/users/active` — toggles `is_active`. Admin cannot toggle their own row (server + client enforced).
- Deactivated users: dimmed row in list, eye icon hidden, status pill shows 已停用.
- Deactivation takes effect on the very next page navigation or API request (no grace period).

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

Per-doctor tables (`consultations`) must have Row Level Security policies that restrict reads to `doctor_id = auth.uid()`. Admin routes use service_role to bypass RLS — but only those routes. The database itself must refuse cross-doctor reads even if application code asks.

### 11a. Supabase access-control baseline (`public` schema)

The `public` schema is hardened against Supabase Data API default changes. Preserve this baseline:

- Every current `public` table has explicit grants for `anon`, `authenticated`, and `service_role`.
- RLS is enabled on `public` tables, and any table under RLS must have at least one intentional policy.
- Dangerous client privileges are removed from `anon` and `authenticated`: no `DELETE`, `TRUNCATE`, `TRIGGER`, or `REFERENCES`.
- `anon` is read-only (`SELECT`) on sensitive `public` tables.

New table checklist: add explicit grants for `anon`, `authenticated`, `service_role`; enable RLS; add at least one intentional policy.

### 12. Model selection — DeepSeek by default, smart model only with written justification

- **Clinical analysis is DeepSeek-only.** Chinese clinical content, established prompts. Never route clinical content through any other provider.
- **Background jobs in this repo use DeepSeek.** Use Flash (`DEEPSEEK_MODEL_FAST`) for `dr_nudge` and output audit generation unless a documented reason requires escalation.
- **Any commit that introduces a smart model (Claude, GPT, etc.) must include a written justification in the commit body explaining why DeepSeek Pro was insufficient, with concrete examples.**
- **No `ANTHROPIC_API_KEY` in this project.**

### 13. Doctor-facing sidebar — Risk Nudge card (replaces 我的画像)

The workbench (`/`) left sidebar shows `⚠️ AI 反复提醒的风险点` — the doctor's own recurring AI caution themes.

- **Component:** `src/app/RiskNudgePanel.tsx`.
- **Read endpoint:** `GET /api/me/nudge` — requires valid session; supports `X-View-As` for admin preview.
- **Data source:** `doctor_risk_nudges` table (one row per doctor, upsert on `doctor_id` PK).
- **What is shown:** `themes[].key` (TCM-native label ≤10字) + `themes[].description` (LLM-generated or DB fallback) + relative frequency bar (`weight` 0–1). No counts, no %, no verbatim text in bar area.
- **Row-hover popup:** shows label `示例：` + up to 5 verbatim caution excerpts from the doctor's own cases.
- **Raw counts never leave the server** — only `weight = count / max` is sent.
- Cache: `Cache-Control: private, max-age=300, stale-while-revalidate=600`.

### 14. Prompt Registry & Versioning (GitOps)

All system prompts are centralized and versioned inside the GitOps-based Code Prompt Registry under `src/lib/prompts/`.

**Registry Structure:**
- Live versions: `src/lib/prompts/registry/<family>/<version>.ts` — active, runtime-loadable
- Archive versions: `src/lib/prompts/registry/<family>/_archive/<version>.ts` — display-only, not imported into `index.ts`, never called at runtime
- Central registry manager: `src/lib/prompts/index.ts`

**Dynamic Version Resolution** (live versions only):
  1. Manual override (Code/Request payload parameter)
  2. CLI overrides (parsed from CLI arguments matching `--<key>-version`)
  3. Environment variables (matching `<KEY>_PROMPT_VERSION` in `.env.local`)
  4. Repository fallback default (`latest` pointer in registry index)

**Version bump workflow:**
1. Create `registry/<family>/v<N+1>.ts` — never modify an existing version file
2. Export `prompt` (string) or `buildPrompt()` (function) from the new file
3. Export `meta: { version, summary, motivation, futureIdeas }` — required for admin UI
4. Update `PROMPT_REGISTRY[family].latest` in `index.ts` to point to the new version
5. If retiring the previous latest, move it to `_archive/` (add `archive = true`, `supersededBy`, `historicalCommit`)
6. Run `node scripts/build-prompt-history.mjs` to regenerate the manifest
7. Commit manifest alongside the prompt file

**Archive file shape:**
```ts
export const version = "v1.x";
export const archive = true;
export const supersededBy = "v1.x+1";
export const historicalCommit = { sha: "<7-char>", date: "YYYY-MM-DD" };
export const meta = { version, summary, motivation, futureIdeas };
export const prompt = `...frozen text...`;
```

**Structured meta** (`PromptMeta` type in `index.ts`):
- `summary` — one-line Chinese description shown inline in the version header
- `motivation` — paragraph explaining why this version was created (what pain point it addressed)
- `futureIdeas` — array of known limitations or follow-up ideas

**Adding / Modifying Prompts**: Never hardcode prompt strings directly in API routes or logic modules. Create a new version module and update the registry pointer. Prompt changes are deployed atomically with code, reviewable in git, testable offline.

**Version immutability**: Once committed, a version file must not be modified. A `commitCount > 1` warning appears in `/admin/prompts` when this invariant is violated.

**Admin browser**: `/admin/prompts` — build-time git history manifest at `src/lib/prompts/_history.generated.json`, regenerated by `scripts/build-prompt-history.mjs` on every `npm run build` and `npm run dev`. Shows all live + archive versions, commit metadata, structured meta (改动说明), source chip, and full prompt text. CI uses `fetch-depth: 0` for full history during build.

**Registry metadata helpers** (`src/lib/prompts/index.ts`): `envVarNameFor(key)`, `listPromptFamilies()`, `describeActiveVersion(key)`, `getPromptMeta(key, version?)` — used by the admin page; `getPromptMeta` gracefully returns `null` for unknown/archived families.

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
  └── GET  /api/me/nudge                       → dr_nudge card (weight-only, examples; invariant 13)

Admin (browser, is_admin=true only)
  └── GET  /api/admin/users                    → doctor list with 30-day stats
  └── GET  /api/admin/users/[doctorId]/profile    → profile overlay data (snapshot + flagged cases, computed on demand)
  └── GET  /api/admin/analytics/output-audit       → list fleet-wide AI output audits (v3, current)
  └── POST /api/admin/analytics/output-audit       → trigger new AI output audit (v3)
  └── /admin/users                             → doctor list page (row click → profile overlay)
  └── /admin/output-audits                     → fleet-wide AI output audits (v3, current)

GH Actions (ASSESSMENT_API_KEY auth)
  └── POST /api/cron/dr_nudge daily 03:00 SGT / 19:00 UTC
        → computeNudgesForActiveDoctors → upsert doctor_risk_nudges per active doctor
  └── npm run dr_nudge -- --email <e>          → on-demand single-doctor nudge (--force to bypass watermark)

Workbench header (admin only):
  └── ⚙ Settings2 icon → /admin → redirects to /admin/users
```

---

## Doctor Risk Nudge

Recurring AI caution aggregation surfaced in the workbench left sidebar.

**Two-stage pipeline:**
1. **Deterministic bucketing** (always runs; the floor): cautions from `analysis_result.cautions` + `风险与提醒` in a 14-day window back from `MAX(analyzed_at)` are keyword-matched to 8 fixed buckets. Buckets with >=3 occurrences are surfaced, sorted by count desc.
2. **DeepSeek flash rephrasing** (polish; optional): AI rephrases labels into TCM-native short labels (<=10 chars), generates professional clinical descriptions (<=30 chars), and selects verbatim examples. **If AI fails, deterministic labels and fallback descriptions are used as-is. The nudge is never empty due to AI outage.**

**Watermark trigger:** only recompute if `MAX(analyzed_at)` > stored `source_last_record_at`. Daily cron skips unchanged doctors.

**Key files:**
- `src/lib/nudge/buckets.ts` — 8 bucket definitions, `bucketCautions()`, `RECURRENCE_FLOOR=3`, `WINDOW_DAYS=14`
- `src/lib/nudge/computeNudge.ts` — `computeNudgeForDoctor()`, `computeNudgesForActiveDoctors()`
- `src/app/api/cron/dr_nudge/route.ts` — fleet-wide cron POST, `maxDuration=300`
- `src/app/api/me/nudge/route.ts` — doctor read GET (session auth + X-View-As)
- `scripts/compute-nudge.ts` — CLI: `npm run dr_nudge -- --email ...` / `--force`
- `.github/workflows/dr_nudge.yml` — daily at `0 19 * * *` (03:00 SGT)

**Database:** `public.doctor_risk_nudges` — one row per doctor, PK `doctor_id`.
RLS: doctor reads own row. `authenticated`: SELECT (RLS-gated). `service_role`: all. `anon`: nothing.

> WARNING: **Unapplied migration: `029_doctor_risk_nudges.sql`** — apply in Supabase SQL Editor before first `npm run dr_nudge` run.

**Invariant 8:** caution text → DeepSeek (permitted). Langfuse receives tokens/cost/latency only.

---

## Doctor Profile Snapshot

On-demand, admin-only snapshot of deterministic metrics per doctor. Loaded via API when admin clicks any doctor row on `/admin/users` — displayed in a fixed overlay modal.

**Overlay:** `src/app/admin/users/ProfileOverlay.tsx` (client component). Session-level React Map cache per doctorId.
**API:** `GET /api/admin/users/[doctorId]/profile` — admin auth required; calls `computeDoctorProfile()` + `findFlaggedCases()` in parallel; returns `{ snapshot, flagged, clusters }`.

**Flagged case rules (priority order; each case counted once):**
| # | Rule | Threshold | Cap | Min N |
|---|---|---|---|---|
| 1 | AI 触发辨证警示 | boolean | 10 | always |
| 2 | 非临床信息混入 | boolean | 5 | always |
| 3 | 需要复核 项目偏多 | > doctor's own P90 | 10 | 20 |
| 4 | 体查记录偏短 | < doctor's own P10 | 5 | 20 |
| + | 处方高度重复 | DeepSeek Flash clusters ≥ 3 equivalent prescriptions (top 3) | — | 20 |

`criticalRiskRate` appears inline as "触发率 X%" beside its group header. `nonClinicalRate` as "出现率 X%". `realCautionsRate` is retired from the UI.

When `totalAnalyzed < LOW_SAMPLE_THRESHOLD` (20), only boolean rules (1 & 2) fire.

**Key files:**
- `src/lib/analytics/doctorProfile.ts` — `computeDoctorProfile()`, `findFlaggedCases()`, `LOW_SAMPLE_THRESHOLD`
- `src/lib/analytics/clusterPrescriptions.ts` — DeepSeek Flash call for prescription clustering (fail-open)
- `src/app/api/admin/users/[doctorId]/profile/route.ts` — admin GET endpoint
- `src/app/admin/users/ProfileOverlay.tsx` — overlay modal

**Database:** `public.doctor_profile_snapshots` — on-demand cache, one row per doctor, PK `doctor_id`. RLS enabled; service_role only. Cache: reads `MAX(analyzed_at)`, compares to `source_last_record_at`. Miss → compute fresh, upsert.

> WARNING: **Unapplied migration: `032_doctor_profile_snapshots.sql`** — run in Supabase SQL Editor before using the profile overlay in production.

**Fallback detection:** cautions-only-fallback = `cautions.length === 1 && cautions[0] === "请结合面诊与必要检查复核后执行。"`. Real cautions are counted when this condition is false.

---

## CSS Architecture

- `src/app/globals.css` — **full canonical token set** (`--brand`, `--text`, `--text-muted`, `--bg`, `--surface`, `--border`, etc.). Always the primary source — all routes load it.
- `src/app/workbench.css` — workbench-only styles. Loaded only on `/` route.
- `src/app/admin/admin.css` — admin UI styles. Maps legacy names to canonical globals.css tokens.

Never define a token only in `workbench.css` — admin pages won't see it. Add it to `globals.css` first.

---

## Clinical Pipeline Rules

- Single-step pipeline: doctor fills structured form → POST /api/analyze → result. No organize step.
- Analyze always uses `DEEPSEEK_MODEL_FAST` (flash). No mode selector exposed to doctors.
- All clinical fields remain editable at all times — including after analysis. When clinical inputs differ from the snapshot at last analysis, the workbench shows a stale-analysis warning banner. The `analysis_stale` DB column persists this warning across page reloads.
- Metadata fields (`病案编号 Case ID`, `随访病案编号 Follow-up Case ID`, `给AI回馈 Feedback to AI`) save through the header `保存` button.
- Core analysis sections must be structurally stable — all sections always present, even if empty with a fallback string.
- Analyze output reading order: 辨证警示 (if triggered) → 重点结论 → 当前思路 → 建议优化 → 可选思路 → 风险与提醒 → 随访监测 → 证据状态.
- UI result layout: 3 columns — 判断 / 方案 / 随访监测. Plus optional 辨证警示 red banner, 重点结论 green banner, and 风险与提醒 yellow box.
- Saved history must pass through the same normalization path as fresh analysis (`ensureAnalysisResult` in `src/lib/ai/analysisResult.ts`).

### Dynamic Token Budget
- `/api/analyze` accepts an optional `maxTokens` parameter in the request body (default `1200`).
- Batch ingestion workflows and CLI pipelines must pass `maxTokens: 2500` to prevent DeepSeek completion truncation (`finish_reason: "length"`), which crashes JSON parsing with a terminal 502 error.

### 辨证警示 Diagnostic Alert
- AI field: `criticalRisk: { summary: string; highlights: string[] } | null` — present in `AnalysisJson` and `AnalysisResult`.
- Fires when AI detects a critical diagnostic inconsistency: diagnosis↔symptoms mismatch, pattern↔prescription寒热矛盾, or missed red-flag symptom.
- UI: `<DiagnosticAlertBanner>` renders above 重点结论 when `criticalRisk` is non-null. `<HighlightedText>` wraps matched phrases in `<mark class="critical-highlight">`.
- Normalization: missing or malformed field defaults to `null` (backward compat).

---

## Structured Form Fields

Doctor fills 9 visible fields. All validated by `structuredCaseSchema` in `src/lib/forms/caseSchema.ts`.

Required fields (hard-block if missing/invalid):
- `prescriptionType`: `"方药" | "针灸" | "推拿" | "综合调理"` — single-select treatment type
- `patientAge`: numeric 1-120
- `patientSex`: "男" | "女"
- `chiefComplaint`: 2-200 chars
- `currentIllness`: 5-2000 chars
- `pastHistory`: 1-1000 chars
- `physicalExam`: 2-1000 chars (tongue + pulse required)
- `diagnosis`: 2-100 chars
- `pattern`: 2-100 chars (证型)
- `prescription`: 3-2000 chars

> `doctorQuestion` has been removed from the schema, prompt, and all fixtures. Historical `form_data` rows may still contain the key — it is silently ignored.

History item display name: auto-built from `patientSex + patientAge岁 + chiefComplaint`.

**Validation:** Single-layer zod schema (hard-block). Block patterns: guaranteed efficacy (`保证`, `治愈`, `包好`), patient self-use (`我是患者`, `我自己可以吃`).

**Live validation UI:** `displayErrors` (debounced 250ms, for field borders + error messages) vs `liveErrors` (synchronous, for submit-button disabled state + handleAnalyze guard).

---

## Admin UI

Admin entry point: `⚙` icon (Settings2) in workbench header, visible only when `isAdmin=true`.

Admin guard: `src/app/admin/layout.tsx` — server-side, redirects to `/?reason=not_admin` if not admin.

Admin nav (3 tabs, `src/app/admin/AdminNav.tsx`):
- **用户** — `/admin/users` — doctor list with 30-day activity sparkline, 状态 column, last-analysis timestamp (SGT), and role badge; row click opens profile overlay
- **AI 输出审查** — `/admin/output-audits` — fleet-wide AI output audits (v3)
- **提示词** — `/admin/prompts` — GitOps prompt registry browser (see Invariant #14)

`/admin` redirects to `/admin/users`.

**Doctor profile overlay**: clicking an active doctor row opens a fixed modal (`ProfileOverlay.tsx`). Deactivated rows are not clickable (no eye icon). Eye icon keeps its confirm popup (stopPropagation prevents row click).

**状态 column**: green 已启用 / grey 已停用 pill, clickable (except admin's own row). Click opens an inline confirm popup with consequences spelled out. Uses `POST /api/admin/users/active`. Admin cannot toggle own row (client + server enforced).

**添加医生 form**: inline in the toolbar above the list. Accepts `@gmail.com` only; always creates as 医生. Duplicate email returns 409 with inline error. On success, `router.refresh()` reloads the server component.

**Self-aware admin row**: impersonation eye icon is hidden on the admin's own row. When admin opens their own profile overlay and clicks a flagged case, the new tab opens `/` (not `/?viewAs=<self>`).

**Table layout** (`admin.css`): `grid-template-columns: 320px 1fr 80px 175px 60px` (email / sparkline / role / date / actions). The sparkline is `1fr` — required for vertical column alignment across rows (each row is its own grid container).

**No per-doctor sub-pages** — discussion agenda feature is retired entirely.

Clone case: `POST /api/consultations/[id]/clone` — clones `form_data` to admin's own account.

Seeded admins: `chiaweiwoo123@gmail.com`, `ardytcm@gmail.com`. Add more via `npm run allowlist:add -- --email <e> --admin`.

---

## Legacy Goal 2 status

The old doctor-profile evaluation stack is fully retired. Removed: `evaluate-doctor.yml`, `/api/cron/evaluate-doctors`, `npm run evaluate`, all admin evaluation routes and UI. Historical rows in `analytics_doctor_evaluations` are preserved for reference only — do not wire new runtime features back to that table.

---

## AI Output Audit (Goal 1 — v3, current)

**On-demand only.** Fleet-wide audit of AI output quality across all doctors. Admin/senior-doctor use only.

- `POST /api/admin/analytics/output-audit` — triggers new audit, returns inserted row
- `GET /api/admin/analytics/output-audit?limit=20` — lists audits newest first
- `POST /api/cron/output-audit` — same logic, auth via `X-Assessment-Key`
- `.github/workflows/ai-output-audit.yml` → calls cron route

UI: `/admin/output-audits` — append-only list, each row collapsible. Old v1 rows (no `categories` key) render with legacy renderer and "v1 旧版" badge.

v3 key features: window anchored to `MAX(analyzed_at)-14d` (not wall-clock); sampling newest-first cap 100; `userFeedbackSummary` field; 6 finding categories (safety/hallucination/reliability/completeness/tone/structure); `findingKey = "category:shortName"`.

Prompts: `src/lib/prompts/registry/output-audit/v3.0.ts` — `buildPrompt()`. Library: `runOutputAudit()` in `src/lib/analytics/outputAudit.ts`.

---

## Doctor Onboarding

Admins can add doctors via the `/admin/users` UI (添加医生 button, `@gmail.com` only, always created as 医生) or via CLI:

```bash
npm run allowlist:add -- --email doctor@example.com [--admin]
npm run allowlist:add -- --email doctor@example.com --remove
```

To revoke access without deleting history: deactivate via the 状态 pill in `/admin/users`.

The doctor can then sign in via Google OAuth — Supabase matches the existing `auth.users` row by email. Sessions expire after 3 days (see Invariant §15).

---

## Historical Data Ingestion

Historical ingestion is a gated pipeline. Do not do a one-shot delete/insert/analyze flow.

**Run order**

1. `npm run hist:prepare -- --file "<excel_path>" --out-dir "output\historical_ingestion\<batch_name>"`
2. `npm run hist:validate -- --input "output\historical_ingestion\<batch_name>\pre_llm_payload.json"`
3. `npm run hist:extract -- --input "output\historical_ingestion\<batch_name>\pre_llm_payload.json" --output "output\historical_ingestion\<batch_name>\llm_sample.json" --sample 20`
4. `npm run hist:validate -- --input "output\historical_ingestion\<batch_name>\llm_sample.json"`
5. `npm run hist:upsert -- --input "output\historical_ingestion\<batch_name>\llm_sample.json" --doctor-map "scratch\historical_doctor_map.json" --dry-run`
6. After approval and migration 033, rerun `hist:upsert` with `--apply`
7. `npm run hist:verify -- --batch <batch_name> --expected "output\historical_ingestion\<batch_name>\llm_sample.json"`

Only after the sample path is approved should you run a full LLM extraction and full upsert for the month.

**Source requirements**

Required source columns: `Order Ref` or `External ID`, `Created on`, `Diagnosed By 诊断医师`, `Patient 患者`, `Age`, `Presenting Complaint 主诉`, `History of Presenting Complaint 现病史`, `Diagnosis 诊断`, `Treatment 治疗描述`, `Past Medical History 既往史`, `Medical Examination 体格检查`.

`External ID` may replace `Order Ref` only when it is a stable Odoo row id shaped like `__export__.pos_order_<number>`; use the numeric suffix as `case_id`.

Follow-up linkage must be grouped by `doctor_external_id + patient`, not patient alone.

**Date and row filtering**

- Default range is the latest 31 days by whole day, anchored on `MAX(Created on)`.
- Use `--start` / `--end` only for explicit review runs.
- Drop rows only when `Age` is unavailable or unparseable.
- If invalid-age rows are `>=10%` of the selected window, stop and fix the export instead of dropping them.

**Pre-LLM responsibilities**

`scratch/clean_historical_data.py` is deterministic only. It may validate columns, filter the day-based window, derive identifiers, emit placeholder doctor email hints like `users_129@gmail.com`, strip obvious billing/admin noise, and normalize limited non-clinical fallbacks such as `无` and `未见异常`.

It must not pretend keyword parsing is final clinical extraction.

**LLM responsibilities**

DeepSeek Flash does the intelligent restructuring for `chiefComplaint`, `currentIllness`, `diagnosis`, `pattern`, `prescriptionType`, `prescription`, `pastHistory`, `physicalExam`, and `patientSex`.

`hist:extract` should prefer batched calls, with bounded parallelism, retries, resumable output, and single-row fallback for failed batches. Do not log full clinical text.

**Doctor identity for import**

Placeholder emails such as `users_129@gmail.com` are acceptable for historical review, but inserts still require real Supabase Auth rows because `consultations.doctor_id` references `auth.users(id)`.

Use `scratch/historical_doctor_map.json` to map source doctor ids to placeholder or real emails. The upsert script is responsible for creating placeholder Auth users when needed and then resolving `doctor_id`.

**Post-push verification**

Every apply run must be followed by `hist:verify`. Verify expected rows vs inserted/upserted rows, duplicate `(doctor_id, case_id)` count = 0, broken `related_case_id` links = 0, required `form_data` fields present, and counts by doctor/date range aligned with the validated payload.

---

## Database Schema

Migrations: `supabase/migrations/` (numbered SQL). **Committing a migration file does NOT apply it — every file must be manually run in the Supabase SQL Editor.**

| Table | Purpose |
|---|---|
| `consultations` | Doctor history — form_data JSONB, analysis JSON, model meta, optional `case_id` and `ai_feedback`. Has `doctor_id` UUID FK (migration 016) with RLS (migration 017). `analysis_stale` boolean (migration 027). |
| `consultation_change_events` | Append-only audit log of every `consultations` UPDATE. Written by Postgres trigger (migration 026). |
| `error_logs` | Pipeline errors (no form field values) |
| `doctor_allowlist` | `email`, `is_active`, `is_admin` — access control source of truth |
| `activity_logs` | Doctor activity events (login, analyze) — no UI for now |
| `analytics_doctor_evaluations` | Legacy Goal 2 evaluation output. No active runtime code should depend on it. |
| `analytics_output_audits` | Fleet-wide AI output audits (Goal 1 v3). No RLS. Append-only. Renamed from `analytics_session_reviews` via migration 028. |
| `doctor_profile_snapshots` | On-demand cache for admin profile overlay. One row per doctor, PK `doctor_id`. RLS enabled; service_role only. See migration 032. |
| `doctor_risk_nudges` | One row per doctor, PK `doctor_id`. Created by migration 029. |

> **Unapplied migrations (must be run in Supabase SQL Editor):**
> - `022_drop_analytics_and_assessments.sql` — drops legacy tables
> - `023_session_reviews_and_eval_cleanup.sql` — prerequisite for 028
> - `028_rename_session_reviews_to_output_audits.sql` — **must run before new audits or admin page can load**
> - `029_doctor_risk_nudges.sql` — **must run before first `npm run dr_nudge`**
> - `031_drop_doctor_discussion_agenda.sql` — drops retired table
> - `032_doctor_profile_snapshots.sql` — enables profile overlay cache
> - `033_consultations_doctor_case_unique.sql` — required before historical `hist:upsert --apply`
> - `034_doctor_allowlist_last_signin.sql` — **required for 3-day session expiry to work**; adds `last_signin_at` column and backfills existing rows with `now()`

`consultations`: doctor reads use user-scoped Supabase client (anon key + session JWT); RLS enforces isolation. Admin routes use service_role (bypasses RLS). Never expose service_role key to browser.

---

## Langfuse Integration

SDK v3 API. Per analyze call, `trace.generation()` receives:

- **`usage`** — `{ input, output, total, unit: "TOKENS" }` — this is what Langfuse reads for display.
- **`usageDetails`** — `{ cacheHit, cacheMiss }` (prompt_cache_hit/miss_tokens from DeepSeek).
- **`costDetails`** — `{ input: inputCostUsd, output: outputCostUsd, total: totalCostUsd }` — computed locally (DeepSeek not in Langfuse model registry).
- **`metadata`** — model, latency, prompt version, prescriptionType label, repairedJson flag.

Always send all three fields. Defaults: `HIT_PER_M=0.07`, `MISS_PER_M=0.27`, `OUT_PER_M=1.10` USD/1M tokens. Override via `DEEPSEEK_PRICE_INPUT_HIT`, `DEEPSEEK_PRICE_INPUT_MISS`, `DEEPSEEK_PRICE_OUTPUT`. `LANGFUSE_BASE_URL` defaults to `https://jp.cloud.langfuse.com`.

**No clinical text ever reaches Langfuse.**

---

## Common Pitfalls

**Chinese text becomes mojibake / garbled (`???`, `â€¦`, `æ²¡`)**
- Treat as an implementation bug. Stop and fix encoding before continuing.
- Prefer UTF-8-safe edits. After editing Chinese files, search for mojibake markers: `???`, `â€`, `æ`, `ç`, `ä¸`, `�`.
- Do not commit garbled Chinese text.

**Tiny Chinese UI / option changes**
- Keep the diff proportional. For simple label additions, change only the source of truth and direct display logic.
- Use `apply_patch` for Chinese text. Do not use PowerShell/Node/Python mechanical rewrites on Chinese files for tiny edits.
- Verification: inspect `git diff`, search for mojibake markers, run the smallest relevant test.

**Push rejected (non-fast-forward)**
```
git fetch origin main && git rebase origin/main && git push origin HEAD:main
```

**Cannot rebase: unstaged changes**
```
git stash && git rebase origin/main && git stash pop && git push origin HEAD:main
```

**`ASSESSMENT_API_KEY` missing** — Add to `.env.local` and Vercel env vars.

**GitHub Actions secrets** — Registered: `ASSESS_BASE_URL` and `ASSESSMENT_API_KEY`. There is no `CRON_SECRET` or `VERCEL_PRODUCTION_URL`.

**Migration file committed but not applied** — Committing `.sql` has no effect on the live DB. Check the unapplied migrations list above before assuming a schema change is live.

**`dr_nudge` skips doctors unexpectedly** — Check `source_last_record_at` vs `MAX(analyzed_at)`. Use `--force` to bypass watermark intentionally.

**DeepSeek returns malformed JSON** — Expected; repair is built in. Check `repairedJson: true` in logs.

**AI references a billing line / gym record as clinical data** — The `输入清洗与保留` block in `tcm-analysis` prompt (v1.3+) was edited out or a new noise pattern appeared. Fix: add the new pattern variant to a new version module, bump `latest` in `index.ts`.

**Admin pages can't see brand CSS variables** — Tokens must be in `globals.css`, not only in `workbench.css`.

**Langfuse shows $0 cost / missing token counts** — Must send all three: `usage` (tokens), `usageDetails` (cache breakdown), `costDetails` (explicit USD). Tokens in only `usageDetails` never reach the cost engine.

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
3. **`022_drop_analytics_and_assessments.sql`** — apply in production
4. **`023_session_reviews_and_eval_cleanup.sql`** — apply in production (prerequisite for 028)
5. **`028_rename_session_reviews_to_output_audits.sql`** — apply in production (required before new audits can write or admin page can load)
6. **`031_drop_doctor_discussion_agenda.sql`** — apply in production
7. **`032_doctor_profile_snapshots.sql`** — apply in production to enable profile overlay cache
8. Phase 2: doctor-facing surface (doctorFacingHint removed from v1.1 schema; revisit if needed)
9. AI Output Audit pipeline: records where `analysis_stale=true` have mismatched form_data/analysis_result — may cause false "hallucination" findings. Consider filtering.
10. Clone case button in workbench viewAs header — planned but not yet implemented.
