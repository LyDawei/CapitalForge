#!/bin/sh
# Backend container entrypoint: bring the schema up to date, then start the API.
# `migrate deploy` is idempotent (applies only unapplied migrations), so it is
# safe to run on every boot. Fails loud if the DB is unreachable.
set -e

echo "[entrypoint] applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy --config prisma.config.ts

echo "[entrypoint] starting API on port ${PORT:-4000}"
exec node dist/server.js
