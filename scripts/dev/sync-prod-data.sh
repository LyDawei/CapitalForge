#!/usr/bin/env bash
#
# Pull a fresh copy of the production database (the Pi5) into your local dev
# Postgres, so you can develop against real data without touching prod.
# Streams pg_dump straight over SSH into a local pg_restore — no intermediate
# dump file lands on either machine.
#
# Safe for production: pg_dump takes a single consistent MVCC snapshot — it
# does not lock tables or block the scheduler's reads/writes while it runs.
#
# Usage:
#   scripts/dev/sync-prod-data.sh [user@host] [--yes]
#
#   user@host   SSH target for the Pi. Defaults to $PI_HOST if set.
#   --yes       skip the confirmation prompt (this OVERWRITES your local dev DB)
#
# Requires: SSH access to the Pi, and local Docker Compose Postgres already
# configured (docker-compose.yml at repo root — this script brings it up if
# it isn't already running).
#
# Note: the dump includes Prisma's _prisma_migrations table. If you have
# local-only migrations not yet applied on prod, `prisma migrate dev` may
# report drift after a sync — reapply them or resolve the drift as usual.
set -euo pipefail

log() { printf '[sync-prod-data] %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

ASSUME_YES=false
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=true ;;
    -h|--help)
      sed -n '2,23p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) TARGET="$arg" ;;
  esac
done

TARGET="${TARGET:-${PI_HOST:-}}"
if [[ -z "$TARGET" ]]; then
  echo "No target host given. Pass user@host or set \$PI_HOST. See --help." >&2
  exit 1
fi

require_cmd ssh
require_cmd docker

DB_CONTAINER="capitalforge-v2-db"
DB_NAME="capitalforge_v2"

if [[ "$ASSUME_YES" == false ]]; then
  echo "This will REPLACE all data in your local '$DB_NAME' database with a copy from $TARGET."
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

log "Ensuring local Postgres is up…"
( cd "$REPO_ROOT" && docker compose up -d postgres )

log "Waiting for local Postgres to accept connections…"
attempts=30
until docker exec "$DB_CONTAINER" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; do
  attempts=$((attempts - 1))
  if (( attempts <= 0 )); then
    echo "Local Postgres never became ready." >&2
    exit 1
  fi
  sleep 2
done

log "Streaming pg_dump from $TARGET straight into local pg_restore…"
ssh "$TARGET" "docker exec $DB_CONTAINER pg_dump -U postgres -Fc -d $DB_NAME" \
  | docker exec -i "$DB_CONTAINER" pg_restore -U postgres -d "$DB_NAME" --clean --if-exists --no-owner

log "Done. Local cycle count:"
docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tA -c 'select count(*) from "Cycle";'
