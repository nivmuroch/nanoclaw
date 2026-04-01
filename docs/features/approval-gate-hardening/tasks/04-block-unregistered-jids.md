# Task 04: Block Sends to Unregistered JIDs

## Phase
Unregistered JID guard (4 of 4)

## Objective
Before queuing a message, verify the target JID is registered. If not, send a prompt to main asking the user to register it first and discard the message.

## Files to Modify
- `src/send-approval-gate.ts` — add `isRegistered` callback + guard in `send()`, add `register-jid`/`deny-jid` command handling
- `src/index.ts` — pass `isRegistered` callback in `SendApprovalGate` constructor

## Implementation Steps

### In `src/send-approval-gate.ts`

1. Add optional callback to constructor:
   ```ts
   private isRegistered?: (jid: string) => boolean,
   ```

2. In `send()`, after the `isMain` bypass check, add:
   ```ts
   if (this.isRegistered && !this.isRegistered(jid)) {
     logger.warn({ jid }, 'Approval gate: blocked send to unregistered JID');
     await this.rawSend(
       mainJid,
       `⚠️ *Send blocked* — \`${shortJid(jid)}\` is not a registered group or contact.\n\n` +
       `Register it first:\n` +
       `✅ \`register-jid ${jid} <name>\`\n` +
       `❌ \`deny-jid ${jid}\``,
     );
     return;
   }
   ```

3. Add command patterns near the top of the file:
   ```ts
   export const REGISTER_JID_PATTERN = /^register-jid\s+(\S+)\s+(.+)$/i;
   export const DENY_JID_PATTERN = /^deny-jid\s+(\S+)$/i;
   ```

4. In `handleCommand()`, before the `PENDING_LIST_PATTERN` check, add:
   ```ts
   const registerMatch = trimmed.match(REGISTER_JID_PATTERN);
   if (registerMatch) {
     // Return false — let the agent handle actual registration via register_group MCP tool
     return false;
   }
   const denyMatch = trimmed.match(DENY_JID_PATTERN);
   if (denyMatch) {
     await this.rawSend(mainJid, `❌ Send to \`${shortJid(denyMatch[1])}\` cancelled.`);
     return true;
   }
   ```
   Note: `register-jid` returns `false` so the agent receives it and can call the `register_group` MCP tool to do the actual registration.

### In `src/index.ts`

Pass the callback when constructing the gate:
```ts
approvalGate = new SendApprovalGate(
  rawSendFn,
  getMainJid,
  getGroupName,
  insertPendingApproval,   // persistAdd (from Task 03)
  deletePendingApproval,   // persistRemove (from Task 03)
  (jid) => jid in registeredGroups,  // isRegistered
);
```

## Test Command
```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

## Dependencies
- **Requires**: None (independent of Tasks 01-03, but constructor signature from Task 02/03 must be coordinated)
- **Blocks**: None

## Status
- [ ] Implementation complete
- [ ] Tests passing

## Notes
- `register-jid` passes through to the agent (returns false) — the agent already knows how to call `register_group` MCP tool
- `deny-jid` is handled by the gate (returns true) — just confirms cancellation
- The main JID itself is always allowed through (checked before this guard)
