# Feature: Approval Gate Hardening

## Overview
Two improvements to make the send approval gate reliable and secure:
1. Persist pending approvals to SQLite so restarts don't silently lose them
2. Block sends to unregistered JIDs and prompt the user to register first

## Progress
| # | Task | Status | Completed |
|---|------|--------|-----------|
| 01 | Add pending_approvals table to SQLite | ⬜ Pending | |
| 02 | Persist approvals in SendApprovalGate | ⬜ Pending | |
| 03 | Re-hydrate pending approvals on startup | ⬜ Pending | |
| 04 | Block sends to unregistered JIDs | ⬜ Pending | |

**Status Legend:** ⬜ Pending | 🔄 In Progress | ✅ Done | ⏸️ Blocked

## Pre-requisites
- [ ] Ensure tests pass: `npm test`

## Phases Overview
- **Phase 1**: SQLite persistence (Tasks 01-03)
- **Phase 2**: Unregistered JID guard (Task 04)

## Post-completion
- [ ] Run full test suite: `npm test`
- [ ] Deploy: `railway up --detach`
- [ ] Verify bot comes up: `railway logs | grep "NanoClaw running"`

## Notes
- Tasks 01-03 must be done in order (each depends on the previous)
- Task 04 is independent of 01-03
- The `isMain` bypass in `send()` must remain — approval previews must always reach the owner
