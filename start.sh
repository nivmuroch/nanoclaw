#!/bin/sh
set -e

# Seed creds.json from env var on first boot (WHATSAPP_CREDS_JSON is the raw JSON content)
if [ -n "$WHATSAPP_CREDS_JSON" ] && [ ! -f /app/store/auth/creds.json ]; then
  echo "Seeding WhatsApp creds.json..."
  mkdir -p /app/store/auth
  printf '%s' "$WHATSAPP_CREDS_JSON" > /app/store/auth/creds.json
  echo "creds.json seeded"
fi

# Redirect /app/data and /app/groups into the persistent volume (/app/store)
# so all state survives redeployments.

# data dir: sessions, ipc, env
mkdir -p /app/store/data
if [ ! -L /app/data ]; then
  rm -rf /app/data
  ln -s /app/store/data /app/data
fi

# groups dir: seed from image on first boot (also handles empty dir from failed earlier attempts)
if [ ! -d /app/store/groups ] || [ -z "$(ls -A /app/store/groups 2>/dev/null)" ]; then
  echo "Seeding groups from image..."
  mkdir -p /app/store/groups
  cp -rp /app/groups-seed/. /app/store/groups/
fi
if [ ! -L /app/groups ]; then
  rm -rf /app/groups
  ln -s /app/store/groups /app/groups
fi

# Migration: seed database and sessions from bundled data on first boot
# (only runs once — guarded by the presence of registered_groups rows)
if [ -d /app/migration ] && [ -f /app/migration/messages.db ]; then
  # Check if the live DB is empty (no registered groups yet)
  ROW_COUNT=$(node -e "
    const db=require('better-sqlite3')('/app/store/messages.db');
    try { console.log(db.prepare('SELECT COUNT(*) as n FROM registered_groups').get().n); }
    catch(e) { console.log(0); }
  " 2>/dev/null || echo 0)
  if [ "$ROW_COUNT" = "0" ]; then
    echo "Seeding messages.db from migration bundle..."
    cp /app/migration/messages.db /app/store/messages.db
    # Clear stale session IDs — local sessions used different workspace paths
    # and cannot be resumed on Railway. Agents will start fresh sessions.
    node -e "
      const db = require('better-sqlite3')('/app/store/messages.db');
      db.prepare('DELETE FROM sessions').run();
      console.log('Cleared stale session IDs');
    " 2>/dev/null || true
  fi
  # Seed sessions if not yet present
  if [ -d /app/migration/sessions ] && [ ! "$(ls -A /app/store/data/sessions 2>/dev/null)" ]; then
    echo "Seeding sessions from migration bundle..."
    mkdir -p /app/store/data/sessions
    cp -r /app/migration/sessions/. /app/store/data/sessions/
  fi
fi

# One-time groups migration: seed memory files from migration bundle (runs once, guarded by flag file)
if [ -d /app/migration/groups ] && [ ! -f /app/store/.groups-migrated ]; then
  echo "Migrating group memory files from migration bundle..."
  cp -rp /app/migration/groups/. /app/store/groups/
  touch /app/store/.groups-migrated
  echo "Group memory files migrated"
fi

# One-time session clear: if CLEAR_SESSIONS env var is set, wipe stale session IDs
# Set CLEAR_SESSIONS=1 in Railway dashboard, then remove it after one deploy.
if [ "${CLEAR_SESSIONS:-0}" = "1" ]; then
  echo "Clearing stale session IDs (CLEAR_SESSIONS=1)..."
  node -e "
    const db = require('better-sqlite3')('/app/store/messages.db');
    db.prepare('DELETE FROM sessions').run();
    console.log('Sessions cleared');
  " 2>/dev/null || true
fi

exec node /app/dist/index.js
