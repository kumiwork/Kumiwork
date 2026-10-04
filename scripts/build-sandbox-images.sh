#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

hash="$(scripts/sandbox-image-hash.sh)"

for lang in node python java; do
  echo "Building kumiwork-sandbox-$lang:local (source hash $hash)..."
  docker build --target "$lang" --build-arg "SANDBOX_SOURCE_HASH=$hash" -t "kumiwork-sandbox-$lang:local" apps/worker/sandbox-image
done
