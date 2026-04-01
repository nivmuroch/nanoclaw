# Task 03: Re-hydrate Pending Approvals on Startup

## Phase
SQLite persistence (3 of 4)

## Objective
After `approvalGate` is initialized in `src/index.ts`, load non-expired rows from DB, restore in-memory state, and re-send approval previews to the main group.

## Files to Modify
- `src/index.ts` — add `rehydratePendingApprovals()` call after gate init
- `src/send-approval-gate.ts` — expose `rehydrate(rows)` method

## Implementation Steps

### In `src/send-approval-gate.ts`
Add a `rehydrate(rows: PendingApprovalRow[])` method:
1. For each row where `expires_at > now`:
   - Compute remaining ms: `expiresAt.getTime() - Date.now()`
   - Set a new `setTimeout` for the remaining duration (same expiry logic as `send()`)
   - Add to `this.pending` map
   - Re-send the approval preview to main group (call `this.rawSend(mainJid, preview)`)
2. For each row where `expires_at <= now`: call `this.persistRemove?.(row.id)` and skip

### In `src/index.ts`
After `approvalGate = new SendApprovalGate(...)`:
```ts
const staleRows = getAllPendingApprovals();
if (staleRows.length > 0) {
  logger.info({ count: staleRows.length }, 'Rehydrating pending approvals from DB');
  await approvalGate.rehydrate(staleRows);
}
```
Pass `insertPendingApproval` and `deletePendingApproval` as the `persistAdd`/`persistRemove` callbacks in the constructor.

## Test Command
```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

## Dependencies
- **Requires**: Task 02
- **Blocks**: None

## Status
- [ ] Implementation complete
- [ ] Tests passing

## Notes
- Re-sending the preview tells the owner "you have a pending approval from before the restart"
- The preview format should match `send()` exactly so approve/deny commands work unchanged
- `getAllPendingApprovals()` is called synchronously at startup before the message loop starts
