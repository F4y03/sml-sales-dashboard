---
name: sml-dashboard
description: This skill guides work on the SML sales dashboard (Express + read-only SML PostgreSQL + SQLite access store). Use it when starting/restarting the server or SML tunnel, choosing which tests to run, changing auth/2FA/trusted devices, or configuring users, roles, scopes and sales territories.
hooks:
  PreToolUse:
    - matcher: "Bash|PowerShell"
      hooks:
        - type: command
          command: node "${CLAUDE_PROJECT_DIR}/.claude/skills/sml-dashboard/scripts/guard.mjs"
---

# SML dashboard

Rules in `AGENTS.md` always apply. The hook in `scripts/guard.mjs` hard-blocks the worst mistakes (SML writes, committing `.env`/`data/`); do not try to work around it.

## Setup (new machine)
- Node >= 22.13 (uses built-in `node:sqlite`). `npm install`; UI tests also need `npx playwright install chromium`.
- `.env` exists → never print or edit it. Missing → copy `.env.example` and ask the user for values.
- SML is reached through an SSH tunnel on `127.0.0.1:15432` (`scripts/start-sml-tunnel.ps1`, key `~/.ssh/sml_dashboard_ed25519`).

## Pick the task

| Task | Read |
|---|---|
| Start / restart server, tunnel, "my change doesn't show" | [run-server.md](run-server.md) |
| Which tests to run, verifying a change | [testing.md](testing.md) |
| Users, roles, scope, territories, 2FA, trusted devices | [access.md](access.md) |
| Product / customer / executive / report / consignment logic | `PRODUCTS.md`, `CUSTOMERS.md`, `EXECUTIVE.md`, `REPORTS.md`, `consignment-source.md` |

## Change workflow
Copy this checklist into your reply and tick it off:

```
- [ ] 1. Read only the files the task touches (feature doc above if business logic)
- [ ] 2. Make the change; keep business definitions (4007/4014, trans_flag 44/46/48, NULL stock != 0, dates)
- [ ] 3. `node --check` every edited .js file
- [ ] 4. Run the matching tests from testing.md
- [ ] 5. Changed server code? Restart the server (run-server.md) — otherwise the user sees old behavior
- [ ] 6. Report: what changed, what was tested, what was NOT verified
```
- Test fails → go back to step 2. First check whether it also fails on the original code (`git stash`, run, `git stash pop`) — if so, report it as pre-existing, don't "fix" unrelated code.
- User says it still shows the old value → go back to step 5, and check which host they use (localhost vs `sahakhun.vrtunnel.net` = a different machine).
