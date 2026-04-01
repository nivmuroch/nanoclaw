# Task 01: Add pending_approvals Table to SQLite

## Phase
SQLite persistence (1 of 4)

## Objective
Add the `pending_approvals` table and CRUD helpers to `src/db.ts`.

## Files to Modify
- `src/db.ts` — add table creation migration + 4 helper functions

## Implementation Steps
1. In the `initDb()` migration block, add:
   ```sql
   CREATE TABLE IF NOT EXISTS pending_approvals (
     id TEXT PRIMARY KEY,
     target_jid TEXT NOT NULL,
     text TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   ```
2. Export `insertPendingApproval(id, targetJid, text, createdAt, expiresAt)` — INSERT OR REPLACE
3. Export `deletePendingApproval(id)` — DELETE WHERE id = ?
4. Export `getAllPendingApprovals()` — SELECT * returning typed rows
5. Export type `PendingApprovalRow { id, target_jid, text, created_at, expires_at }`

## Test Command
```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

## Dependencies
- **Requires**: None
- **Blocks**: Task 02, Task 03

## Status
- [ ] Implementation complete
- [ ] Tests passing

## Notes
- `expires_at` is ISO string — computed as `createdAt + APPROVAL_TIMEOUT_MS` at insert time
- Use `INSERT OR REPLACE` so re-queuing the same ID (shouldn't happen) doesn't crash
