#!/usr/bin/env bash
#
# Idempotent CapitalForge deploy: stop V1, build + start the V2 prod stack
# (postgres + backend + frontend), wait for health, and (re-)seed the agent
# registry. Safe to re-run any time — after `git pull`, after a reboot,
# whenever — every step here either no-ops or upserts.
#
# For the one-time V1 -> V2 cutover that also migrates existing V2 data from
# another machine (pg_restore) and/or funds the wallet, use
# V2/scripts/deployment/initial-deploy/initial-deploy.sh instead. That one is
# NOT safe to re-run; this one is.
#
# Usage:
#   V2/scripts/deployment/deploy-v2.sh [--keep-v1] [--no-seed]
#
#   --keep-v1   don't stop the V1 stack (e.g. running both side by side)
#   --no-seed   skip the agent-registry seed step
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
V2_DIR="$REPO_ROOT/V2"

# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

KEEP_V1=false
DO_SEED=true
for arg in "$@"; do
  case "$arg" in
    --keep-v1) KEEP_V1=true ;;
    --no-seed) DO_SEED=false ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown flag: $arg (see --help)" >&2; exit 1 ;;
  esac
done

require_docker
require_v2_env "$V2_DIR"

if [[ "$KEEP_V1" == false ]]; then
  stop_v1 "$REPO_ROOT"
else
  log "Skipping V1 shutdown (--keep-v1)."
fi

start_v2_stack "$V2_DIR"
wait_for_backend_health "$V2_DIR"

if [[ "$DO_SEED" == true ]]; then
  seed_agent_registry "$V2_DIR"
else
  log "Skipping agent-registry seed (--no-seed)."
fi

print_status "$V2_DIR"
log "Done."
