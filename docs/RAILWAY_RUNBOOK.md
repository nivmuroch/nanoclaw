# Railway Deployment Runbook

Practical guide for deploying, operating, and debugging NanoClaw on Railway.
Written from hard-won experience — updated as new lessons are learned.

---

## Architecture at a Glance

```
Local repo (git push) ──► Railway build ──► Running service container
                                               │
                                    /app/store/ (persistent volume)
                                    ├── messages.db        ← SQLite DB
                                    ├── auth/              ← WhatsApp signal keys
                                    ├── groups/            ← dynamic group data (IPC-created)
                                    └── ipc/               ← agent ↔ orchestrator IPC
```

- **App code** (`/app/`) is rebuilt fresh on every deploy. Changes to `groups/*/CLAUDE.md` in the repo are deployed with the code.
- **Persistent volume** (`/app/store/`) survives deploys and restarts. The SQLite DB, WhatsApp auth credentials, and dynamically created group folders live here.

---

## Deploy

### Normal deploy
```bash
railway up --detach
```
Always use `--detach`. Without it the CLI hangs waiting for the build.

### Check deploy status
```bash
railway logs
railway logs --tail 100   # last N lines
```

### CRITICAL: One deploy at a time
**Never run `railway up` multiple times in rapid succession.**
Each `railway up` sends SIGTERM to the running service. Overlapping deploys cause:
- Repeated SIGTERM mid-auth
- WhatsApp signal/pre-key state corruption in `/app/store/auth/`
- Sessions that decrypt incorrectly for hours until they self-heal

Wait for the previous deploy to fully start before triggering another.

---

## How `railway run` Actually Works

**`railway run <command>` runs in your LOCAL project directory**, not in the Railway container.

It injects Railway environment variables into your local shell, but the filesystem it sees is your local machine. This means:

| What you think you're doing | What actually happens |
|---|---|
| `railway run sqlite3 store/messages.db` | Queries your **local** `store/messages.db`, not production |
| `railway run ls /app/store/` | Fails — `/app/store/` doesn't exist on your laptop |
| `railway run bash -c "ls /groups/"` | Fails for the same reason |

### To query the PRODUCTION database
You cannot do this from your local machine via `railway run`. Options:
1. **Railway shell** — use Railway dashboard → service → "Shell" (if available on your plan)
2. **Read from logs** — the app logs startup state including `groupCount`
3. **Add a debug endpoint** — temporarily add an HTTP endpoint that dumps group state

### What `railway run` IS useful for
- Running scripts with Railway env vars injected (e.g. migration scripts)
- Testing env-var-dependent code locally against the Railway config
- Running `railway run sqlite3 store/messages.db` to inspect your **local dev DB**

---

## SIGTERM Behavior

Railway sends SIGTERM when:
- A new deploy is ready (replaces the running service)
- The service is manually restarted from the dashboard
- Railway internal health/restart logic fires

**The problem:** NanoClaw handles SIGTERM with `process.exit(0)`. Railway interprets exit code 0 as "stopped normally" — it does **NOT** automatically restart the service.

If you see a deployment with status `SUCCESS` but the bot is unresponsive, it means:
1. The process exited cleanly (exit 0)
2. Railway considers it done
3. No restart will happen

Fix: trigger a new deploy via `railway up --detach` or redeploy from the dashboard.

---

## Common Issues

### Bot connects then exits ~30 seconds after startup

**Pattern in logs:**
```
AwaitingInitialSync, forcing state to Online
SIGTERM received
```

**Root cause:** Usually caused by running multiple `railway up` in quick succession. The overlapping SIGTERM during auth corrupts the WhatsApp signal state.

**Fix:**
1. Do ONE clean `railway up --detach`
2. Wait for the full boot (watch logs until you see `NanoClaw running`)
3. Do not redeploy unless it crashes

If it persists after a clean single deploy, the auth state in `/app/store/auth/` may be unrecoverable without re-pairing (QR scan).

---

### PreKey errors in logs

```
PreKeyError: Invalid PreKey ID
```

**What it means:** Another device is trying to establish a Signal session using a pre-key that no longer exists in the bot's local key store (lost during a restart mid-auth).

**Is it critical?** No. The bot sends retry receipts automatically. Sessions re-establish over a few hours.

**Watch for:** The pre-key upload loop — bot sees N keys on server, uploads 5, still sees N. This means the server is consuming keys as fast as they're uploaded (many devices re-keying simultaneously). It self-heals. ID should increment: `6627 → 6634 → 6642...` — if it's stuck on the same ID in a tight loop, that's the broken pattern from before.

---

### Pre-key upload loop (stuck, not incrementing)

**Pattern:**
```
4 pre-keys found on server
uploading pre-keys count: 5
uploaded pre-keys successfully count: 5
4 pre-keys found on server   ← same count, tight loop
```

This was the pattern that preceded the crash. The pre-key ID was NOT incrementing, meaning uploads weren't actually being accepted.

**Cause:** WhatsApp signal state corruption from multiple overlapping restarts.

**Fix:** Single clean restart. If it resolves to an incrementing ID (even if still uploading frequently), it's healing.

---

### `link-preview-js` warning

```
url generation failed: Cannot find package 'link-preview-js'
```

This is a missing optional Baileys dependency. Link previews in messages don't work. Nothing else is affected. Safe to ignore.

---

## Group Registration Map

### Groups in the repo (deployed with code)

| Folder | Purpose | requiresTrigger | isMain |
|--------|---------|----------------|--------|
| `global/` | Base template (all groups inherit) | — | — |
| `main/` | Alias/fallback template | — | — |
| `whatsapp_main/` | Your personal number (control hub) | false | ✅ YES |
| `whatsapp_links/` | מדבר לעצמי — links drop zone | false | — |
| `whatsapp_me/` | me — personal solo chat | false | — |
| `whatsapp_aba/` | אבא | true | — |
| `whatsapp_achim/` | אחים | true | — |
| `whatsapp_gagala/` | גגאלה | true | — |

### Groups created dynamically on the Railway volume

These are created by the bot at runtime via IPC `register_group`. They exist in `/app/store/groups/` on the Railway volume (NOT in the repo).

| Folder | Purpose | monitorOnly |
|--------|---------|-------------|
| `whatsapp_dollar-journey/` | Spy monitor: המסע לדולר הראשון | ✅ YES |
| `whatsapp_ravaha/` | Spy monitor: רווחה אחד בשביל השניה | ✅ YES |

**Important:** When the spy group was first created, the `monitor_only` column did not exist in the DB schema. The `db.ts` migration was added in commit `23409fb`. On first restart after that commit, the column is added automatically. Re-register the spy group from the main group to ensure `monitorOnly: true` is persisted.

---

## Re-registering the Spy Group

If the bot restarts and you're unsure whether `monitorOnly: true` is set, re-register from the main group:

> Register group `120363407572176836@g.us` as a spy/monitor named `המסע לדולר הראשון`, folder `whatsapp_dollar-journey`, `requiresTrigger: false`, `monitorOnly: true`

The agent will overwrite the existing registration with the correct flags.

---

## Checking What's Running

### From logs at startup
```
State loaded
groupCount: N    ← how many registered groups loaded from DB
```

### Active groups from live logs
```bash
railway logs | grep '"group":'
```

### Active containers (shows which groups had recent messages)
```bash
railway logs --tail 500 | grep 'nanoclaw-whatsapp-'
```

### IPC activity (what groups are writing IPC messages)
```bash
railway logs | grep 'sourceGroup'
```

### monitorOnly guard activations (should be empty)
```bash
railway logs | grep 'monitorOnly guard'
```

### Spy batch timer activity
```bash
railway logs | grep 'Spy batch'
```

---

## Querying the Production Database

`railway run` and `railway shell` both run **locally** — they cannot access the Railway container filesystem.

Use `railway ssh` to run a command directly on the container:

```bash
# List all registered groups with their flags
railway ssh "node -e \"const D=require('better-sqlite3')('/app/store/messages.db');console.log(JSON.stringify(D.prepare('SELECT name,jid,monitor_only,require_trigger,is_main FROM registered_groups').all(),null,2))\""
```

**Important notes:**
- Table is `registered_groups` (not `groups`)
- `sqlite3` binary is NOT installed on the container — use `better-sqlite3` via node
- `railway ssh 'command'` passes the command as an argument and exits (non-interactive)

---

## Full Restart Procedure

When the bot is down or behaving incorrectly:

1. Check current state:
   ```bash
   railway logs --tail 50
   ```

2. Identify if it's running or exited (look for SIGTERM or crash at the end of logs)

3. If exited: do ONE clean deploy:
   ```bash
   railway up --detach
   ```

4. Watch it come up:
   ```bash
   railway logs
   ```
   Wait to see: `NanoClaw running` — only then is it fully up.

5. **Do not run `railway up` again** until you're sure the first one succeeded or clearly failed.

---

## Emergency: Bot Won't Stay Up (Auth Corruption)

If after a clean single deploy the bot still exits ~30s after startup with SIGTERM/auth errors, the WhatsApp signal state in `/app/store/auth/` is corrupted.

**Last resort:** Delete auth state and re-pair.
1. Via Railway shell: `rm -rf /app/store/auth/`
2. Or rename: `mv /app/store/auth /app/store/auth.bak`
3. Restart — bot will show a QR code in logs
4. Scan QR with WhatsApp → Linked Devices

This disconnects and reconnects the WhatsApp session. All registered groups and message history are preserved (they're in `messages.db`, not `auth/`).

---

## Lessons Learned

| Lesson | What happened |
|--------|--------------|
| Never run `railway up` twice in a row | Three rapid redeploys caused overlapping SIGTERMs, corrupted signal state, bot down for 45+ min |
| `process.exit(0)` = Railway thinks it's fine | Bot exited cleanly, Railway showed SUCCESS, no auto-restart, bot silently dead |
| `railway run` uses local filesystem | Spent time querying local DB thinking it was production |
| `monitor_only` DB column must exist | Flag was in TypeScript types but not in SQLite schema — lost on restart |
| Pre-key loop (non-incrementing ID) is the crash signal | The specific pattern of same ID repeated in tight loop preceded every crash |
