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

`/api/organize` and `/api/analyze` require either:
- A valid Supabase session cookie (doctor via browser), OR
- `X-Assessment-Key` header matching `ASSESSMENT_API_KEY` env var (calibration CLI)

Neither → 401. Enforced by `src/lib/apiAuth.ts` called at the top of both routes.
`ASSESSMENT_API_KEY` must be set in Vercel env vars, `.env.local`, and GitHub Actions secrets.

### 4. DEV_AUTH_BYPASS must never reach production

Guard is in `src/lib/auth.ts → assertDevBypassIsLocalOnly()`. It throws if `NODE_ENV !== "development"`. Never remove this check. Never add `NEXT_PUBLIC_DEV_AUTH_BYPASS`.

### 5. Doctor allowlist is source of truth for access

Read from Supabase `doctor_allowlist` table first. Fall back to `ALLOWED_DOCTOR_EMAILS` env var only when Supabase is unreachable. Signed-in but non-allowlisted users must be signed out immediately with a Chinese message.

### 6. Organize draft ceiling is 8000 characters

Enforced by `src/lib/inputLimits.ts → validateDraftLength()`. Reject before any AI call. Do not raise this limit without reviewing prompt token budgets.

### 7. Prompt contract is strict JSON — repair before failing

If DeepSeek returns malformed JSON, attempt syntax-only repair before returning an error. Never silently drop data. `repairedJson: true` flag must be logged when repair occurs.

### 8. Update AGENTS.md and README.md when behavior changes

Any meaningful change to product behavior, architecture, security rules, or calibration workflow must be reflected in this file before the session ends. README updates are required when user-visible behavior changes.

---

## Product Purpose

Doctor-facing TCM clinical workbench. Not patient-facing.

Helps registered TCM doctors:
- Write or paste rough case drafts
- Organize drafts into structured clinical context
- See completeness guidance before analysis goes too far
- Receive simplified-Chinese clinical review output
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
- UI: focused CSS + `lucide-react`
- Validation: `zod` plus dedicated guardrail helpers in `src/lib/caseValidation.ts`
- Auth and data: Supabase (Google OAuth, allowlist, JSONB storage)
- AI provider: DeepSeek only, through server-side routes (`src/app/api/`)

---

## Architecture

```
Doctor (browser)
  └── POST /api/organize    → DeepSeek fast model → structured form + completeness hints
  └── POST /api/analyze     → DeepSeek analyze model → clinical review JSON
  └── /api/consultations/*  → Supabase (save / load / delete history)

Calibration CLI (local machine)
  └── assess:run   → hits live Vercel app with X-Assessment-Key → saves raw_results to DB
  └── assess:review (GitHub Actions) → reads DB → 3-stage DeepSeek pro review → updates DB

Admin UI
  └── /admin/assessments      → calibration run list
  └── /admin/assessments/[id] → full report (pipeline stats + scorecards + final synthesis)
  └── /admin/usage            → api_call_logs cost/token view
```

---

## Clinical Pipeline Rules

- Two-step pipeline always: `organize` → `analyze`. Never skip organize.
- Doctor-facing UI always uses `常规` (normal) mode. `智能` (smart) mode is internal-only — calibration and future admin use only. Do not expose the mode selector to doctors.
- Organize uses fast model. Analyze uses `DEEPSEEK_MODEL_ANALYZE`, falls back to `DEEPSEEK_MODEL_FAST`.
- Core analysis sections must be structurally stable — all sections always present, even if empty with a fallback string.
- Analyze output reading order: 重点结论 → 病案摘要 → 资料完整性 → 当前思路 → 建议优化 → 可选思路 → 风险与提醒 → 随访监测 → 证据状态.
- Saved history must pass through the same normalization path as fresh analysis (`ensureAnalysisResult` in `src/lib/ai/analysisResult.ts`).

---

## Stage-One Clinical Guardrails

Hard-block minimum before analysis:
- `主诉`
- `当前方案`
- At least one timeline clue: `病程` or `病史与治疗反应`
- Either an explicit `医生问题`, or a reviewable treatment plan with enough clinical basis

Type-specific:
- `方药分析`: must include `方药内容`
- `针灸方案`: must include `穴位与操作` OR concrete manual treatment in `当前方案`
- `综合调理`: must include herbs, acupoints, OR concrete manual/physical treatment

Block patterns: vague prompts (`帮我看看`), guaranteed efficacy (`保证`, `治愈`, `包好`), patient self-use (`我是患者`, `我自己`, `我可以吃`).

---

## Clinical Style

- Persona: senior, pragmatic, supportive TCM colleague. Not a grader.
- Preserve reasonable parts first, then suggest improvements.
- Prefer 1-3 high-impact suggestions over long lists.
- No guaranteed cure language. No fabricated citations.

---

## Database Schema

Migrations: `supabase/migrations/` (numbered, idempotent SQL). Applied manually in Supabase SQL editor.

| Table | Purpose |
|---|---|
| `consultations` | Doctor history — draft, organized JSON, analysis JSON, validation result, model meta |
| `api_call_logs` | Per-call operational metrics — model, tokens, cost, latency, rates_snapshot JSONB |
| `error_logs` | Pipeline errors |
| `doctor_allowlist` | `email`, `is_active`, `is_admin` — source of truth for access control |
| `assessment_runs` | Calibration runs — see columns below |

`assessment_runs` columns:
- `run_id`, `mode` (`normal`\|`smart`), `triggered_by`, `status` (`raw`→`reviewed`)
- `organize_stats`, `mode_stats`, `blocked_reason_groups` — aggregate stats JSONB
- `raw_results` — full per-example pipeline data (organize response + analyze result per example)
- `example_reviews` — per-example DeepSeek pro scorecards (stage 1)
- `section_reviews` — per-section consistency analyses (stage 2)
- `reviewer_text` — final synthesis with doctor brief (stage 3)
- `reviewer_model`, `base_url`, `example_count`, `created_at`

All tables: service_role key only. No anon/user RLS. Never expose service_role key to browser.

---

## Admin Role

- `is_admin` boolean on `doctor_allowlist`.
- Admin check: `isAdminDoctorEmail()` in `src/lib/auth.ts`.
- Admin guard: `src/app/admin/layout.tsx` — server-side, redirects to `/?reason=not_admin`.
- Admin pages: `/admin/assessments`, `/admin/assessments/[runId]`, `/admin/usage`.
- Only `chiaweiwoo123@gmail.com` is seeded as admin.

---

## Calibration Workflow

Calibration = running the pipeline on real doctor examples, reviewing outputs with AI, using the report to improve prompts. Internal only — not doctor-facing.

**Philosophy:** Developer is not a TCM expert. AI does the heavy reading, finds patterns, and produces a report the developer can act on. The report also includes a doctor-ready brief so expert consultation is focused and efficient. Each run tightens the loop: run → AI reviews → developer reads → developer + AI refine prompts → re-run → compare.

### Step 1 — `npm run assess:run` (local)

```bash
npm run assess:run -- --mode normal   # or --mode smart
```

- Reads examples from `local-data/real-doctor-examples.md` (gitignored, local only)
- Hits live Vercel app (`ASSESS_BASE_URL`) with `X-Assessment-Key` header
- Runs organize → analyze for all examples in parallel (`Promise.all`)
- Run ID format: `assessment-YYYY-MM-DD_HH-MM-SS-SGT-{mode}`
- Saves raw results to `assessment_runs` with `status: raw`
- Prints `run_id` — use in Step 2

Run once per mode to compare. Two rows in DB, two reports in admin UI.

### Step 2 — GitHub Actions "Assess Review"

Triggered via `workflow_dispatch` → input `run_id`. Three stages:

**Stage 1 + 2 (parallel — `Promise.all`):**
- Per-example scorecards: full output for each example → DeepSeek pro → compact structured verdict (整理质量, 分析量, 实用性, 内部重复, 情感基调, 整体判断, 具体问题)
- Per-section consistency: each output section across all examples → DeepSeek pro → sentiment drift, templating, depth variance

**Stage 3 (after 1+2):**
- Final synthesis → DeepSeek pro → executive summary, main findings, cross-example patterns, prompt improvement directions, priority actions (urgent/medium/good to have), doctor brief

All review calls use DeepSeek pro. Plain `Promise.all` — no orchestration framework.

Saves `example_reviews`, `section_reviews`, `reviewer_text` to DB. Status → `reviewed`.

---

## Local Working Data

- `local-data/real-doctor-examples.md` — canonical example source (gitignored)
- `local-data/real-doctor-examples-notes.md` — supporting notes (gitignored)
- Parse markdown directly in scripts. Do not maintain parallel JSON copies.

---

## Model And Pricing Rules

- Organize: fast model (`DEEPSEEK_MODEL_FAST`)
- Analyze: `DEEPSEEK_MODEL_ANALYZE`, fallback to `DEEPSEEK_MODEL_FAST`
- Calibration review: all stages use DeepSeek pro
- AI pricing is hardcoded in `config/rates.json`. Updated automatically by `.github/workflows/update-rates.yml` (daily, Claude web search). When updating manually, update the `_comment` date field.
- Cost logging uses `rates_snapshot` JSONB per `api_call_logs` row — captures exact rate at call time. Never derive cost retroactively from current rates.
- Token usage and cost are internal only — never shown to doctors.

---

## Logging Rules

Log per API call: route, model, success, latency, token counts (prompt/completion/cache hit/miss), cost, rates snapshot, prompt version, metadata. Do not log draft content or analysis output in `api_call_logs` — that belongs in `consultations`.

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
The assessment HTTP client (`scripts/lib/assessment/http.mjs`) throws early if the key is absent. Add it to `.env.local`.

**DeepSeek returns malformed JSON**
Expected — repair is built in. Check `repairedJson: true` in logs. If repair triggers consistently, the prompt output format needs tightening.

**Organize succeeds but analyze returns 401**
Both routes require auth. If running assess:run against a Vercel deployment that doesn't yet have `ASSESSMENT_API_KEY` set, redeploy after adding the env var.

**`local-data/` not found in worktree**
The worktree doesn't inherit gitignored files. Copy from main project dir:
```
copy ..\..\..\..\..\local-data\real-doctor-examples.md local-data\
```

---

## Documentation Direction

- `README.md` is in simplified Chinese. Technical terms (env vars, CLI commands, routes, model names) stay in English.
- Keep README minimal. Do not add sections unless the user asks.
- Update README when user-visible behavior meaningfully changes.
- Update AGENTS.md whenever architecture, security rules, or calibration workflow changes.

---

## Audit Checklist Before Saying "Done"

1. Fresh run path (organize → analyze → save)
2. Load saved history path
3. Blocked stage-one path
4. Partial organize path (organize ok, analyze blocked)
5. Final analysis path
6. Docs synced (AGENTS.md + README if needed)
7. CI green (`gh run list --limit 1`)

Do not say done until the changed path is verified, not merely coded.

---

## Deferred Scope

1. Doctor feedback capture — accepted/rejected suggestion tracking
2. External citation retrieval layer
3. Side-by-side calibration run comparison view (normal vs smart)
4. Scheduled calibration runs (currently manual trigger)
