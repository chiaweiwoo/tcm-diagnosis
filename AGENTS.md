# TCM Diagnosis - AI Session Memory

This file records durable product and engineering rules for future coding agents.
Keep it aligned with shipped behavior.

## Product Purpose

This is a doctor-facing TCM clinical workbench.
It is not patient-facing.

The tool helps registered TCM doctors:
- write or paste rough case drafts
- organize drafts into structured clinical context
- see supportive completeness guidance before analysis goes too far
- receive simplified-Chinese clinical review output
- save consultation history for later comparison and improvement

## Collaboration Preferences

- Chat with the project owner in English.
- Product UI, validation messages, stored labels, and AI output must use simplified Chinese.
- Favor practical, compact workflows over broad setup complexity.
- Think from the doctor's reading flow first; usability matters as much as model quality.
- Default to a continuous workbench: draft on top, organized or analyzed output below.
- Use smaller commits when making larger changes so debugging and review stay tractable.

## Branch And Delivery Rules

- Use a single-branch workflow on `main` unless the user explicitly asks otherwise.
- Do not describe a feature as done unless it is committed, pushed, and reflected in the running UI or CLI behavior.
- Update `AGENTS.md` and `README.md` when product behavior meaningfully changes.
- After significant UI or route changes, run `npm.cmd run build`.
- Run `npm.cmd run test` when validation, parsing, or state flow changes.

## Stack

- Frontend: Next.js + TypeScript on Vercel
- UI: focused CSS + `lucide-react`
- Validation: `zod` plus dedicated guardrail helpers
- Auth and data: Supabase
- AI provider: DeepSeek only, through server-side routes

## Security And Access Invariants

1. Never expose DeepSeek keys or Supabase service-role keys to frontend code.
2. No `NEXT_PUBLIC_DEEPSEEK_*` environment variables.
3. OAuth is required before entering the workbench.
4. Doctor allowlist should be read from Supabase `doctor_allowlist` when available, with `ALLOWED_DOCTOR_EMAILS` as fallback only.
5. Unauthenticated access to `/` must redirect to `/login`.
6. Signed-in but non-allowlisted users must be signed out and shown a Chinese authorization message.
7. A dev-only auth bypass is allowed strictly for local UI testing when:
   - `NODE_ENV === "development"`
   - `DEV_AUTH_BYPASS === "true"`
   - `DEV_AUTH_EMAIL` is present and still passes the doctor allowlist check
8. The dev-only bypass must never be honored in production or preview deployments.
9. Server routes must reject overlong drafts before any AI call is made. The current organize draft ceiling is `8000` characters.

## Stage-One Clinical Guardrails

Hard-block minimum before analysis:
- `主诉`
- `当前方案`
- at least one timeline clue: `病程` or `病史与治疗反应`
- either:
  - an explicit `医生问题`, or
  - a clearly reviewable current treatment plan with enough clinical basis to infer review intent

Type-specific:
- `方药分析`: must include `方药内容`
- `针灸方案`: must include `穴位与操作` OR concrete manual treatment in `当前方案` (e.g., 推拿, 按摩, 正骨, 手法, 艾灸)
- `综合调理`: must include herbs, acupoints, OR concrete manual/physical treatment described in `当前方案`

Block patterns:
- vague prompt with no implied review intent, such as `帮我看看`
- guaranteed efficacy wording such as `保证`, `治愈`, `包好`, `一定好`
- patient self-use wording such as `我是患者`, `我自己`, `我可以吃`, `我该怎么办`

Recommended-but-not-hard-block fields:
- `年龄`
- `性别`
- `体质与生活背景`
- `舌脉与四诊要点`
- more specific treatment history or treatment response
- case-type-specific details such as PCOS cycle markers, acupuncture frequency/method, or GI stool/tongue details

## Clinical Style

- Persona should feel like a senior, pragmatic, supportive TCM colleague.
- Preserve reasonable parts first, then suggest what could be improved.
- Prefer 1-3 high-impact suggestions over long lists.
- Avoid guaranteed cure language.
- Do not fabricate citations.
- Output should help doctors feel more confident and better supported, not graded.

## Pipeline And Reliability Rules

- Keep the two-step pipeline:
  1. `organize`
  2. `analyze`
- Progressive UI is required:
  - show organize-stage completeness guidance as soon as organize finishes
  - continue elapsed time through the full run
  - stop before analyze if validation hard-blocks the case
  - keep the right-side panel as a merged `研判状态 + 资料完整性` surface
  - when organize is ready but analysis is not yet available, show an intermediate organize result panel in the main workspace
  - while analyze is running, show a visible loading shell in the main lower workspace so doctors can tell the second stage is still progressing
  - after analysis completes, the right-side panel should return to workflow summary only and should not duplicate the main `资料完整性` content
- Review mode:
  - doctor-facing UI does NOT show a `智能 / 常规` switch; it is hidden
  - doctor-facing runs always use `常规` (normal) as the default internal mode
  - `智能` mode is preserved in code but is internal-only: used by backend assessment and future admin workflows
  - do not expose the mode selector to doctors or restore it from localStorage
  - header shows the active doctor-facing model as a subtle meta label (e.g., `当前模型：deepseek-v4-flash`)
- Analyze output should follow this reading order:
  1. `重点结论`
  2. `病案摘要`
  3. `资料完整性`
  4. `当前思路`
  5. `建议优化`
  6. `可选思路`
  7. `风险与提醒`
  8. `随访监测`
  9. `证据状态`
- Prompt contract is strict JSON.
- `舌脉与四诊要点` is a first-class field in organize, validation, and prompt construction.
- Organize prompt should preserve an empty `医生问题` when the draft did not explicitly ask one; do not auto-fill a fake generic question.
- When doctors ask for research or literature support and retrieval is unavailable, respond as experiential review and state that external retrieval is not yet connected.
- If DeepSeek returns malformed JSON, use syntax-only repair before failing.
- Prefer defensive normalization over brittle shape assumptions.
- Core analysis sections should remain structurally stable; avoid a doctor seeing major sections appear in one case and disappear in another just because the model returned fewer bullets.
- Saved history must be normalized through the same result-shaping path as fresh analysis.

## Model And Latency Rules

- Organize call should use the fast model path.
- Analyze call should default to `DEEPSEEK_MODEL_ANALYZE`, then fall back to `DEEPSEEK_MODEL_FAST`, not the deep model by default.
- Deep model can still be used for repair fallback when fast repair fails.
- Cost logging must reflect the actual model tier used for the call.
- DeepSeek pricing changes over time, so pricing should be overridable through environment configuration rather than treated as permanently fixed.
- Keep analyze outputs concise; long completions are a common latency problem.
- Show elapsed time during runs and on loaded history.
- Token usage and estimated cost must stay internal only.

## Logging And Storage

Store or log, where applicable:
- doctor email
- draft
- organized JSON
- analysis JSON
- raw model JSON
- validation result
- blocked reasons
- model
- prompt version
- latency
- token usage
- estimated cost
- duration when available

Logging should not block doctor-facing responses.

## Consultation History

- History is scoped by logged-in doctor email.
- `consultations` uses JSONB for flexible evolving payloads.
- Optional `consultation_name` displays as timestamp + name; unnamed records show timestamp only.
- The consultation-name placeholder must read like a placeholder, not a real patient record.
- Doctors can save, reopen, rename, edit, regenerate, and delete records.
- Editing a draft clears the current analysis and requires regeneration.

## Local Working Data

- Real doctor example drafts used for local prompt/guardrail review should live in markdown, not parallel JSON copies.
- Canonical local example source: `local-data/real-doctor-examples.md`
- Supporting local note file: `local-data/real-doctor-examples-notes.md`
- If future scripts need these examples, parse the markdown source directly instead of maintaining a second serialized copy that can drift.

## Assessment Workflow

- Assessment is CLI-first, not a doctor-facing feature.
- Current active assessment path is backend-only:
  - `npm.cmd run assess:backend`
- Backend assessment should:
  - load local real-doctor examples
  - reuse an existing local dev server when possible, or start one with dev bypass
  - run organize/analyze for both `智能` and `常规`
  - generate Markdown + JSON reports under `output/assessment/<run-id>/`
  - use DeepSeek to produce backend review commentary and prompt-improvement suggestions
  - report includes: organize success rate, per-mode success/blocked/failed/repair counts, blocked reason groups, per-example `repairedJson` flag
- `智能` mode is preserved in assessment to track reliability vs `常规`; assessment is the primary tool for observing mode tradeoffs
- Frontend automation assessment is explicitly deferred to backlog until the user says to resume it.

## Design Direction

- Warm clinic red and off-white palette.
- Avoid sudden green or blue accents.
- Compact workbench, not a marketing landing page.
- Keep author and repository attribution in the dashboard, not the README.
- Prefer kanban/dashboard-style analysis grouping over document-style sprawl.
- Keep a visible help surface in the dashboard so doctors can understand workflow assumptions without reading external docs.
- Show a visible build label in the UI so deployed-version checks are easy.
- When local dev bypass is active, show a clear in-product indicator such as `本地开发模式`.
- The mission line is part of the product identity:
  - `让医生看得更全，记得更准，面对难题时不再孤单。`

## Audit Checklist Before Saying "Done"

Always check all applicable paths after meaningful changes:

1. fresh run path
2. load saved history path
3. blocked stage-one path
4. partial organize path
5. final analysis path
6. docs sync
7. deploy/build marker visible when relevant

Do not say "done" until the changed path is verified, not merely coded.
Use [docs/agent-audit-checklist.md](docs/agent-audit-checklist.md) as the concrete release-path checklist.
Project-local reusable workflow notes also live in [codex-skills/tcm-workbench-audit/SKILL.md](codex-skills/tcm-workbench-audit/SKILL.md).
Batch C recovery notes live in [docs/batch-c-handoff.md](docs/batch-c-handoff.md).

## Documentation Direction

- `README.md` is product-facing.
- Explain what the tool helps doctors do.
- Keep setup and operational notes concise.
- Mention the two-step pipeline, organize-stage stop behavior, internal-only token/cost tracking, allowlist source, review-mode selector, and backend assessment CLI.
- Document the local dev auth bypass in `.env.local.example` and keep the explanation brief and explicit.

## Deferred Scope

1. Frontend automation assessment CLI
2. Doctor feedback capture and accepted/rejected suggestion tracking
3. External citation retrieval layer
4. Regression comparison dashboard across prompt/model versions
