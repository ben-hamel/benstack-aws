#!/usr/bin/env bash
# Usage: bash scripts/aws-emulator-smoke.sh [/path/to/aws-emulator]
set -euo pipefail
cd "$(dirname "$0")/.."
binary=$(command -v "${1:-aws-emulator}") || { echo 'Install AWS Emulator or pass its binary path.' >&2; exit 1; }
work=$(mktemp -d)
pid=
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir "$work/home"
HOME="$work/home" "$binary" -p 0 -t off --idle-timeout 120 > "$work/emulator.log" 2>&1 &
pid=$!
directory=
for ((i=0; i<30; i++)); do
  for candidate in "$work/home/.aws/emulator/"*; do
    if [[ -f "$candidate/emulator_credentials" && -f "$candidate/ca.pem" ]]; then directory=$candidate; break; fi
  done
  if [[ -n "$directory" ]] && curl -fsS --cacert "$directory/ca.pem" "https://127.0.0.1:${directory##*/}/__admin/health" > /dev/null 2>&1; then break; fi
  sleep 1
done
if [[ -z "$directory" ]]; then echo "Emulator failed to start." >&2; exit 1; fi
EMULATOR_ENDPOINT="https://127.0.0.1:${directory##*/}" \
EMULATOR_DIRECTORY="$directory" NODE_EXTRA_CA_CERTS="$directory/ca.pem" \
node scripts/aws-emulator-smoke.mjs
