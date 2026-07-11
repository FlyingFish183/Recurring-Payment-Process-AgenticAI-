#!/usr/bin/env bash
# Prisma CLI with a fresh IAM token (hackathon)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source .env
set +a
eval "$(npx tsx scripts/print-iam-database-url.ts)"
exec npx prisma "$@"
