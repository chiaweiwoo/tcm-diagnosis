# TCM Diagnosis — AI Session Memory

This file records project preferences and invariants for Codex and other AI coding agents.
Preserve these rules across future changes.

## Product Purpose

This project is a doctor-facing TCM clinical workbench for testing DeepSeek API output quality.
It is not patient-facing. It should help registered TCM doctors write rough clinical drafts,
organize them into structured fields, review the fields, receive Chinese clinical decision-support
drafts, and save interactions for later review and prompt/model improvement.

## User Preferences

- Chat with the project owner in English.
- The product UI, mock data, stored database-facing labels, validation messages, and AI output must use simplified Chinese.
- Keep the app practical and easy to use. The user gets overwhelmed by overly broad setup lists, so give step-by-step actions in the correct sequence.
- Prefer established tools and libraries over hand-rolled logic when they improve reliability or speed.
- Use mobile/web responsive layouts from the start.
- Think from the doctor's workflow first; a technically strong tool with poor usability is considered a failure.
- Prefer a draft-first workflow. Doctors should be able to brain-dump notes first; the app should organize fields internally and show missing-information warnings without forcing a large form.

## Stack Decisions

- Frontend/deployment: Next.js + TypeScript, deployable to Vercel.
- UI system: keep the current Next.js + focused CSS approach unless a library clearly reduces complexity.
- Icons: lucide-react.
- Form and validation: zod plus focused validation helpers. Keep guardrails centralized and testable.
- Auth/data: Supabase for Google OAuth allowlist, consultation history, future feedback storage, and current server-side logging.
- AI: DeepSeek through server-side API routes only.

## Hard Invariants

1. DeepSeek and Supabase service-role credentials must never be exposed to frontend code.
2. No `NEXT_PUBLIC_DEEPSEEK_*` environment variables.
3. Google OAuth is required before entering the workbench. Allowed emails are configured through `ALLOWED_DOCTOR_EMAILS`.
4. Supabase stores consultation history by logged-in doctor email. Flexible clinical payloads must stay in JSONB while the expected diagnosis schema is still evolving with doctor feedback.
5. All patient/case interaction records should be designed for future saving:
   - case input
   - validation result
   - blocked reason
   - AI output
   - selected model
   - prompt version
   - doctor feedback
   - timestamp and doctor email
6. The current UX is a continuous workbench: draft/case note on top, analysis below, with a left analysis navigation rail. Avoid forcing doctors through a large form unless they explicitly need structured editing.
7. AI output must avoid guaranteed cure claims and must expose uncertainty.
8. Requests that look patient-facing, vague, or promising guaranteed efficacy should be treated as low-confidence or not-ready clinical material in the output, not as a polished recommendation.
9. Citation/research retrieval is important for medical credibility, but it is phase 2. Until then, do not fabricate citations.
10. Medical AI prompts should use a critique loop: draft analysis, self-check for safety/evidence/logic gaps, then revise or lower confidence before returning the final answer.

## Clinical Guardrail Requirements

Minimum blocking fields before submission:

- 病案类型
- 主诉
- 当前方案
- 医生问题

Fields such as 年龄, 性别, 病程, 体质与生活背景, 病史与治疗反应 are highly recommended but should usually produce reminders rather than hard blocks, because doctors may have privacy constraints or incomplete information.

Type-specific requirements:

- 方药分析: require 方药内容.
- 针灸方案: require 穴位与操作 or sufficient current treatment method.

Block examples:

- vague question such as "帮我看看"
- guaranteed outcome wording such as "保证", "治愈", "包好", "一定好"
- patient self-use wording such as "我是患者", "我自己", "我可以吃", "我该怎么办"

## Design Direction

Inspired by NovaHealth TCM's public positioning, without copying assets:

- modern TCM
- clinical, calm, professional
- warm clinic red/off-white visual direction; avoid sudden green/blue accents because they make the app feel less cohesive
- clear safety and physician-only cues
- compact dashboard/workbench, not a marketing landing page

## Clinical Style Preference

The product should prefer practical Singapore-clinic recommendations over theoretical
maximalism:

- Persona should feel like a senior, experienced, pragmatic TCM physician familiar with Singapore outpatient practice.
- Respect classical TCM reasoning, but avoid overcomplicated scholastic analysis when it does not change action.
- Hybrid reasoning is preferred: TCM pattern thinking + modern checks + patient adherence + safety.
- Recommendations must consider ingredient/material availability, HSA/TCM practice context, cost, treatment complexity, appointment time, and follow-up convenience.
- Prefer 1-3 high-impact changes over long lists of herbs/acupoints.
- Preserve reasonable parts of the current doctor plan before suggesting changes.
- If a "best in theory" option is hard to obtain or hard to execute in Singapore, mark it as a backup rather than the main recommendation.

## Consistency Requirements

The core product problem is repeatability. The doctor friend reported that free-form Claude
chats produced different answers for similar questions, partly because prompts were not stable.
The app must reduce this variance.

Implementation direction:

- Store `prompt_version`, `model`, provider, temperature/reasoning settings, input JSON, output JSON, validation result, and doctor feedback for every run.
- Store API-call performance for every model call: route, provider, model, latency, success/failure, token usage, estimated cost, prompt version, and useful metadata.
- Consultation history now saves doctor email, optional consultation name, draft, structured case JSON, analysis JSON, raw model JSON, validation JSON, model metadata JSON, and timestamps.
- API logging should not slow down doctor-facing responses. Use background logging where possible; the UI should wait for DeepSeek, not for Supabase inserts.
- Use strict schemas and stable output sections rather than free-form prose.
- If a provider returns malformed JSON, use a small cleanup call that only repairs syntax and does not add clinical content.
- Use low temperature for clinical analysis.
- Keep a regression set of representative doctor cases and compare outputs when prompt/model changes.
- Prompt should force a fixed judgment order:
  1. data completeness
  2. case type
  3. reasonable parts of current plan
  4. major risks
  5. minimum necessary changes
  6. monitoring and review
- Similar inputs should produce similar core recommendations; alternative schools of thought should be clearly marked as backup, not randomly promoted to the main plan.

## Clinical Education UX

The tool should gently improve doctor data collection habits over time:

- Distinguish 必填, 建议补充, and 可选 fields in UI.
- Do not over-block imperfect cases when minimum safe context exists.
- Show missing-context reminders and explain why each missing field matters.
- Use missing-context logs to suggest what to ask during the next consultation.
- Treat validation as clinical coaching, not form punishment.
- Primary workflow should feel like one continuous workbench: 病案记录 on top, 临床参考 below, so doctors can compare source notes and AI output without switching tabs.
- Analysis results should include a left rail/timeline for stages: 资料完整性, 病案摘要, 临床判断, 建议方案, 复核与随访, 临床风险. On mobile this must collapse without overlap.
- The product uses two LLM calls internally: one faster organization call and one analysis call. Keep the internal structure for consistency/logging, but do not make the form the main doctor-facing experience.

## Latency And Cost

- Do not assume slow calls are caused only by the model tier. Check logged latency, output token count, JSON parse failures, and prompt size.
- Prefer concise structured outputs over long prose. Long completion length is a common cause of slow responses.
- Keep `max_tokens` conservative for the analysis route unless the UI needs more detail.
- Use API call logs before changing default models. Compare similar saved cases across model, latency, cost, and doctor feedback.
- Keep verification pragmatic for this small project. Build before push when routes/UI changed, run unit tests when validation or JSON handling changed, and avoid style-only or heavyweight checks unless they prevent a likely broken deployment.
- Show elapsed time during model calls so latency is visible to the project owner and future clinicians.
- Future prompt improvement should support clinic-specific distilled rules and doctor style preferences, stored separately from the base prompt so the system can improve over time without rewriting core safety rules.
- Product wording should feel like a modern clinical tool, not an IT demo. Prefer terms such as 病案记录, 临床研判, 资料完整性, 病案摘要, 临床风险, 新建病案. Avoid over-explaining internal mechanics in visible UI copy.

## Auth Requirements

- OAuth provider: Google through Supabase.
- Allowlist source: `ALLOWED_DOCTOR_EMAILS`, comma-separated emails.
- Current allowed emails: `chiaweiwoo123@gmail.com`, `ardytcm@gmail.com`.
- Visiting `/` without a valid session must redirect to `/login`.
- A signed-in but non-allowlisted Google account must be signed out and shown a Chinese authorization message.
- Keep future patient-facing access separate from this doctor-facing OAuth flow.

## Consultation History Requirements

- History records are scoped by logged-in doctor email.
- `consultations` uses JSONB for `organized_case`, `analysis_result`, `analysis_raw`, `validation_result`, and `model_meta`; avoid fixed clinical columns until real doctor review clarifies the durable schema.
- Optional `consultation_name` should display as timestamp + name; unnamed records display timestamp only.
- Doctors can save, reopen, rename, edit, regenerate, and delete records.
- Editing a draft clears the current analysis state and requires regeneration.

## Next Planned Phases

1. Add doctor feedback and accepted/rejected suggestion capture.
2. Add citation retrieval layer for PubMed/TCM sources.
3. Add regression-set comparisons for saved cases across prompt/model changes.

## Prompt Architecture Direction

Future model calls should not be a single direct answer. Use a two-stage or structured
self-critique process:

1. Produce a draft clinical analysis.
2. Critique the draft for missing patient context, unsafe claims, weak evidence,
   overconfident language, formula/acupoint mismatch, and unanswered doctor questions.
3. Revise the final output and include:
   - 置信度
   - 需要复核的地方
   - 证据缺口
   - 不建议采纳的内容

Do not show raw hidden chain-of-thought. Show concise clinical self-check summaries only.
