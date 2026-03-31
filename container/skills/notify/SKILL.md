---
name: notify
description: Send push notifications to the user's iPhone via notifikations.com. Use proactively when completing long tasks, delivering scheduled results, detecting something important, or when the user asks to "notify me" or "ping me". Always notify for scheduled task completions.
allowed-tools: Bash(curl:*)
---

# Push Notifications via notifikations.com

Send instant push notifications to the user's iPhone using their personal webhook secret.

## Setup (Railway / host env)

Set one env var in Railway (or `.env` for local):

```
NANOCLAW_ENV_NOTIFIKATIONS_SECRET=your_secret_from_the_app
```

The secret is the token from the **notifikations** iOS app → Settings → Webhook URL.
The full URL is `https://api.notifikations.com/api/v1/<secret>`.

The `NANOCLAW_ENV_` prefix is stripped at container startup — the container sees `NOTIFIKATIONS_SECRET`.

## How to send a notification

### 1. Build the endpoint URL

```bash
if [ -z "$NOTIFIKATIONS_SECRET" ]; then
  echo "NOTIFIKATIONS_SECRET not set. Add NANOCLAW_ENV_NOTIFIKATIONS_SECRET to Railway env vars."
  exit 0
fi
NOTIFY_URL="https://api.notifikations.com/api/v1/${NOTIFIKATIONS_SECRET}"
```

### 2. Send the notification

**Simple message:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "$NOTIFY_URL" \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"$MESSAGE\"}"
```

**With title and subtitle:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "$NOTIFY_URL" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TITLE\", \"subtitle\": \"$SUBTITLE\", \"message\": \"$MESSAGE\"}"
```

**With urgency:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "$NOTIFY_URL" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TITLE\", \"message\": \"$MESSAGE\", \"interruption-level\": \"time-sensitive\"}"
```

**With a tap-to-open URL:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "$NOTIFY_URL" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TITLE\", \"message\": \"$MESSAGE\", \"open_url\": \"$URL\"}"
```

A `200` response means delivered.

## Fields reference

| Field | Required | Description |
|-------|----------|-------------|
| `message` | Yes | Notification body |
| `title` | No | Bold title (defaults to app name) |
| `subtitle` | No | Secondary line below title |
| `sound` | No | Custom sound name |
| `interruption-level` | No | `active` (default), `time-sensitive`, `passive`, `critical` |
| `open_url` | No | URL or deep link to open when tapped |
| `image_url` | No | Inline image URL |

## When to use

**Always notify for:**
- Scheduled task completions (cron results)
- Long-running tasks finishing (>30 seconds)
- Errors or failures that need attention
- Anything the user explicitly asked to be notified about

**Use `time-sensitive` for:** urgent alerts, errors, failures

**Use `passive` for:** low-priority informational updates

## Example: scheduled task result

```bash
if [ -n "$NOTIFIKATIONS_SECRET" ]; then
  curl -s -o /dev/null -X POST "https://api.notifikations.com/api/v1/${NOTIFIKATIONS_SECRET}" \
    -H "Content-Type: application/json" \
    -d "{\"title\": \"Daily Summary\", \"message\": \"Your morning briefing is ready\"}"
fi
```
