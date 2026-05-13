# TCM Diagnosis — AI Session Memory

This file keeps durable project preferences and implementation invariants for coding agents.
Keep it current when product behavior meaningfully changes.

## Product Purpose

Doctor-facing TCM clinical workbench for Singapore-style outpatient use.
It is not patient-facing.

Core workflow:
1. Doctor writes a rough case draft.
2. System organizes the draft into structured clinical context.
3. System shows completeness guidance and, when appropriate, generates a supportive clinical reference in simplified Chinese.
4. Records are saved for review, consistency checks, and future improvement.

## Communication And UX Preferences

- Chat with the owner in English.
- Product UI text, validation text, stored labels, and AI output must be simplified Chinese.
- Keep workflows practical, compact, and low-friction.
- Prefer one continuous workbench: draft on top, clinical reference below.
- Avoid over-instructional copy; wording should feel modern clinical, not demo-like.
- Tone should feel like a warm senior colleague: supportive, suggestive, never scolding.

## Branch And Delivery Rules

- Use a single-branch workflow on `main` unless the user explicitly asks for another branch.
- Do not leave important behavior only in a local draft state without either finishing it or reporting clearly that it is incomplete.
- Keep `AGENTS.md` and shipped behavior in sync; update memory after meaningful UX, workflow, or guardrail changes.

## Stack And Platform

- Frontend: Next.js + TypeScript on Vercel.
- UI: focused CSS + `lucide-react`.
- Validation: `zod` plus dedicated guardrail helpers.
- Auth and data: Supabase for Google OAuth, consultation storage, and server-side logging.
- AI provider: DeepSeek only, through server-side API routes.

## Security And Access Invariants

1. Never expose DeepSeek keys or Supabase service role keys in frontend code.
2. No `NEXT_PUBLIC_DEEPSEEK_*` environment variables.
3. OAuth is required before entering the workbench.
4. Allowlist source is `ALLOWED_DOCTOR_EMAILS`.
5. Current allowed emails:
   - `chiaweiwoo123@gmail.com`
   - `ardytcm@gmail.com`
6. Unauthenticated access to `/` must redirect to `/login`.
7. Signed-in but non-allowlisted users must be signed out and shown a Chinese authorization message.

## Clinical Guardrails

Hard-block minimum before analysis:
- `病案类型`
- `主诉`
- `当前方案`
- `医生问题`

Type-specific:
- `方药分析`: must include `方药内容`.
- `针灸方案`: must include `穴位与操作` or sufficiently specific current treatment method.

Block patterns:
- vague requests like `帮我看看`
- guaranteed efficacy wording such as `保证`, `治愈`, `包好`, `一定好`
- patient self-use wording such as `我是患者`, `我自己`, `我可以吃`, `我该怎么办`

Recommended-but-not-hard-block fields:
- `年龄`
- `性别`
- `病程`
- `体质与生活背景`
- `病史与治疗反应`

## Clinical Style And Output Contract

- Persona: senior, pragmatic, supportive TCM peer.
- Prioritize practical clinic execution over theoretical maximalism.
- Preserve reasonable parts first, then suggest high-impact improvements.
- Prefer 1-3 actionable changes over long lists.
- Include uncertainty and review points; no guaranteed cure language.
- Do not fabricate citations.

Active reading order for analysis:
1. `重点结论`
2. `病案摘要`
3. `资料完整性`
4. `当前思路`
5. `建议优化`
6. `可选思路`
7. `风险与提醒`
8. `随访监测`
9. `证据状态`

## Reliability And Pipeline Rules

- Keep the two-call pipeline:
  - organize call first
  - analyze call second
- Progressive UI is required:
  - show organize-stage completeness guidance as soon as organize finishes
  - continue elapsed time through the full run
  - stop before analyze if validation hard-blocks the case
- Prompt contract is strict JSON:
  - list fields must be arrays
  - empty lists must be `[]`
  - text fields must be strings
  - no markdown fences
  - no extra prose outside JSON
- Analyze prompts should include an internal self-check for:
  - safety
  - missing context
  - overconfidence
  - evidence gaps
  - whether the doctor question is actually answered
- If provider JSON is malformed:
  - run a repair step for syntax-only cleanup
  - do not add clinical content during repair
- Always defensively normalize parsed payloads before UI mapping.

## Logging And Traceability

Log model calls to Supabase with:
- route
- provider
- model
- latency
- success or failure
- prompt version
- token usage and estimated cost
- stage metadata such as `repair`, `completed`, `failed`

Log server errors with stage context.
Logging should not block doctor-facing responses.

Token and cost stay internal only and should not be shown in the doctor-facing UI.

## Consultation Storage Invariants

- History is scoped by logged-in doctor email.
- `consultations` uses JSONB for flexible fields:
  - `organized_case`
  - `analysis_result`
  - `analysis_raw`
  - `validation_result`
  - `model_meta`
- Optional `consultation_name`:
  - named records show timestamp plus name
  - unnamed records show timestamp only
- Doctors can save, reopen, rename, edit, regenerate, and delete records.
- Editing a draft clears current analysis and requires regeneration.
- Store run metadata in `model_meta`, including duration when available, so loaded history can show a meaningful elapsed time instead of resetting to zero.

## Design Direction

- NovaHealth-inspired tone without copying assets.
- Warm clinic red and off-white palette.
- Avoid sudden green or blue accents.
- Compact dashboard style:
  - no fake charts
  - no left result rail
  - no duplicate status or repeated countdowns
  - right-side workbench panel should merge `研判状态` with immediate `资料完整性` guidance

## Documentation Direction

- `README.md` is product-facing.
- Describe what the tool helps doctors do.
- Do not frame the app as an AI experiment.
- Keep setup and debug internals minimal unless explicitly requested.
- Keep author and repo attribution in the dashboard, not in the README.
- Update documentation when product behavior changes, not weeks later.

## Human Calibration Samples

Real doctor examples in `docs/human-calibration-samples.md` are for tone and practicality calibration only.
They are not strict expected-output fixtures.

## Deferred Scope

1. Doctor feedback capture and accepted or rejected suggestions.
2. Database-managed doctor allowlist instead of env-only allowlist.
3. External citation retrieval layer for PubMed and TCM sources.
4. Regression comparison dashboard across prompt and model versions.
