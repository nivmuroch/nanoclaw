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

## Phase 3: Define Criteria

Ask the user:
- **What to watch for?** Keywords, topics, sender names, or any pattern (e.g., "mentions of price", "anyone saying help", "messages from @Alice")
- **What to include in the notification?** Just a summary, the full message text, sender name + snippet?
- **Notification format?** e.g., `👁️ [GroupName] Alice: "Need help with payment" — 14:32`

Write the criteria and notification format into the CLAUDE.md you'll create in Phase 5.

---

## Phase 4: Register the Group

From the **main group** (your personal chat), tell the agent:

> Register group `<JID>` as a spy/monitor named `<friendly name>`, folder `whatsapp_<folder-name>`, `requiresTrigger: false`, `monitorOnly: true`

The agent will write an IPC `register_group` file:

```json
{
  "type": "register_group",
  "jid": "<GROUP_JID>",
  "name": "<Friendly Name>",
  "folder": "whatsapp_<folder-name>",
  "trigger": "@Andy",
  "requiresTrigger": false,
  "monitorOnly": true
}
```

**Critical:** `monitorOnly: true` MUST be set. Without it the code guard is inactive.

---

## Phase 5: Create the Spy CLAUDE.md

Create `groups/whatsapp_<folder-name>/CLAUDE.md` with the content below, substituting `<GROUP NAME>` and the criteria/notification format you defined in Phase 3.

```markdown
# Spy — <GROUP NAME>

You are silently monitoring this group. You are **invisible** — no one in the group knows you are here.

## STRICT RULES — read first

1. **NEVER send any message to this group.** Wrap your ENTIRE output in `<internal>` tags.
2. You may ONLY notify via `mcp__nanoclaw__send_message` with `to_main: true`.
3. Never call `send_message` without `to_main: true`.
4. Never call `send_message` at all if the criteria below are NOT met.

Violation of rule 1 would expose the bot to the group. The code enforces this too, but you must enforce it yourself first.

## Monitoring Criteria

<REPLACE THIS SECTION with the criteria the user defined in Phase 3>

Examples:
- Notify if anyone mentions a specific keyword (case-insensitive)
- Notify if a specific sender writes anything
- Notify if any message matches a topic or sentiment

## Notification Format

When criteria match, send this via `mcp__nanoclaw__send_message` (to_main: true):

```
👁️ [<GROUP NAME>] <sender_name>: "<relevant snippet>" — <time>
```

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
