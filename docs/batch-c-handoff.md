# Batch C Handoff

This note is the backup plan for the local AI assessment pipeline work.
It is meant to let the next AI continue without re-discovering the current state.

## Goal

Build a local-first assessment CLI that:

1. loads the real doctor drafts from `local-data/real-doctor-examples.md`
2. runs frontend automation against the workbench with local dev bypass
3. runs backend organize/analyze checks for both `智能` and `常规`
4. asks DeepSeek to review the frontend and backend results from multiple roles
5. writes a stable Markdown + JSON report
6. cleans up created test records automatically

The intended user experience is:

```bash
npm.cmd run assess:local
```

then wait for completion and read the report.

## What Is Already Done

### Batch A + B

Previously completed and pushed:

- server-side draft length guard
- production guard for `DEV_AUTH_BYPASS`
- model-aware DeepSeek cost logging
- analysis-result normalization refactor
- UX/header mission line updates

### Batch C foundation already started locally

The following local files were added or changed:

- `.gitignore`
  - ignores `output/assessment/`
  - ignores `output/playwright/`
- `package.json`
  - added `assess:local`
- `src/lib/currentDoctor.ts`
  - now honors local dev bypass for server routes too
- `scripts/lib/env.mjs`
  - loads `.env.local`
- `scripts/lib/assessment/examples.mjs`
  - parses `local-data/real-doctor-examples.md`
- `scripts/lib/assessment/output.mjs`
  - creates per-run output folders
- `scripts/lib/assessment/server.mjs`
  - starts a local dev server for assessment
- `scripts/assess-local.mjs`
  - current entrypoint / foundation runner

## Current Status

### Tests and build

These were already confirmed after the current local changes:

- `npm.cmd run test` ✅
- `npm.cmd run build` ✅

### Current blocker

`npm.cmd run assess:local` does not complete yet.

The current failure is **not** an app compile error.
It is a local assessment runner orchestration issue.

Observed failure:

- the runner starts `next dev` on port `3100`
- Next.js then exits because another `next dev` server is already running for the same repo
- readiness wait times out afterward

Evidence:

- run output folder:
  - `output/assessment/assessment-2026-05-14_06-27-39/`
- server log:
  - `output/assessment/assessment-2026-05-14_06-27-39/local-server.log`

Relevant log message:

```text
Another next dev server is already running.
- Local:        http://localhost:3002
- PID:          24932
```

## Recommended Next Fix

The assessment runner should handle local dev server reuse cleanly.

### Preferred approach

1. Add a mode to reuse an existing local dev server when present.
2. Allow override via env or CLI, for example:
   - `ASSESS_BASE_URL=http://127.0.0.1:3002`
3. If `ASSESS_BASE_URL` is set:
   - skip server spawn
   - run assessment against that base URL
4. If not set:
   - spawn a new local dev server as today

This is safer than force-killing an existing dev session.

### Acceptable fallback

If no reuse mode is implemented yet:

1. detect the existing dev server
2. surface a clear message instructing the user/runner to stop it first
3. then start a fresh assessment-owned dev server

## Next Implementation Steps

After the server reuse/start issue is resolved, continue in this order:

1. **Frontend automation**
   - create one or more test records
   - run both `智能` and `常规`
   - capture screenshots for:
     - initial dashboard
     - draft entered
     - organize/analysis running
     - final result
     - history reload
   - delete created test records

2. **Backend assessment**
   - iterate through all doctor examples
   - run `/api/organize`
   - run `/api/analyze` for both modes
   - record:
     - blocked vs allowed
     - latency
     - model
     - prompt version
     - usage
     - cost
     - repaired JSON if available

3. **DeepSeek reviewer layer**
   - frontend reviewers:
     - business analyst
     - experienced TCM practitioner
   - backend reviewers:
     - junior TCM
     - senior TCM
     - academic researcher
   - include comparison between `智能` and `常规`

4. **Report generation**
   - Markdown report
   - JSON report
   - include prompt-improvement suggestions

5. **Documentation update**
   - update `README.md`
   - update `AGENTS.md`
   - mention how to run the assessment CLI and what outputs it creates

## Notes About Real-Doctor Data

- Canonical source remains:
  - `local-data/real-doctor-examples.md`
- Do not reintroduce a second JSON source of truth.
- Keep these examples local-only and uncommitted.

## Notes About Model Comparison

The final assessment report should explicitly compare:

- `智能`
- `常规`

Focus on:

- latency
- cost
- output stability
- clinical usefulness
- whether the deeper model is truly worth it

## Working Principle

Do not turn this into a frontend admin feature.

Keep it CLI-first:

1. run command
2. wait
3. read report
4. turn report into action items
