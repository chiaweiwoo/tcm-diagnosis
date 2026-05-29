import re

with open('AGENTS.md', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Rewrite invariant 13
old13 = (
    "### 13. Doctor-facing profile data \u2014 descriptive subset only\n"
    "\n"
    "The workbench (`/`) displays the doctor's own clinical profile in the left sidebar (`\u6211\u7684\u753b\u50cf`).\n"
    "\n"
    "- **Endpoint:** `GET /api/me/profile` \u2014 requires valid session, uses service_role to read `analytics_doctor_evaluations`.\n"
    "- **Descriptive subset** (may be shown to the doctor): `profileSummary`, `keyObservations`, `treatmentStyle`, `aiRecurringThemes` (theme + frequency only, no caseNumbers).\n"
    "- **Analytical subset** (admin-only, must NEVER appear in doctor-facing responses): `strengths`, `gaps`, `guidancePoints`, `patientDistribution`, `fieldCompleteness`.\n"
    "- The server strips analytical fields before returning. Never return raw `doctor_profile` JSONB to a doctor session.\n"
    "- `aiRecurringThemes.caseNumbers` is also stripped \u2014 case-level granularity is admin-only.\n"
    "- Cache: `Cache-Control: private, max-age=300, stale-while-revalidate=600`. Profile only updates when admin triggers a new evaluation."
)

new13 = (
    "### 13. Doctor-facing sidebar \u2014 Risk Nudge card (replaces \u6211\u7684\u753b\u50cf)\n"
    "\n"
    "The workbench (`/`) left sidebar now shows `\u26a0\ufe0f AI \u53cd\u590d\u63d0\u9192\u7684\u98ce\u9669\u70b9` \u2014 the doctor's own recurring AI caution themes.\n"
    "\n"
    "- **Component:** `src/app/RiskNudgePanel.tsx` (replaces `MyProfilePanel.tsx` in the sidebar; `MyProfilePanel` retained but orphaned from doctor UI).\n"
    "- **Read endpoint:** `GET /api/me/nudge` \u2014 requires valid session; supports `X-View-As` for admin preview.\n"
    "- **Data source:** `doctor_risk_nudges` table (one row per doctor, upsert on `doctor_id` PK).\n"
    "- **What is shown:** `themes[].key` (TCM-native label \u226410\u5b57) + relative frequency bar (`weight` 0\u20131). **No counts, no %, no verbatim text in bar area.**\n"
    "- **Row-hover popup:** shows label `\u793a\u4f8b\uff1a` + up to 5 verbatim caution excerpts from the doctor's own analyzed cases.\n"
    "- **Raw counts never leave the server** \u2014 only `weight = count / max` is sent.\n"
    "- Cache: `Cache-Control: private, max-age=300, stale-while-revalidate=600`.\n"
    "- `GET /api/me/profile` and `MyProfilePanel.tsx` retained (not deleted) \u2014 used by admin eval display. Do not delete unless admin UI is updated."
)

if old13 in content:
    content = content.replace(old13, new13, 1)
    print("invariant 13: replaced")
else:
    print("invariant 13: NOT FOUND")

# 2. Update architecture diagram to add /api/me/nudge line
old_arch = "  \u2514\u2500\u2500 GET  /api/me/profile                     \u2192 descriptive profile subset (strips analytical fields, invariant 13)"
new_arch = (
    "  \u2514\u2500\u2500 GET  /api/me/nudge                       \u2192 risk-nudge card (weight-only, examples; invariant 13)\n"
    "  \u2514\u2500\u2500 GET  /api/me/profile                     \u2192 descriptive profile subset (orphaned from doctor UI; used by admin)"
)

if old_arch in content:
    content = content.replace(old_arch, new_arch, 1)
    print("arch diagram api/me: replaced")
else:
    print("arch diagram api/me: NOT FOUND")

# 3. Update GH Actions line in arch
old_gh = (
    "GH Actions (ASSESSMENT_API_KEY auth, workflow_dispatch only \u2014 no schedule)\n"
    "  \u2514\u2500\u2500 npx tsx scripts/evaluate-local.ts        \u2192 per-doctor profile evaluation (7d window, skips empty doctors)\n"
    "                                                  triggerable via workflow_dispatch with required email/ID"
)
new_gh = (
    "GH Actions (ASSESSMENT_API_KEY auth)\n"
    "  \u2514\u2500\u2500 workflow_dispatch: npx tsx scripts/evaluate-local.ts \u2192 per-doctor profile evaluation (7d window)\n"
    "  \u2514\u2500\u2500 POST /api/cron/risk-nudge daily 03:00 SGT / 19:00 UTC  (FIRST scheduled workflow in project)\n"
    "        \u2192 computeNudgesForActiveDoctors \u2192 upsert doctor_risk_nudges per active doctor\n"
    "  \u2514\u2500\u2500 npm run nudge -- --email <e>             \u2192 on-demand single-doctor nudge (--force to bypass watermark)"
)

if old_gh in content:
    content = content.replace(old_gh, new_gh, 1)
    print("gh actions: replaced")
else:
    print("gh actions: NOT FOUND")

# 4. Add Doctor Risk Nudge section before CSS Architecture
marker = "\n---\n\n## CSS Architecture"
nudge_section = """
---

## Doctor Risk Nudge

Recurring AI caution aggregation surfaced in the workbench left sidebar.

**Two-stage pipeline:**
1. **Deterministic bucketing** (always runs; the floor): cautions from `analysis_result.cautions` + `\u98ce\u9669\u4e0e\u63d0\u9192` in a 14-day window back from `MAX(analyzed_at)` are keyword-matched to 8 fixed buckets. Buckets with >=3 occurrences are surfaced, sorted by count desc.
2. **DeepSeek flash rephrasing** (polish; optional): AI rephrases labels into TCM-native short labels (<=10 chars) and selects verbatim examples. **If AI fails, deterministic labels are used as-is. The nudge is never empty due to AI outage.**

**Watermark trigger:** only recompute if `MAX(analyzed_at)` > stored `source_last_record_at`. Daily cron skips unchanged doctors.

**Key files:**
- `src/lib/nudge/buckets.ts` -- 8 bucket definitions, `bucketCautions()`, `RECURRENCE_FLOOR=3`, `WINDOW_DAYS=14`
- `src/lib/nudge/prompts.ts` -- `RISK_NUDGE_SYSTEM_PROMPT`, `RISK_NUDGE_PROMPT_VERSION = "risk-nudge-v1"`
- `src/lib/nudge/computeNudge.ts` -- `computeNudgeForDoctor()`, `computeNudgesForActiveDoctors()`
- `src/app/api/cron/risk-nudge/route.ts` -- fleet-wide cron POST (X-Assessment-Key auth), `maxDuration=300`
- `src/app/api/me/nudge/route.ts` -- doctor read GET (session auth + X-View-As)
- `src/app/RiskNudgePanel.tsx` -- UI component (shimmer / empty / data + row-hover popup)
- `scripts/compute-nudge.ts` -- CLI: `npm run nudge -- --email ...` / `--doctorId ...` / `--force`
- `.github/workflows/risk-nudge.yml` -- daily at `0 19 * * *` (03:00 SGT) -- FIRST scheduled workflow

**Database:** `public.doctor_risk_nudges` -- one row per doctor, PK `doctor_id`.
RLS: doctor reads own row. `authenticated`: SELECT (RLS-gated). `service_role`: all. `anon`: nothing.

> WARNING: **Unapplied migration: `029_doctor_risk_nudges.sql`** -- apply in Supabase SQL Editor before first `npm run nudge` or cron run.

**Invariant 8:** caution text -> DeepSeek (permitted). Langfuse receives tokens/cost/latency only.

---

## CSS Architecture"""

if marker in content:
    content = content.replace(marker, nudge_section, 1)
    print("nudge section: added")
else:
    print("nudge section: NOT FOUND (marker missing)")

with open('AGENTS.md', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")
