# CapitalForge V2 backend — Fastify API + in-process daily scheduler.
# Multi-arch: the same image builds and runs on amd64 (dev box) and arm64
# (Raspberry Pi 5) with no changes — Prisma's pg driver adapter means there's
# no platform-specific query-engine binary to worry about at runtime.
#
# Build context is V2/ (see docker-compose.prod.yml).
FROM node:20-bookworm-slim

WORKDIR /app

# Workspace manifests first, so `npm ci` caches unless a dependency changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

# Sources (scripts included so backfills / seeds can be run in-container).
COPY prisma ./prisma
COPY scripts ./scripts
COPY backend ./backend

# prisma.config.ts throws if DATABASE_URL is unset, but `generate` never
# connects — a dummy URL satisfies it at build time. The real DATABASE_URL is
# injected by compose at runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
      npm run prisma:generate -w @cf2/backend \
 && npm run build -w @cf2/backend \
 && chmod +x backend/docker-entrypoint.sh

ENV NODE_ENV=production
WORKDIR /app/backend
EXPOSE 4000
# Entrypoint applies migrations (idempotent) then starts the API.
ENTRYPOINT ["./docker-entrypoint.sh"]
