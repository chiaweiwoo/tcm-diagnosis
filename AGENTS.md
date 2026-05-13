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

## Branch And Delivery Rules

- Use a single-branch workflow on `main` unless the user explicitly asks otherwise.
- Do not describe a feature as done unless it is committed, pushed, and reflected in the running UI.
- Update `AGENTS.md` and `README.md` when product behavior meaningfully changes.
- After significant UI changes, run `npm.cmd run build` and verify the local dashboard in-browser when feasible.

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

## Stage-One Clinical Guardrails

Hard-block minimum before analysis:
- `主诉`
- `当前方案`
- `医生问题`
- at least one timeline clue: `病程` or `病史与治疗反应`

Type-specific:
- `方药分析`: must include `方药内容`
- `针灸方案`: must include `穴位与操作`
- `综合调理`: must include at least one concrete treatment detail such as herbs or acupoints

Block patterns:
- vague doctor question such as `帮我看看`
- guaranteed efficacy wording such as `保证`, `治愈`, `包好`, `一定好`
- patient self-use wording such as `我是患者`, `我自己`, `我可以吃`, `我该怎么办`

Recommended-but-not-hard-block fields:
- `年龄`
- `性别`
- `体质与生活背景`
- more specific treatment history or treatment response

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
- If DeepSeek returns malformed JSON, use syntax-only repair before failing.
- Prefer defensive normalization over brittle shape assumptions.

## Model And Latency Rules

- Organize call should use the fast model path.
- Analyze call should default to `DEEPSEEK_MODEL_ANALYZE`, then fall back to `DEEPSEEK_MODEL_FAST`, not the deep model by default.
- Deep model can still be used for repair fallback when fast repair fails.
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
- Doctors can save, reopen, rename, edit, regenerate, and delete records.
- Editing a draft clears the current analysis and requires regeneration.

## Design Direction

- Warm clinic red and off-white palette.
- Avoid sudden green or blue accents.
- Compact workbench, not a marketing landing page.
- Keep author and repository attribution in the dashboard, not the README.
- Prefer kanban/dashboard-style analysis grouping over document-style sprawl.
- Keep a visible help surface in the dashboard so doctors can understand workflow assumptions without reading external docs.
- Show a visible build label in the UI so deployed-version checks are easy.
- When local dev bypass is active, show a clear in-product indicator such as `本地开发模式`.

## Documentation Direction

- `README.md` is product-facing.
- Explain what the tool helps doctors do.
- Keep setup and operational notes concise.
- Mention the two-step pipeline, organize-stage stop behavior, internal-only token/cost tracking, and allowlist source.
- Document the local dev auth bypass in `.env.local.example` and keep the explanation brief and explicit.

## Deferred Scope

1. Doctor feedback capture and accepted/rejected suggestion tracking
2. External citation retrieval layer
3. Regression comparison dashboard across prompt/model versions
