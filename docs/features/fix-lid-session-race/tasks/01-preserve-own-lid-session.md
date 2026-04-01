# Task 01: Preserve Own LID Session on Startup Cleanup

## Phase
Fix (1 of 2)

## Objective
Exclude the bot's own LID session file from the stale session cleanup so `fromMe` messages
can be decrypted after a reconnect without hitting "SessionError: No session record".

## Background
`connectInternal` (whatsapp.ts:92-113) deletes all `session-*` files on fresh connect to force
clean PreKey exchange. The own LID session is then rebuilt asynchronously via `migrateSession()`
(not awaited). Any `fromMe` message arriving during that async window fails to decrypt.

Session files use `fixFileName()` encoding: `:` → `-`, `/` → `__`.
Own LID session file example: `session-137177027575962-13@lid`

`creds.json` survives the cleanup (not deleted), so we can read the own LID from it before cleaning.

## Files to Modify
- `src/channels/whatsapp.ts` — read own LID from creds.json before cleanup, exclude from deletion

## Implementation Steps
1. Before the `staleFiles` filter (around line 97), read `creds.json` from `authDir`:
   ```ts
   let ownLidPrefix: string | undefined;
   try {
     const credsRaw = fs.readFileSync(path.join(authDir, 'creds.json'), 'utf-8');
     const creds = JSON.parse(credsRaw);
     const lidUser = creds?.me?.lid?.user;
     if (lidUser) {
       // session file name: fixFileName(`session-${lidUser}:*@lid`) → starts with `session-${lidUser}-`
       ownLidPrefix = `session-${lidUser}-`;
     }
   } catch {
     // creds.json doesn't exist yet (first boot) — no session to preserve
   }
   ```

2. Update the `staleFiles` filter to skip the own LID session:
   ```ts
   .filter(
     (f) =>
       (f.startsWith('session-') ||
        f.startsWith('sender-key-') ||
        f.startsWith('app-state-sync-key-')) &&
       !(ownLidPrefix && f.startsWith(ownLidPrefix)),
   )
   ```

3. Update the log message to include `ownLidPrefix` when set, e.g.:
   ```ts
   logger.info(
     { count: staleFiles.length, preservedOwnLid: !!ownLidPrefix },
     'Cleared stale signal sessions on startup',
   );
   ```

## Test Command
```bash
npm test -- --testPathPattern=whatsapp
```

## Dependencies
- **Requires**: None (first task)
- **Blocks**: Task 02

## Status
- [ ] Implementation complete
- [ ] Tests passing

## Notes
- `creds.json` format: `{ me: { id: "972542328676:13@s.whatsapp.net", lid: { server: "lid", user: "137177027575962" } }, ... }`
- If `me.lid` is absent (pre-LID migration or first boot), `ownLidPrefix` stays undefined and no exclusion applies — safe fallback
- The `sender-key-*` files are for group sender keys; those are fine to delete as they're re-exchanged
