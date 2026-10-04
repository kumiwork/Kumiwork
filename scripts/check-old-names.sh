#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

matches=$(git grep -n -i -E 'agentfactory|agent factory|(^|[^a-z0-9])arata|or-borco|af_session' -- \
  ':!pnpm-lock.yaml' ':!scripts/check-old-names.sh' ':!scripts/migrate-local-dev-names.sh' \
  | grep -v -E '^apps/worker/src/(secret-masking|sandbox-cache|sandbox-image-select)\.ts:[0-9]+:.*LEGACY_[A-Z_]+ = ' \
  | grep -v -E '^apps/worker/src/__tests__/secret-masking\.test\.ts:[0-9]+: +const legacy[A-Za-z]* = "arata-run-' \
  | grep -v -E '^apps/web/src/server/auth\.ts:[0-9]+:const COOKIE_NAME = "af_session";$' \
  || true)

if [ -n "$matches" ]; then
  echo "Old product names found:" >&2
  echo "$matches" >&2
  exit 1
fi
