# Feature: Fix LID Session Race Condition

## Overview
On every fresh reconnect, all `session-*` files are cleared to force clean PreKey exchange.
The bot then recreates its own LID session asynchronously (not awaited). If a `fromMe` message
arrives during that window, decryption fails with "SessionError: No session record" and the
message is permanently dropped after 3 retries.

Fix: preserve the bot's own LID session file during startup cleanup so it survives reconnects.

## Progress
| # | Task | Status | Completed |
|---|------|--------|-----------|
| 01 | Preserve own LID session on startup cleanup | ✅ Done | 2026-03-31 |
| 02 | Test own LID session survives cleanup | ✅ Done | 2026-03-31 |

**Status Legend:** ⬜ Pending | 🔄 In Progress | ✅ Done | ⏸️ Blocked

## Pre-requisites
- [ ] Ensure tests pass: `npm test -- --testPathPattern=whatsapp`
- [ ] Create branch: `git checkout -b fix/lid-session-race`

## Phases Overview
- **Phase 1**: Fix (Task 01) — preserve own LID session file during stale cleanup
- **Phase 2**: Test (Task 02) — verify the fix holds under test

## Post-completion
- [ ] Run full test suite: `npm test`
- [ ] Deploy: `railway up --detach` and confirm `NanoClaw running` in logs
- [ ] Send a message from own phone and check no `SessionError` in logs

## Notes
- Session files use `fixFileName()` encoding: `/` → `__`, `:` → `-`
- Own LID is stored in `creds.json` under `me.lid` after first auth — read it before cleanup
- The LID user for this bot is `137177027575962` (from logs), but read dynamically from creds
- The PN session gets deleted during `migrateSession()`, so only the LID session needs protecting
