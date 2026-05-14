# TCM Diagnosis — Engineering Review

**Reviewed by:** Claude (second-opinion pass)  
**Date:** 2026-05-14  
**Scope:** Full codebase review — architecture, AI pipeline, auth/security, type safety, test coverage, AGENTS.md quality, and Codex/AI tooling guidance

---

## Overall Assessment

Well-built MVP. The architecture is intentional, the guardrail logic is thoughtful, and the AI pipeline has real defensive depth (JSON repair fallback chain, `after()` for non-blocking logging, progressive UI rules in AGENTS.md). The biggest risks right now are a missing input size guard on the API, one overengineered function that will become a maintenance trap, and zero test coverage on any route or UI logic.

**Scale: Adequate → Strong**. Three targeted fixes away from being genuinely solid.

---

## 1. AGENTS.md Quality

**Rating: Excellent — one bug to fix**

The file does exactly what CLAUDE.md does for NewsLingo: encodes invariants, pipeline rules, security boundaries, clinical style, and audit checklists that a future coding agent must not violate. It is better than most AGENTS.md files in the wild.

**One confirmed bug — line 190:**

```
Use [docs/agent-audit-checklist.md](C:\Users\chiaw\OneDrive\Desktop\playground\tcm-diagnosis\docs\agent-audit-checklist.md)
```

This is an absolute Windows path. On any other machine (or in CI) the link is broken. Also breaks if the project is ever moved. Fix to a relative path:

```markdown
Use [docs/agent-audit-checklist.md](../docs/agent-audit-checklist.md)
```

**Minor gaps (not blocking):**

- No documentation that DeepSeek model env vars (`DEEPSEEK_MODEL_DEEP`, `DEEPSEEK_MODEL_FAST`, `DEEPSEEK_MODEL_ANALYZE`) are the correct override mechanism. A future agent might try to edit `deepseek.ts` defaults instead of setting env vars.
- No guidance on what to do if DeepSeek goes down (no circuit breaker, no fallback provider). Codex will not know to escalate or add a fallback.
- The `DEV_AUTH_BYPASS` invariant (item 8) says "must never be honored in production" but does not say how to verify this — there is no mention of which middleware or guard enforces it at runtime.

---

## 2. Design Balance

**Rating: Well-balanced for MVP**

The project is appropriately sized. Two-step AI pipeline, Zod validation, progressive UI, `after()` for non-blocking logging, JSON repair fallback — all of these are production patterns applied correctly without overengineering.

### Overengineered: `ensureAnalysisResult` in `src/lib/ai/analysisResult.ts`

This function is ~160 lines of deeply nested group-finding logic, repeated 4 times — once per result group (`资料完整性`, `当前思路`, `建议优化`, `随访监测`). Each repetition does: find group by Chinese title → check if sections is an array → find section by title → pass to `normalizeSection`. The same `.find()` call is written twice per section (once to check existence, once to access `.sections`).

This is the single biggest maintenance risk in the codebase. When the group structure changes (and it will), every one of those 8 repeated find chains needs to be updated in sync.

The fix is a small helper:

```typescript
function extractSection(
  groups: unknown[],
  groupTitle: string,
  sectionTitle: string
): unknown {
  const group = groups.find(
    (g) => typeof g === "object" && g && normalizeText((g as { title?: unknown }).title) === groupTitle
  ) as { sections?: unknown } | undefined;
  if (!Array.isArray(group?.sections)) return null;
  return (group.sections as unknown[]).find(
    (s) => typeof s === "object" && s && normalizeText((s as { title?: unknown }).title) === sectionTitle
  ) ?? null;
}
```

Then each section becomes one line:

```typescript
normalizeSection(extractSection(record.groups, "资料完整性", "已提供"), "已提供", "...")
```

~160 lines becomes ~40 lines. Identical logic, much easier to maintain.

### Underengineered (real risks):

| Gap | Risk | Effort to fix |
|---|---|---|
| No input size limit on `draft` in `/api/organize` | A long paste sends 10k+ tokens to DeepSeek, costs money, may hit token limits silently | 5 lines |
| No rate limiting on `/api/organize` and `/api/analyze` | A logged-in doctor (or session hijack) can flood DeepSeek calls | 1-2 days |
| Cost estimate uses PRO pricing regardless of model | Flash model calls are overcharged in logs; cost dashboard is inaccurate | 10 lines |

---

## 3. API Routes

**Rating: Solid, two issues**

HTTP semantics are correct. Error handling is thorough. `after()` for non-blocking logging is a good pattern — logging never delays doctor-facing responses.

### Issue 1: `/api/consultations` POST is dual-purpose

The POST handler creates a record, then conditionally updates it in the same request if `analysisStatus === "ready"`. This means a single POST can do two DB writes. There is no 409 if the record already exists, and there's no atomicity guarantee between the create and the update.

This works fine now because the frontend controls the flow, but it will confuse Codex when modifying save behavior. The split should eventually be: POST creates (draft only), PATCH updates (adds analysis). AGENTS.md documents PATCH for updates but the route currently does it all in POST.

### Issue 2: Inconsistent error response format

`/api/organize` returns `{ error: "..." }`. `/api/consultations` GET returns `{ error: "..." }`. But the POST in consultations returns `{ record: ... }` on success. Some error paths in analyze use `error.message` directly (which could expose internal DeepSeek error details to the frontend). Standardize on `{ error: string }` for all failure responses, with a user-safe message — not the raw DeepSeek message.

### Minor: No server-side input length validation

```typescript
// api/organize/route.ts — line 17-20
const body = (await request.json()) as { draft?: string };
const draft = body.draft?.trim();
if (!draft) {
  return NextResponse.json({ error: "请先输入医生草稿。" }, { status: 400 });
}
// No length check here. A 50,000-character draft goes straight to DeepSeek.
```

Add before the `callDeepSeekJson` call:

```typescript
if (draft.length > 8000) {
  return NextResponse.json({ error: "草稿内容过长，请精简后重新提交（上限8000字符）。" }, { status: 400 });
}
```

---

## 4. AI Pipeline

**Rating: Well-structured — two risks**

The two-step organize → analyze pipeline is clean. The JSON repair fallback chain (fast repair → deep repair) is a good defensive pattern. `repairJson: true` is enabled on both routes, which is correct.

### Risk 1: `TCM_ORGANIZE_SYSTEM_PROMPT` has no example output schema

The analyze prompt shows the full JSON structure with field types inline. The organize prompt describes the fields but shows the structure without types:

```
必须输出以下 JSON 结构：
{
  "病案类型": "方药分析 | 针灸方案 | 综合调理",
  "年龄": "string",
  ...
}
```

This is actually fine — it's showing expected values/types. But the enum values for `病案类型` are shown as the literal value string rather than making it clear these are the three valid options. The model may sometimes output a different string. Adding a brief note (`必须是以下三个值之一`) reduces hallucination risk.

### Risk 2: Token limits may silently truncate complex cases

- Organize: `maxTokens: 1800`
- Analyze: `maxTokens: 1400`

For a dense PCOS case with full drug history, tongue/pulse notes, and treatment response — the organized JSON output alone can approach 1800 tokens. When the model hits `max_tokens`, DeepSeek truncates mid-JSON, triggering the repair chain. This adds latency and cost without the doctor knowing why.

The repair chain handles truncation gracefully (repair prompt says "只保留已经完整可读的项目"), but the truncated section is silently dropped. Consider logging a warning when `repairedJson === true` so you can track how often this happens.

### Minor: Temperature 0.2 for clinical JSON output

```typescript
// deepseek.ts — line 243
temperature: 0.2,
```

For structured JSON output in a clinical tool, `temperature: 0` gives more predictable output. The `response_format: { type: "json_object" }` already constrains the format, so 0.2 only adds noise variance. Change to `0` or `0.1`.

### Minor: Cost estimate is wrong for flash model calls

```typescript
const PRO_INPUT_PER_1M = 0.435;
const PRO_OUTPUT_PER_1M = 0.87;
```

`estimateDeepSeekCost` uses these constants regardless of which model was used. Organize calls use `getDeepSeekFastModel()` (flash), but get charged at PRO pricing. The cost dashboard shows inflated numbers for organize calls. Pass the model name to the cost function and use per-model rates.

---

## 5. Auth & Security

**Rating: Good layered design — one production risk**

The allowlist pattern (Supabase `doctor_allowlist` → `ALLOWED_DOCTOR_EMAILS` fallback) is correct. Signing out non-allowlisted users immediately is the right behavior. The `DEV_AUTH_BYPASS` is correctly gated on `NODE_ENV === "development"`.

### Risk: No production enforcement that `DEV_AUTH_BYPASS` is absent

The code checks `NODE_ENV === "development"` before honoring the bypass. But Vercel preview deployments run with `NODE_ENV === "production"` — the check should hold. The risk is if someone accidentally sets `DEV_AUTH_BYPASS=true` in a preview environment's env vars. Add an explicit production guard in middleware:

```typescript
if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "development") {
  throw new Error("DEV_AUTH_BYPASS must not be set in non-development environments");
}
```

This hard-fails at startup rather than silently bypassing auth.

**No audit log for allowlist changes** — when a doctor is added/removed from `doctor_allowlist`, there is no record of who made the change or when. Not urgent for a small clinic tool, but worth noting.

---

## 6. Type Safety

**Rating: Mostly strong — two gaps**

`caseValidation.ts` uses Zod correctly throughout. `CaseForm` is cleanly derived from the schema. Validation errors surface specific field paths. This is good work.

### Gap 1: `AnalysisJson` uses `unknown` throughout

```typescript
export type AnalysisJson = {
  重点结论?: unknown;
  病案摘要?: unknown;
  资料完整性?: {
    已提供?: unknown;
    建议补充?: unknown;
  };
  // ...
};
```

Every field is `unknown`. The normalization functions in `buildAnalysisResult` and `ensureAnalysisResult` handle this defensively, which is why it works — but TypeScript provides no safety on the raw AI output. If the model returns `重点结论` as a string instead of an array, the type system won't catch it; only the runtime normalization will.

This is acceptable as a deliberate design choice (AI output is inherently untyped), but it should be documented as intentional in AGENTS.md.

### Gap 2: `ConsultationRecord` can drift from Supabase schema

There is no Zod schema validating what comes back from Supabase for consultation records. If a column is added or renamed in Supabase, TypeScript won't catch the mismatch until a runtime error. The same `supabase-js` query result gets spread into the component without shape validation.

---

## 7. Test Coverage

**Rating: Needs work**

There are zero test files under `src/`. The `vitest.config.ts` is configured, but nothing is being tested.

What is currently untested:
- All three API routes (`/api/organize`, `/api/analyze`, `/api/consultations`)
- The entire auth flow (allowlist check, bypass detection)
- `validateCaseForm` / `getBlockedReasons` / `hasImpliedReviewIntent` in `caseValidation.ts`
- `buildAnalysisResult` and `ensureAnalysisResult` normalization logic
- `extractJsonObject` and the repair chain in `deepseek.ts`

The audit checklist in AGENTS.md (`Audit Checklist Before Saying "Done"`) is manual verification only. Without automated tests, Codex regressions won't be caught until a doctor encounters them.

**Recommended first tests to add** (highest ROI, no mocking needed):

```
src/lib/caseValidation.test.ts    — validateCaseForm, getBlockedReasons, edge cases
src/lib/ai/analysisResult.test.ts — buildAnalysisResult with partial/empty AI output
src/lib/ai/deepseek.test.ts       — extractJsonObject parsing edge cases
```

These are pure functions — no network, no Supabase, no Next.js. They can run in under a second and would catch the most common regressions from AI-assisted edits.

---

## Top 5 Improvements (Prioritized)

### 1. Add input size limit — 30 minutes, closes a real cost/reliability risk

**File:** `src/app/api/organize/route.ts` line 20

```typescript
if (draft.length > 8000) {
  return NextResponse.json({ error: "草稿内容过长，请精简后重新提交（上限8000字符）。" }, { status: 400 });
}
```

Also add `maxLength={8000}` to the textarea in the workbench UI so doctors see the limit before submitting.

### 2. Refactor `ensureAnalysisResult` — 2 hours, eliminates a maintenance trap

Extract the repeated group-finding into a `extractSection(groups, groupTitle, sectionTitle)` helper. Reduces the function from ~160 lines to ~40. See Section 2 above for the helper pattern.

### 3. Fix absolute path in AGENTS.md — 5 minutes

Line 190: change `C:\Users\chiaw\...\docs\agent-audit-checklist.md` to `../docs/agent-audit-checklist.md`. This is broken on every machine except yours.

### 4. Fix cost estimate per model — 30 minutes

In `deepseek.ts`, pass the model name to `estimateDeepSeekCost` and use per-model pricing. Organize calls (flash model) are currently overcharged in logs. The cost dashboard is showing inflated numbers.

### 5. Add basic unit tests for pure functions — 1 day

Add test files for `caseValidation.ts`, `analysisResult.ts`, and `deepseek.ts` (parsing only). These are all pure functions. No mocking needed. This gives Codex a regression net so it can verify changes without going through the full manual audit checklist every time.

---

## Codex-Specific Guidance

### Which model to use

| Task | Recommended | Why |
|---|---|---|
| New feature implementation | Deep/Pro (your "smart" model) | Multi-file coherence, doesn't forget requirements mid-task |
| Small targeted fixes (single file) | Fast/Flash | Faster, cheaper — enough for focused changes |
| Exploring / understanding code | **Don't use Codex for this** | Expensive — read files yourself or use Claude Code chat |
| Documentation updates | Fast/Flash | No reasoning required |

The problems you saw with the cheaper model (missing requirements, implementing but not seeing changes) happen because small models lose context across files. The Pro model is necessary for anything spanning 3+ files.

### Reducing token burn

Codex reads the entire project context on each task. The fastest way to reduce cost:

1. **Add a `.codexignore`** (or `.openai-codex-ignore`) at the project root. At minimum exclude:
   ```
   node_modules/
   .next/
   *.lock
   local-data/
   docs/
   public/
   ```
   Without this, Codex reads `node_modules` and spends most of its token budget on irrelevant files.

2. **Scope tasks to single files when possible.** "Add input validation to `/api/organize/route.ts`" is cheaper and more reliable than "improve validation across the API."

3. **Don't use Codex for exploration or review.** Use it for implementation only. Asking Codex to "review" or "understand" reads many files and produces no output.

4. **One feature per session.** Long Codex sessions accumulate context. Close and reopen for unrelated tasks.

### What Codex does well in this project

- Implementing new validation rules in `caseValidation.ts` (pure TypeScript, well-typed)
- Adding new fields to the organize/analyze prompts in `prompts.ts`
- Extending the UI in `workbench.tsx` (React, no complex state machine)
- Writing the unit tests recommended above (pure functions, clear inputs/outputs)

### What Codex will likely struggle with

- Changes spanning `deepseek.ts` + both route files simultaneously — too many files, context gets lost
- Anything touching `ensureAnalysisResult` until it is refactored — the current nesting confuses models
- Auth middleware changes — subtle ordering matters, easy to introduce a bypass silently

---

## Summary

| Area | Status | Priority fix |
|---|---|---|
| AGENTS.md | Excellent | Fix absolute path on line 190 |
| Design balance | Well-balanced | Refactor `ensureAnalysisResult` |
| API routes | Solid | Add input size limit to `/api/organize` |
| AI pipeline | Well-structured | Fix cost estimate for flash model |
| Auth | Good | Add production guard for `DEV_AUTH_BYPASS` |
| Type safety | Mostly strong | Document `AnalysisJson: unknown` as intentional |
| Test coverage | Needs work | Add unit tests for pure functions |
