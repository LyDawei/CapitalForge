#!/usr/bin/env bash
# Shared helpers for CapitalForge V2 deployment scripts.
# Sourced by deploy-v2.sh and initial-deploy/initial-deploy.sh — not meant to
# be executed directly.

log() { printf '[capitalforge] %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_docker() {
  require_cmd docker
  docker compose version >/dev/null 2>&1 || { echo "docker compose (v2 plugin) is required" >&2; exit 1; }
}

require_v2_env() {
  local v2_dir="$1"
  if [[ ! -f "$v2_dir/.env" ]]; then
    echo "Missing $v2_dir/.env — copy $v2_dir/.env.example and fill in real values first." >&2
    exit 1
  fi
}

# Idempotent — safe even if V1 was never started or is already stopped.
# `docker compose down` on an already-down stack is a no-op, not an error.
stop_v1() {
  local repo_root="$1"
  if [[ -f "$repo_root/docker-compose.yml" ]]; then
    log "Stopping V1 (root packages/ monorepo stack)…"
    ( cd "$repo_root" && docker compose -f docker-compose.yml down --remove-orphans )
  else
    log "No root docker-compose.yml found — nothing to stop."
  fi
}

# Idempotent — `compose up` only (re)creates services whose config/image changed.
start_v2_stack() {
  local v2_dir="$1"
  log "Building and starting the V2 prod stack (postgres + backend + frontend)…"
  ( cd "$v2_dir" && docker compose -f docker-compose.prod.yml up -d --build )
}

wait_for_backend_health() {
  local v2_dir="$1"
  local port="${PORT:-4000}"
  local attempts="${2:-60}"
  log "Waiting for backend health on :$port …"
  until curl -fsS "http://localhost:${port}/api/health" >/dev/null 2>&1; do
    attempts=$((attempts - 1))
    if (( attempts <= 0 )); then
      echo "Backend never became healthy. Recent logs:" >&2
      ( cd "$v2_dir" && docker compose -f docker-compose.prod.yml logs --tail=100 backend ) >&2
      exit 1
    fi
    sleep 2
  done
  log "Backend healthy."
}

# Idempotent — prisma/seed.ts upserts on agent.name / (agentId, version).
# Safe to call on every deploy, not just the first one.
seed_agent_registry() {
  local v2_dir="$1"
  log "Seeding agent registry + prompts (safe to re-run — upserts, see V2/prisma/seed.ts)…"
  ( cd "$v2_dir" && docker compose -f docker-compose.prod.yml exec -T backend npm run prisma:seed )
}

print_status() {
  local v2_dir="$1"
  local port="${PORT:-4000}"
  log "Scheduler status:"
  ( cd "$v2_dir" && docker compose -f docker-compose.prod.yml logs backend 2>/dev/null | grep -i scheduler | tail -n1 ) || true
  echo
  echo "  Dashboard:     http://localhost:4001"
  echo "  API / Swagger: http://localhost:${port}/docs"
}
