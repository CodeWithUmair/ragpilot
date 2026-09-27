#!/bin/sh
# Apply database migrations, then hand PID 1 to uvicorn.
set -e

echo "[entrypoint] running migrations"
alembic upgrade head

echo "[entrypoint] starting uvicorn on :${PORT:-4000}"
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-4000}" \
  --proxy-headers \
  --forwarded-allow-ips='*'
