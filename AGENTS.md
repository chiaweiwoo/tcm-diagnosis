# TCM Diagnosis — AI Session Memory

This file keeps durable project preferences and implementation invariants for coding agents.

## Product Purpose

Doctor-facing TCM clinical workbench for Singapore-style outpatient use.
Not patient-facing.

Core workflow:
1. Doctor writes rough case draft.
2. System organizes draft into structured context.
3. System generates supportive clinical reference in simplified Chinese.
4. Records are saved for review, consistency checks, and future improvement.

## Communication And UX Preferences

- Chat with the owner in English.
- Product UI text, validation text, stored labels, and AI output must be simplified Chinese.
- Keep workflows practical, compact, and low-friction.
- Prefer one continuous workbench: draft on top, clinical reference below.
- Avoid over-instructional copy; wording should feel modern clinical, not demo-like.

## Stack And Platform

- Frontend: Next.js + TypeScript (Vercel).
- UI: focused CSS + lucide-react.
- Validation: zod + dedicated guardrail helpers.
- Auth and data: Supabase (Google OAuth + consultation storage + logging).
- AI provider: DeepSeek only (server-side API routes).

## Security And Access Invariants

1. Never expose DeepSeek key or Supabase service role key in frontend.
2. No `NEXT_PUBLIC_DEEPSEEK_*` env vars.
3. OAuth is required before entering workbench.
4. Allowlist source is `ALLOWED_DOCTOR_EMAILS`.
5. Current allowed emails:
   - `chiaweiwoo123@gmail.com`
   - `ardytcm@gmail.com`
6. Unauthenticated access to `/` must redirect to `/login`.
7. Signed-in but non-allowlisted users must be signed out and shown Chinese authorization message.

## Clinical Guardrails

Hard-block minimum before analysis:
- 病案类型
- 主诉
- 当前方案
- 医生问题

Type-specific:
- 方药分析: must include 方药内容.
- 针灸方案: must include 穴位与操作 or sufficient current treatment method.

Block patterns:
- vague requests like “帮我看看”
- guaranteed efficacy wording (“保证”, “治愈”, “包好”, “一定好”)
- patient self-use wording (“我是患者”, “我自己”, “我可以吃”, “我该怎么办”)

Recommended-but-not-hard-block fields:
- 年龄, 性别, 病程, 体质与生活背景, 病史与治疗反应

## Clinical Style And Output Contract

- Persona: senior, pragmatic, supportive TCM peer.
- Prioritize practical clinic execution over theoretical maximalism.
- Preserve reasonable parts first, then suggest high-impact improvements.
- Prefer 1-3 actionable changes over long lists.
- Include uncertainty and review points; no guaranteed cure language.
- No fabricated citations.

Active analysis section order:
1. 重点结论
2. 病案摘要
3. 资料完整性（已提供 / 建议补充）
4. 当前思路（可取之处 / 需要复核）
5. 建议优化
6. 可选思路
7. 风险与提醒
8. 随访监测
9. 证据状态

## Reliability Invariants (Current Phase)

- Keep two-call pipeline:
  - organize call (fast model)
  - analyze call (deep model)
- Prompt contract is strict JSON:
  - list fields must be arrays
  - empty lists must be `[]`
  - text fields must be strings
  - no markdown fences
  - no extra JSON-external prose
- Analyze prompt includes internal self-check before final JSON:
  - safety
  - missing context
  - overconfidence
  - evidence gaps
  - whether doctor question is answered
- If provider JSON is malformed:
  - run repair call for syntax-only cleanup
  - do not add clinical content during repair
- Always defensively normalize parsed payloads before UI mapping.

## Logging And Traceability

Log model calls to Supabase with:
- route
- provider
- model
- latency
- success/failure
- prompt version
- token usage and estimated cost
- stage metadata (`repair`, `completed`, `failed`) and useful context

Log server errors with stage context. Logging should not block doctor-facing response.

Token/cost remain internal only (not shown in doctor UI).

## Consultation Storage Invariants

- History is scoped by logged-in doctor email.
- `consultations` uses JSONB for flexible fields:
  - `organized_case`
  - `analysis_result`
  - `analysis_raw`
  - `validation_result`
  - `model_meta`
- Optional `consultation_name`:
  - named records show timestamp + name
  - unnamed records show timestamp only
- CRUD behavior:
  - save, reopen, rename, edit, regenerate, delete
- Editing draft clears current analysis and requires regeneration.

## Design Direction

- NovaHealth-inspired tone (without copying assets).
- Warm clinic red/off-white palette.
- Avoid sudden green/blue accents.
- Compact dashboard style:
  - KPI-style summary cards
  - dense grouped sections
  - no decorative/fake charts
  - no left result rail

## Documentation Direction

- README is product-facing.
- Describe what the tool helps doctors do.
- Do not frame as AI experiment.
- Keep setup/debug internals minimal unless explicitly requested.
- Keep author/repo attribution in dashboard, not README.

## Human Calibration Samples

Real doctor examples in `docs/human-calibration-samples.md` are for tone/practicality calibration only.
They are not strict expected-output fixtures.

## Deferred Scope (Not In Current Phase)

1. Doctor feedback capture and accepted/rejected suggestions.
2. Database-managed doctor allowlist (instead of env list).
3. External citation retrieval layer (PubMed/TCM sources).
4. Regression comparison dashboard across prompt/model versions.
