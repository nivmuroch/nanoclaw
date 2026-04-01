# Task 02: Persist Approvals in SendApprovalGate

## Phase
SQLite persistence (2 of 4)

## Objective
Wire DB helpers into `SendApprovalGate` so every queue/resolve/expiry is mirrored to SQLite.

## Files to Modify
- `src/send-approval-gate.ts` — inject DB callbacks, call insert/delete at the right points

## Implementation Steps
1. Add two optional callbacks to the constructor signature:
   ```ts
   private persistAdd?: (id: string, targetJid: string, text: string, createdAt: Date, expiresAt: Date) => void,
   private persistRemove?: (id: string) => void,
   ```
2. In `send()`, after `this.pending.set(id, ...)`, call `this.persistAdd?.(id, jid, text, createdAt, expiresAt)`
   - `expiresAt = new Date(Date.now() + APPROVAL_TIMEOUT_MS)`
3. In `_resolve()`, after `this.pending.delete(id)`, call `this.persistRemove?.(id)`
4. In the timeout callback, after `this.pending.delete(id)`, call `this.persistRemove?.(id)`

## Test Command
```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

## Dependencies
- **Requires**: Task 01
- **Blocks**: Task 03

## Status
- [ ] Implementation complete
- [ ] Tests passing

## Notes
- Use optional callbacks (not required) so existing unit tests don't need DB mocks
- `createdAt` is already set in `send()` as `new Date()` — capture it before the timeout
