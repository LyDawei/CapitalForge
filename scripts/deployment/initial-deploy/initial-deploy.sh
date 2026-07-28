#!/usr/bin/env bash
#
# ============================================================================
#  ONE-OFF SCRIPT — the first-time V1 -> V2 cutover on this host.
#  NOT idempotent. Do not re-run after it has already succeeded here.
# ============================================================================
#
# Why this isn't idempotent, specifically:
#   --dump          pg_restore's a dump into the fresh V2 database. Restoring
#                   twice restores on top of already-restored rows (duplicate
#                   key / constraint failures, or silently doubled data if the
#                   dump format allows it).
#   --fund-wallet   records a one-time deposit transaction via the wallet API.
#                   Running it twice deposits the amount twice — there is no
#                   dedup on this call.
#
# Everything else this script does (stopping V1, building/starting the V2
# stack, waiting for health) IS idempotent on its own — those steps are
# delegated to scripts/deployment/deploy-v2.sh, which is the script to use
# for every *subsequent* redeploy. This script exists only to bolt the two
# genuinely one-time actions above onto that first run, per DEPLOY.md
# sections 2-3.
#
# Usage:
#   initial-deploy.sh --fresh   [--fund-wallet 2000] [--yes]
#   initial-deploy.sh --dump /path/to/cf_v2.dump      [--yes]
#
#   --fresh          start from an empty V2 database (runs prisma:seed)
#   --dump <path>    restore an existing V2 dump (from `pg_dump -Fc`) before
#                    the backend's first boot — see DEPLOY.md section 3
#                    for how to produce that dump on the source machine
#   --fund-wallet N  one-time deposit of $N into the sandbox wallet
#                    (only meaningful with --fresh; a restored dump already
#                    carries its own wallet ledger)
#   --yes            skip the confirmation prompt (for non-interactive use)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
V2_DIR="$REPO_ROOT"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=../lib.sh
source "$DEPLOY_DIR/lib.sh"

MODE=""
DUMP_PATH=""
FUND_AMOUNT=""
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh) MODE="fresh"; shift ;;
    --dump)
      MODE="dump"
      DUMP_PATH="${2:?--dump requires a path to a pg_dump -Fc file}"
      shift 2
      ;;
    --fund-wallet)
      FUND_AMOUNT="${2:?--fund-wallet requires a dollar amount}"
      shift 2
      ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help)
      sed -n '2,35p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown argument: $1 (see --help)" >&2; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Specify --fresh (seed an empty DB) or --dump <path> (restore existing V2 data). See --help." >&2
  exit 1
fi

if [[ "$MODE" == "dump" && -n "$FUND_AMOUNT" ]]; then
  echo "--fund-wallet only applies with --fresh — a restored dump already has its own wallet ledger." >&2
  exit 1
fi

echo "=================================================================="
echo " ONE-OFF: first V1 -> V2 cutover on this host."
echo " Mode: $MODE${DUMP_PATH:+ ($DUMP_PATH)}"
[[ -n "$FUND_AMOUNT" ]] && echo " Wallet funding: \$$FUND_AMOUNT (one-time deposit)"
echo " This script is NOT idempotent — do not re-run it once it has succeeded."
echo " Routine redeploys afterward: scripts/deployment/deploy-v2.sh"
echo "=================================================================="

if [[ "$ASSUME_YES" == false ]]; then
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

require_docker
require_v2_env "$V2_DIR"

if [[ "$MODE" == "dump" && ! -f "$DUMP_PATH" ]]; then
  echo "Dump file not found: $DUMP_PATH" >&2
  exit 1
fi

stop_v1 "$REPO_ROOT"

if [[ "$MODE" == "dump" ]]; then
  log "Starting Postgres only, so the restore lands before the backend's first migrate-deploy…"
  ( cd "$V2_DIR" && docker compose -f docker-compose.prod.yml up -d postgres )

  log "Waiting for Postgres to accept connections…"
  attempts=30
  until docker compose -f "$V2_DIR/docker-compose.prod.yml" exec -T postgres pg_isready -U postgres -d capitalforge_v2 >/dev/null 2>&1; do
    attempts=$((attempts - 1))
    if (( attempts <= 0 )); then
      echo "Postgres never became ready." >&2
      exit 1
    fi
    sleep 2
  done

  log "Copying dump into the container and restoring…"
  docker cp "$DUMP_PATH" capitalforge-v2-db:/tmp/cf_v2_restore.dump
  docker exec capitalforge-v2-db pg_restore -U postgres -d capitalforge_v2 /tmp/cf_v2_restore.dump
  docker exec capitalforge-v2-db rm -f /tmp/cf_v2_restore.dump
  log "Restore complete. The dump includes Prisma's _prisma_migrations table, so the backend's migrate-deploy on first boot will be a no-op."
fi

start_v2_stack "$V2_DIR"
wait_for_backend_health "$V2_DIR"

if [[ "$MODE" == "fresh" ]]; then
  seed_agent_registry "$V2_DIR"
else
  log "Skipping agent-registry seed — restored data already includes it."
fi

if [[ -n "$FUND_AMOUNT" ]]; then
  log "Recording one-time wallet deposit of \$$FUND_AMOUNT…"
  curl -fsS -X POST "http://localhost:${PORT:-4000}/api/wallet/transactions" \
    -H 'Content-Type: application/json' \
    -d "{\"kind\":\"deposit\",\"amount\":${FUND_AMOUNT},\"reason\":\"initial deploy funding\",\"author\":\"initial-deploy.sh\"}" \
    | { command -v jq >/dev/null 2>&1 && jq . || cat; echo; }
fi

print_status "$V2_DIR"
log "Initial deploy complete. From now on, use scripts/deployment/deploy-v2.sh for redeploys."
