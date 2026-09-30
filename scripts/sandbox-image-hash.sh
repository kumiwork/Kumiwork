#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../apps/worker/sandbox-image"
find . -type f -not -path './node_modules/*' | LC_ALL=C sort | while IFS= read -r file; do
  printf '%s  %s\n' "$(shasum -a 256 "$file" | cut -d' ' -f1)" "$file"
done | shasum -a 256 | cut -d' ' -f1
