#!/usr/bin/env bash
# Copies the Anchor build artifacts (IDL + generated types) into the places
# the keeper, the frontend and the e2e scripts consume them from.
# Run after `anchor build` inside program/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/keeper/idl" "$ROOT/app/src/idl"
cp "$ROOT/program/target/idl/safexy_escrow.json" "$ROOT/keeper/idl/"
cp "$ROOT/program/target/types/safexy_escrow.ts" "$ROOT/keeper/src/safexy_escrow.ts"
cp "$ROOT/program/target/idl/safexy_escrow.json" "$ROOT/app/src/idl/"
cp "$ROOT/program/target/types/safexy_escrow.ts" "$ROOT/app/src/idl/types.ts"
cp "$ROOT/program/target/types/safexy_escrow.ts" "$ROOT/tests/safexy_escrow.ts"
echo "IDL + types synced to keeper/, app/ and tests/"
