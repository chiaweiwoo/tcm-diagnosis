# Agent Audit Checklist

Use this checklist before claiming a meaningful workbench change is done.

## Product Paths

1. Fresh run path
   - Enter a draft
   - Run `organize -> analyze`
   - Confirm the final dashboard matches the new behavior

2. Saved-history reload path
   - Load an existing record
   - Confirm the same sections still appear in stable order
   - Confirm elapsed time, status, and analysis shape are sensible

3. Stage-one blocked path
   - Use a draft that should hard-block
   - Confirm analyze does not run
   - Confirm the doctor sees clear next-step guidance

4. Partial organize path
   - Use a draft that is valid enough to continue but still incomplete
   - Confirm organize feedback appears before final analysis

5. Final analysis path
   - Confirm key sections are present in stable order
   - Confirm no major section disappears because of thin model output

## UI And Delivery

6. Docs sync
   - Update `AGENTS.md` if workflow, guardrails, or defaults changed
   - Update `README.md` if shipped product behavior changed

7. Deployment traceability
   - Confirm the build label is visible when relevant
   - Commit and push before describing the change as done

8. Local verification when feasible
   - Run `npm.cmd run build`
   - Run `npm.cmd run test` when validation, parsing, or state flow changed
   - Use the local dev auth bypass for dashboard checks when needed
