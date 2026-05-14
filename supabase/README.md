# Supabase Schema

Migrations live in `supabase/migrations/` and are numbered sequentially. Apply them in order when setting up a new database. Each file is idempotent — safe to re-run.

## Applying a migration

Run the SQL in the Supabase SQL editor, or use the Supabase MCP tool:

```
apply_migration(project_id, name, query)
```

Never edit a past migration file. New schema changes always go in a new numbered file.

## Tables

| Table | Migration | Purpose |
|---|---|---|
| `consultations` | 001 | Doctor consultation records with draft, organized case, analysis result |
| `api_call_logs` | 001 | Every DeepSeek API call: model, latency, tokens, cost, route |
| `error_logs` | 001 | Server-side errors and events |
| `doctor_allowlist` | 002 | Allowed doctors: email, is_active, is_admin, display_name |
| `assessment_runs` | 003 | Backend assessment CLI run results stored for admin UI |

## Roles

Two roles are expressed via `doctor_allowlist.is_admin`:

| Role | is_admin | Access |
|---|---|---|
| user | false | Workbench only |
| admin | true | Workbench + `/admin/*` (assessment reports, future admin tools) |

## RLS

All tables use Row Level Security with `service_role` only. The app never uses the anon key to query these tables — all reads/writes go through server routes with `SUPABASE_SERVICE_ROLE_KEY`.
