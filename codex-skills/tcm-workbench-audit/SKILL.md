---
name: tcm-workbench-audit
description: Audit the TCM workbench after product, state-flow, prompt, or UI changes. Use when Codex needs to verify fresh runs, saved-history reloads, stage-one blocking, partial organize behavior, final analysis stability, and docs sync before claiming a change is complete.
---

# TCM Workbench Audit

Use this workflow after meaningful changes to the workbench, AI pipeline, persistence, or doctor-facing copy.

## Required checks

1. Run `npm.cmd run build`.
2. Run `npm.cmd run test` when validation, parsing, or state flow changed.
3. Verify the fresh run path:
   - create or paste a draft
   - confirm `organize -> analyze` completes
   - confirm the final dashboard matches the intended behavior
4. Verify the saved-history reload path:
   - load an existing record
   - confirm stable section order and no disappearing major sections
5. Verify the stage-one blocked path if guardrails or organize behavior changed.
6. Verify the partial organize path if organize-stage coaching or status UI changed.
7. Confirm `AGENTS.md` and `README.md` match shipped behavior.
8. Confirm the build label is visible when deployment traceability matters.

## Do not claim completion until

- the changed path is verified, not just coded
- the code is committed and pushed
- docs are in sync

## Project-specific reminders

- Prefer a doctor-safe, stable UI over clever but brittle conditional rendering.
- Normalize saved history through the same shaping path as fresh model output.
- Keep doctor-facing wording supportive, concise, and non-judgmental.
