---
name: add-spy
description: Register a WhatsApp group as a silent spy/monitor. The bot listens to the group, evaluates messages against user-defined criteria, and pings only the main personal group when criteria match. Never writes back to the monitored group.
---

# Add Spy — Silent Group Monitor

Sets up a group as a **spy/listen-only** channel. The bot watches every message but is completely invisible — no typing indicator, no reply, no presence. When a message matches criteria you define, it pings only your personal (main) group.

## Security Model

Protection is enforced at **two independent layers**:

1. **Code-level hard guard** (`monitorOnly: true` flag in `RegisteredGroup`):
   - `processGroupMessages` skips `setTyping` and blocks `sendMessage` to the group JID
   - IPC message handler blocks any `send_message` IPC command targeting a `monitorOnly` JID
   - Both guards log a warning if something tries to break through

2. **Agent instructions** (CLAUDE.md):
   - Agent wraps all reasoning in `<internal>` tags
   - Allowed to send notifications ONLY via `mcp__nanoclaw__send_message` with `to_main: true`
   - Explicitly told it must never call `send_message` to this group

Neither layer alone is enough — both run together.

---

## Phase 1: Pre-flight

Verify the `monitorOnly` code guard is in place:

```bash
grep -n "monitorOnly" src/types.ts src/index.ts src/ipc.ts
```

Expected: you should see `monitorOnly` in all three files. If any are missing, the code guard hasn't been applied yet — stop and apply it first (see nanoclaw/src/).

---

## Phase 2: Find the Group JID

Ask the user which group they want to spy on, then find its JID:

```bash
sqlite3 store/messages.db "
  SELECT jid, name, last_message_time
  FROM chats
  WHERE jid LIKE '%@g.us'
  ORDER BY last_message_time DESC
  LIMIT 20;
"
```

Or request a fresh sync from the main group via IPC and read `available_groups.json`.

---

## Phase 3: Define Criteria and CC Recipients

Ask the user:
- **What to watch for?** Keywords, topics, sender names, or any pattern (e.g., "mentions of price", "anyone saying help", "messages from @Alice")
- **What to include in the notification?** Just a summary, the full message text, sender name + snippet?
- **Notification format?** e.g., `👁️ [GroupName] Alice: "Need help with payment" — 14:32`
- **CC recipients?** Any other numbers or groups that should also receive the notification (in addition to your main group). Ask for their JIDs (WhatsApp: `PHONE@s.whatsapp.net`, group: `ID@g.us`).

Write the criteria, notification format, and CC list into the CLAUDE.md you'll create in Phase 5.

---

## Phase 4: Register the Group

From the **main group** (your personal chat), tell the agent to call `register_group` with:

| Field | Value |
|-------|-------|
| `jid` | The group JID from Phase 2 |
| `name` | Friendly display name |
| `folder` | `whatsapp_<folder-name>` |
| `trigger` | `@Andy` (or configured trigger) |
| `requiresTrigger` | `false` — so every message wakes the agent |
| `monitorOnly` | `true` — hard blocks all outbound messages to this group |
| `notifyCC` | *(optional)* Array of JIDs to CC, e.g. `["972501234567@s.whatsapp.net"]` |

**Critical:** `monitorOnly: true` AND `requiresTrigger: false` MUST be set. These are now proper MCP tool parameters — the agent no longer needs to write raw JSON files.

**CC security model:** JIDs listed in `notifyCC` are hard-whitelisted in the database. The agent can only CC those exact JIDs — it cannot target arbitrary numbers. The host IPC layer enforces this independently of the agent instructions.

---

## Phase 5: Create the Spy CLAUDE.md

Create `groups/whatsapp_<folder-name>/CLAUDE.md` with the content below, substituting `<GROUP NAME>` and the criteria/notification format you defined in Phase 3.

```markdown
# Spy — <GROUP NAME>

You are silently monitoring this group. You are **invisible** — no one in the group knows you are here.

## STRICT RULES — read first

1. **NEVER send any message to this group.** Wrap your ENTIRE output in `<internal>` tags.
2. You may ONLY notify via `mcp__nanoclaw__send_message` with `to_main: true` (and optionally `cc: true` for pre-approved recipients).
3. Never call `send_message` to this group — `to_main` must always be true.
4. Never call `send_message` at all if the criteria below are NOT met.

Violation of rule 1 would expose the bot to the group. The code enforces this too, but you must enforce it yourself first.

## Monitoring Criteria

<REPLACE THIS SECTION with the criteria the user defined in Phase 3>

Examples:
- Notify if anyone mentions a specific keyword (case-insensitive)
- Notify if a specific sender writes anything
- Notify if any message matches a topic or sentiment

## Notification Format

When criteria match, send via `mcp__nanoclaw__send_message` (to_main: true):

```
👁️ [<GROUP NAME>] <sender_name>: "<relevant snippet>" — <time>
```

If CC recipients are configured (set at registration time), also pass `cc: true` to the same call. The host enforces which JIDs are allowed — you do not specify them directly.

If you need to include context, keep it concise (2-3 lines max).

## What to Ignore

- System messages, reactions, polls, stickers
- Messages that clearly don't match criteria
- Your own messages (they should never appear here, but filter them if they do)

## Output Structure

Every response MUST look like this:

```
<internal>
Evaluated N messages. [Criteria matched / Not matched.]
[If matched: sent notification to main.]
</internal>
```

Never output anything outside `<internal>` tags.
```

---

## Phase 6: Build and Restart

```bash
npm run build
```

Then restart the service:

```bash
# Railway: trigger a redeploy via Railway CLI or dashboard
# macOS local: launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux local: systemctl --user restart nanoclaw
```

---

## Phase 7: Verify

1. Send a message in the monitored group that matches criteria.
2. Verify in the **main group**: notification appears with correct format.
3. Verify in the **monitored group**: absolutely no message, no typing indicator.
4. Check logs for `monitorOnly guard` entries — if the guard ever fires, something tried to send and was blocked at the code level.

```bash
# Check logs for guard activations (should be empty if agent follows CLAUDE.md)
grep "monitorOnly guard" store/nanoclaw.log
```

---

## Troubleshooting

**Bot appears typing in monitored group**: The `monitorOnly` flag was not applied. Verify the group in the database has `monitorOnly: true` in its JSON config, then restart.

**Notification not arriving in main group**: Check that `requiresTrigger: false` is set (so messages wake the agent without a trigger) and that the CLAUDE.md criteria match what you're testing.

**Too many notifications (noisy)**: Tighten the criteria in CLAUDE.md. For high-traffic groups, consider adding a `script` to a scheduled task that checks for new messages meeting criteria, rather than waking the agent on every message.

**Agent processes messages but exits without notifying**: The messages didn't match criteria. Check the `<internal>` output in logs.

---

## Removing a Spy Group

From the main group:
> Remove spy group `<JID>` — unregister it

The agent will remove it from `registered_groups`. The group folder and logs are preserved.
