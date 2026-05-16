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

### 10. Assessment samples live in DB only — never in the codebase

Sample records for testing are stored exclusively in the `assessment_samples` Supabase table. The CSV source file is local-only and gitignored. Do not add sample data to any TypeScript file or config file.

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
- Branding: `src/lib/branding.ts` — `BRANDING.name/subtitle/icon` used in header and login
- Validation: `zod` schema in `src/lib/forms/caseSchema.ts` (`structuredCaseSchema`, `StructuredCaseForm`)
- Auth and data: Supabase (Google OAuth, allowlist, JSONB storage)
- AI provider: DeepSeek only, through server-side routes (`src/app/api/`)

---

## Architecture

```
Doctor (browser)
  └── POST /api/analyze        → DeepSeek flash model → clinical review JSON (3-column layout)
  └── /api/consultations/*     → Supabase (save / load / delete history)

Admin (browser, is_admin=true only)
  └── GET /api/admin/samples   → returns assessment_samples rows
  └── /admin/assessments       → assessment job list (future: trigger runs)
  └── /admin/examples          → read-only sample library view

Workbench header (admin only):
  └── ⚙ Settings2 icon → /admin
  └── 🧪 样本 button  → samples panel (lazy-loads /api/admin/samples, populates form)
```

---

## CSS Architecture

- `src/app/globals.css` — shared brand tokens (`--brand`, `--brand-dark`, `--brand-mid`, `--brand-light`, `--brand-tint`, `--surface`, `--border`, `--border-strong`). Must be the canonical source so admin routes (which don't load `workbench.css`) can use brand colors.
- `src/app/workbench.css` — workbench-only styles. Loaded only on `/` route.
- `src/app/admin/admin.css` — admin UI styles. Relies on tokens from `globals.css`.

Never define brand tokens only in `workbench.css` — admin pages won't see them.

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
- 方案 column: blue header (`result-column--blue`)
- 随访监测 column: yellow header (`result-column--yellow`)

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

**Live validation UI:** `liveErrors` via `useMemo(() => getFormErrors(form), [form])`. Errors show once field is touched (`touched` set). Submit button disabled when any live error present. Fields show green border when valid, red when errored.

---

## CRUD State Machine (Status Bar)

`SaveStatus = "new" | "unsaved" | "saving" | "saved"`

| Trigger | Transition |
|---|---|
| `handleNew()` | → `"new"`, `savedAt = null` |
| `setField(...)` | → `"unsaved"` (unless currently `"saving"`) |
| `handleSelectHistory` success | → `"saved"`, `savedAt = record.updated_at` |
| `handleLoadSample` | → `"new"`, `savedAt = null` (not a consultation yet) |
| `handleAnalyze` / `handleSave` start | → `"saving"` |
| save success | → `"saved"`, `savedAt = new Date()` |
| save failure | → `"unsaved"` |

Status bar renders below submit button inside `form-card`. Toast fires on: analyze error, save success/failure, delete, history load success/failure, sample load.

---

## Admin UI

Admin entry point: `⚙` icon (Settings2) in workbench header, visible only when `isAdmin=true`.

Admin guard: `src/app/admin/layout.tsx` — server-side, redirects to `/?reason=not_admin` if not admin.

Admin nav (2 tabs, `src/app/admin/AdminNav.tsx`):
- **评估记录** — `/admin/assessments` — assessment job list
- **样本库** — `/admin/examples` — read-only sample library

`AdminNav` is a client component (needs `usePathname()` for active link highlighting). Admin layout is a server component.

Token usage: tracked in Langfuse only. No admin page for it.
Activity logs: written to Supabase `activity_logs` but no admin UI page for now.

Only `chiaweiwoo123@gmail.com` is seeded as admin.

---

## Assessment Samples

10 real doctor case samples for pipeline testing. Live in `assessment_samples` Supabase table only.

**To seed:** Run `supabase/migrations/013_assessment_samples.sql` once in Supabase SQL editor.
**To add/disable:** Edit rows directly in Supabase table editor (`is_active = false` to hide without deleting).
**Never store sample data in the codebase** — no TypeScript arrays, no CSV in git.

Admin shortcut in workbench:
- `🧪 样本` button (header, admin only) → opens samples panel
- Panel lazy-loads from `GET /api/admin/samples` on first open
- Clicking a sample populates all form fields; `saveStatus` resets to `"new"`; toast confirms load
- Doctor can then submit immediately for analysis

---

## Database Schema

Migrations: `supabase/migrations/` (numbered SQL). Applied manually in Supabase SQL editor.

| Table | Purpose |
|---|---|
| `consultations` | Doctor history — form_data JSONB, analysis JSON, model meta |
| `api_call_logs` | Per-call operational metrics — model, tokens, cost, latency |
| `error_logs` | Pipeline errors (no form field values) |
| `doctor_allowlist` | `email`, `is_active`, `is_admin` — access control source of truth |
| `activity_logs` | Doctor activity events (login, analyze) — no UI for now |
| `assessment_samples` | Test case library (migration 013) — seeded from CSV, admin-only read |
| `assessment_jobs` | Assessment run tracking (migration 013) — future use |
| `assessment_job_results` | Per-sample results per job (migration 013) — future use |
| `assessment_runs` | Old calibration runs (legacy — not actively used) |
| `doctor_examples` | Old example library (legacy — superseded by assessment_samples) |

All tables: service_role key only. No anon/user RLS. Never expose service_role key to browser.

---

## Langfuse Integration

SDK v3 API. Per analyze call, Langfuse receives:
- `usageDetails`: `{ input, output, total, cacheHit, cacheMiss }` (token counts)
- `costDetails`: `{ total }` (USD cost)
- `metadata`: model, latency, prompt version, prescriptionType label, repairedJson flag

**No clinical text ever reaches Langfuse.** Token usage and cost are monitored at `jp.cloud.langfuse.com`.

Env var: `LANGFUSE_BASE_URL` — defaults to `https://jp.cloud.langfuse.com` if not set.

---

## Model And Pricing Rules

- Analyze: `DEEPSEEK_MODEL_FAST` (flash). No other model exposed to doctors.
- AI pricing is hardcoded in `config/rates.json`. Updated automatically by `.github/workflows/update-rates.yml` (daily). When updating manually, update the `_comment` date field.
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

**`ASSESSMENT_API_KEY` missing in CLI**
The assessment HTTP client throws early if the key is absent. Add it to `.env.local`.

**DeepSeek returns malformed JSON**
Expected — repair is built in. Check `repairedJson: true` in logs. If repair triggers consistently, the prompt output format needs tightening.

**Admin pages can't see brand CSS variables**
Brand tokens (`--brand`, etc.) must be defined in `globals.css`, not only in `workbench.css`. `workbench.css` only loads on `/` route.

**`assessment_samples` table missing**
Run `supabase/migrations/013_assessment_samples.sql` in Supabase SQL editor.

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
3. Load sample path (admin only, form populated, status → "新病案")
4. Blocked path (invalid form → submit disabled)
5. Save/delete via toolbar
6. Admin nav accessible from workbench header (⚙ icon, admin only)
7. Docs synced (AGENTS.md + README if needed)
8. CI green (`gh run list --limit 1`)

Do not say done until the changed path is verified, not merely coded.

---

## Deferred Scope

1. Doctor feedback capture — accepted/rejected suggestion tracking
2. External citation retrieval layer
3. Assessment job runner — admin triggers a run from `/admin/assessments`, results saved to `assessment_jobs` + `assessment_job_results`
4. Assessment results UI — `/admin/assessments/[jobId]` showing per-sample analysis output
