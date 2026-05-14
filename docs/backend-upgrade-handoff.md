# Backend Upgrade Handoff

This note is for the next model session resuming this work. No prior conversation context is needed.

---

## 1. Current Goal

Backend-only hardening pass. No frontend assessment. The doctor-facing UI is simplified; deeper analysis remains available internally for assessment.

- Doctor-facing mode is hidden, defaulted to `常规`
- `智能` mode is preserved for backend assessment and future admin use
- Assessment CLI is the primary regression gate for hallucination and stability
- Frontend assessment remains explicit backlog

---

## 2. Why This Pass Exists

Backend assessment (`npm.cmd run assess:backend`) surfaced:

- Smart mode JSON parse failure on real-example-001 (truncated output)
- Over-blocking on real-example-006 (formula review draft with no explicit doctor question)
- Over-blocking on real-example-007 (推拿/综合调理 case — no acupoints but concrete manual treatment)
- Mode tradeoff strongly favoring `常规` for daily UX stability
- Empty/templated section placeholders appearing in output even when model returned nothing

---

## 3. Locked Product Decisions

- No doctor-facing mode switch (removed from workbench UI)
- Header shows active model label: `当前模型：<model-name>`
- Default doctor-facing mode is `常规`
- `智能` mode code paths are preserved (not deleted)
- Frontend assessment stays deferred
- Assessment CLI is the main quality gate

---

## 4. What Was Changed In This Pass

| File | Change |
|---|---|
| `src/app/page.tsx` | Pass `activeModel` prop (reads `DEEPSEEK_MODEL_ANALYZE` from env) |
| `src/app/workbench.tsx` | Remove mode toggle UI; fix initial `modelMode`; add model label to header; update guide text |
| `src/lib/ai/organizeCase.ts` | Default `modelMode` to `快速模式` |
| `src/lib/caseValidation.ts` | Add `hasConcreteManualTreatment`; relax 针灸方案 / 综合调理 blocks to accept 推拿 and similar |
| `src/app/api/analyze/route.ts` | Smart mode uses `maxTokens: 1100`; `repairedJson` added to response |
| `src/lib/ai/analysisResult.ts` | Remove fallback text from empty group sections (return `[]`); clean up `GROUP_SPECS` |
| `src/lib/ai/prompts.ts` | Improve organize prompt: 推拿 → 针灸方案 mapping; case-type-specific completeness hints |
| `scripts/lib/assessment/backend.mjs` | Add `repairedJson` capture; add `failed`, `repairTriggered` to mode stats; add `organizeStats` and `blockedReasonGroups` to aggregate; surface in markdown report |
| `AGENTS.md` | Update mode selector rules, guardrail type-specific rules, assessment workflow section |
| `README.md` | Remove doctor-facing mode switch references; add model label note |

---

## 5. Known Files / Subsystems To Inspect Next

- `local-data/real-doctor-examples.md` — real-doctor examples for assessment (gitignored; must exist locally)
- `scripts/lib/assessment/reviewers.mjs` — DeepSeek reviewer prompt (could be updated to ask about new metrics)
- `src/lib/ai/prompts.ts` — analyze system prompt (smart mode compactness could be further tightened if needed)
- `src/lib/caseValidation.ts` — implied review intent logic (review if Example 6 still blocks after this pass)

---

## 6. Required Regression Checks

```bash
npm.cmd run test
npm.cmd run build
npm.cmd run assess:backend   # requires local-data/ and .env.local
```

After assessment, verify:

- `real-example-001`: smart mode parse failure should be less frequent or fail more cleanly
- `real-example-006`: should no longer block (formula review with implied intent)
- `real-example-007`: should no longer block (推拿/综合调理 with concrete current plan)
- Section groups: empty sections should not show fallback placeholder text
- Model label: visible in header after login

---

## 7. Definition of Done

1. Doctor-facing UI has no mode toggle
2. Header shows active model label
3. Smart/normal both work in assessment
4. `real-example-006` and `real-example-007` pass through
5. Assessment report shows success rates, repair counts, blocked reason groups
6. Build and tests pass
7. AGENTS.md and README reflect shipped behavior
