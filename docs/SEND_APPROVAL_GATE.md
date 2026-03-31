# Send Approval Gate

Every outbound message the bot tries to send to another group or person is **held for owner approval**. Nothing leaves without an explicit "yes."

---

## How It Works

### 1. Bot queues the message

When the agent calls `send_message` (or any other code path that would deliver a WhatsApp message), the gate intercepts it instead of sending immediately.

- A 6-character ID is generated (e.g. `a3f9c1`)
- The message is stored in an in-memory pending queue
- A 10-minute expiry timer starts

### 2. Approval preview arrives in your main group

You receive this in your personal (main) group:

```
🔐 Send Approval Required
ID: `a3f9c1`
To: "Family Chat" (…12345678 (group))

Hey everyone, dinner at 8pm tonight!

✅ `approve a3f9c1`
❌ `deny a3f9c1`
📋 `pending` — list all
```

The **To:** line always shows both the group name and a short JID suffix so you can verify the exact destination.

### 3. You approve or deny

| You type | Effect |
|---|---|
| `yes` | Approve (only if exactly 1 pending) |
| `approve` | Approve (only if exactly 1 pending) |
| `approve a3f9c1` | Approve specific message by ID |
| `כן` / `אשר` / `מאשר` / `שלח` | Hebrew approve (1 pending) |
| `no` | Deny (only if exactly 1 pending) |
| `deny` | Deny (only if exactly 1 pending) |
| `deny a3f9c1` | Deny specific message by ID |
| `לא` / `דחה` | Hebrew deny (1 pending) |
| `pending` | List all waiting approvals with age and preview |

### 4. Outcome

- **Approved** → message is delivered to the target; you get a confirmation:
  `✅ [a3f9c1] sent to "Family Chat" (…12345678 (group))`
- **Denied** → message is discarded silently:
  `❌ [a3f9c1] discarded.`
- **Expired** (10 min, no response) → message is discarded and you're notified:
  `⏰ [a3f9c1] expired — message to "Family Chat" was discarded.`
- **Delivery fails** (target unreachable after approval) → you're notified:
  `⚠️ [a3f9c1] approved but failed to deliver — Reason: ...`

---

## What Bypasses the Gate

| Scenario | Why |
|---|---|
| Messages **to your main group** | Approval previews must reach you — otherwise there's an infinite loop |
| `monitorOnly` (spy) groups | These are hard-blocked from receiving any messages at a different layer |
| No main group registered yet | Gate falls back to direct send — configure main group to enable it |

---

## Agent Behavior

Agents are instructed (via `groups/main/CLAUDE.md`) to:

1. **Not ask for confirmation** before calling `send_message` — the gate handles it automatically
2. **Not say "sent"** after calling the tool — the tool returns `"Message queued for delivery"` so the agent knows to say something like "submitted for approval" instead

This prevents the double-ask problem where the agent asks "should I send this?" and then the gate also shows an approval request.

---

## Security Properties

### What is protected
- All messages to non-main groups require explicit owner approval
- Approval commands are only accepted from the main group JID — commands from any other JID are rejected and logged
- The gate cannot be bypassed by injecting `approve` or `yes` into a non-main group

### Known limitations

| Limitation | Notes |
|---|---|
| **Any member of the main group can approve** | Gate validates the group JID, not the individual sender. If your main group has other members, they can approve too. Use a 1-on-1 self-chat as main group for maximum security. |
| **Main group messages are not gated** | By design — needed for approval previews to reach you. A compromised agent could send to main without approval. |
| **Gate disabled before main group registers** | On first startup, if no main group is configured yet, all messages go out directly. |
| **Only the last user message per batch is checked** | If you send two messages back-to-back quickly and `approve` is not the last one, it may reach the agent as regular input instead of being handled by the gate. |

---

## Code Location

| File | Role |
|---|---|
| `src/send-approval-gate.ts` | Core gate: queue, approval logic, timeout, shorthand keywords |
| `src/index.ts` | Wires gate into agent output, IPC watcher, and scheduler; intercepts approval commands in main group before they reach the agent |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | `send_message` tool — returns "queued for delivery" so agent doesn't report premature success |
| `groups/main/CLAUDE.md` | Instructs agent not to ask for confirmation and not to say "sent" |

---

## Multiple Pending Messages

If the bot queues more than one message before you respond, the shorthand `yes` / `no` will refuse and ask you to be specific:

```
⚠️ 2 messages pending — use `approve <id>` or `deny <id>` to be specific.
Type `pending` to list them.
```

Use `pending` to see all of them, then approve/deny by ID.
