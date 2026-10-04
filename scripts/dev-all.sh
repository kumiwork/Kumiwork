#!/usr/bin/env bash
# Runs the full local dev stack: Postgres + Redis (docker compose), migrations, seed data,
# then the web app and the worker in parallel. Ctrl+C stops the web/worker processes; the
# db/redis containers keep running in the background (same as `docker compose up -d` normally
# would) — run `pnpm stop:all` to also tear those down.
set -euo pipefail
cd "$(dirname "$0")/.."

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

report_port_holders() {
  for port in 5432 6379; do
    holders=$(docker ps --filter "publish=$port" --format '{{.Names}}')
    if [ -n "$holders" ]; then
      echo "Port $port is held by container(s): $holders" >&2
    fi
  done
  echo "Stop them (docker stop <name>) and re-run pnpm dev:all." >&2
}

if ! docker compose up -d --wait; then
  docker compose down
  report_port_holders
  exit 1
fi

if ! port_open 5432 || ! port_open 6379; then
  echo "Postgres/Redis are healthy but their ports are not reachable; recreating containers..." >&2
  docker compose up -d --wait --force-recreate
  if ! port_open 5432 || ! port_open 6379; then
    echo "Ports 5432/6379 still unreachable after recreating the containers." >&2
    exit 1
  fi
fi

# Matches docker-compose.yml's own service config exactly (the standard local-dev connection
# string documented in the root .env.example) — passed explicitly rather than relying on a
# developer's own .env.local, so migrations and seeding always target the Postgres this script
# just started regardless of what else might be configured.
DATABASE_URL="postgres://kumiwork:kumiwork@localhost:5432/kumiwork" \
  pnpm --filter @agentfactory/db db:migrate

# Idempotent (onConflictDoNothing on every insert) — safe to run against an already-seeded DB.
DATABASE_URL="postgres://kumiwork:kumiwork@localhost:5432/kumiwork" \
  pnpm --filter @agentfactory/db db:seed

exec pnpm --parallel --filter @agentfactory/web --filter @agentfactory/worker dev
