#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

NEW_PROJECT=kumiwork
OLD_PROJECT=${OLD_PROJECT:-agentfactory}
OLD_PG_VOLUME=${OLD_PROJECT}_agentfactory_pgdata
OLD_REDIS_VOLUME=${OLD_PROJECT}_agentfactory_redisdata
NEW_PG_VOLUME=${NEW_PROJECT}_pgdata
NEW_REDIS_VOLUME=${NEW_PROJECT}_redisdata

compose() { docker compose -p "$NEW_PROJECT" "$@"; }

if pgrep -f "next dev|tsx watch" >/dev/null 2>&1; then
  echo "Stop pnpm dev / dev:all / dev:worker first (they hold database connections)." >&2
  exit 1
fi

if ! docker volume inspect "$OLD_PG_VOLUME" >/dev/null 2>&1; then
  candidates=$(docker volume ls -q --filter label=com.docker.compose.volume=agentfactory_pgdata)
  if [ -n "$candidates" ]; then
    echo "No $OLD_PG_VOLUME volume, but found:" >&2
    echo "$candidates" >&2
    echo "Re-run with OLD_PROJECT=<the part before _agentfactory_pgdata>." >&2
    exit 1
  fi
fi

copy_volume() {
  local from=$1 to=$2 key=$3
  if ! docker volume inspect "$from" >/dev/null 2>&1; then
    echo "No $from volume; nothing to copy."
    return
  fi
  if docker volume inspect "$to" >/dev/null 2>&1; then
    if [ "$(docker volume inspect -f '{{ index .Labels "kumiwork.migrated-from" }}' "$to")" = "$from" ]; then
      echo "$to was already copied from $from; leaving it as is."
      return
    fi
    echo "$to already exists and was not copied from $from (the new stack was probably started before this script)." >&2
    echo "If it holds nothing you need, run: docker compose -p $NEW_PROJECT down && docker volume rm $to   then re-run this script." >&2
    exit 1
  fi
  echo "Copying $from -> $to..."
  docker volume create --label com.docker.compose.project="$NEW_PROJECT" --label com.docker.compose.volume="$key" \
    --label kumiwork.migrated-from="$from" "$to" >/dev/null
  trap "docker volume rm '$to' >/dev/null 2>&1; exit 130" INT TERM
  docker run --rm -v "$from":/from:ro -v "$to":/to alpine sh -c 'cp -a /from/. /to/' || { docker volume rm "$to" >/dev/null; exit 1; }
  trap - INT TERM
}

rewrite_env_files() {
  local checkout file
  git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r checkout; do
    for file in .env .env.local .env.test.local apps/web/.env.local apps/worker/.env apps/worker/.env.local packages/db/.env; do
      [ -f "$checkout/$file" ] && [ ! -L "$checkout/$file" ] || continue
      perl -pi -e 's{postgres://agentfactory:agentfactory@([^/\s]+)/agentfactory}{postgres://kumiwork:kumiwork\@$1/kumiwork}g; s{^COMPOSE_PROJECT_NAME=agentfactory\r?$}{COMPOSE_PROJECT_NAME=kumiwork}' "$checkout/$file"
      echo "Updated $checkout/$file"
    done
  done
}

psql_as() {
  local role=$1
  shift
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$role" -d postgres "$@"
}

can_connect_as() { psql_as "$1" -tAc "SELECT 1" >/dev/null 2>&1; }

report_unfinished() {
  local status=$?
  [ "$status" -eq 0 ] && return
  echo >&2
  echo "Migration did not finish. $OLD_PG_VOLUME and $OLD_REDIS_VOLUME are untouched." >&2
  echo "Fix the error above and re-run this script before starting pnpm dev:all." >&2
}

docker compose -p "$OLD_PROJECT" down
trap report_unfinished EXIT
copy_volume "$OLD_PG_VOLUME" "$NEW_PG_VOLUME" pgdata
copy_volume "$OLD_REDIS_VOLUME" "$NEW_REDIS_VOLUME" redisdata
compose up -d --wait postgres redis

if can_connect_as agentfactory; then
  psql_as agentfactory -c "DROP ROLE IF EXISTS kumiwork_migrate" -c "CREATE ROLE kumiwork_migrate SUPERUSER LOGIN"
  databases=$(psql_as kumiwork_migrate -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'agentfactory%'")
  {
    echo "ALTER ROLE agentfactory RENAME TO kumiwork;"
    echo "ALTER ROLE kumiwork PASSWORD 'kumiwork';"
    for db in $databases; do
      echo "ALTER DATABASE \"$db\" RENAME TO \"kumiwork${db#agentfactory}\";"
    done
  } | psql_as kumiwork_migrate --single-transaction || {
    psql_as agentfactory -c "DROP ROLE IF EXISTS kumiwork_migrate" >/dev/null 2>&1 || true
    echo "Rename failed and was rolled back. Stop anything connected to the database and re-run." >&2
    exit 1
  }
  psql_as kumiwork -c "DROP ROLE kumiwork_migrate"
  echo "Renamed role agentfactory -> kumiwork and databases:" $databases
elif can_connect_as kumiwork; then
  echo "Role kumiwork already in place; nothing to rename."
else
  echo "Could not connect as agentfactory or kumiwork." >&2
  exit 1
fi

rewrite_env_files

echo
echo "Done. Once pnpm dev:all works, remove the old volumes with:"
echo "  docker volume rm $OLD_PG_VOLUME $OLD_REDIS_VOLUME"
