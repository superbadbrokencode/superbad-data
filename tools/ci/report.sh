#!/usr/bin/env bash
# Runs one step of a workflow. If it fails, the end of its output is repeated
# as a GitHub annotation, so the failure can be read from the run's page and
# the API without downloading logs. Usage: tools/ci/report.sh "<title>" <command> [args...]
set -uo pipefail

title=$1
shift
out=$(mktemp)
"$@" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ] && [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  message=$(tail -c 4000 "$out" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN { ORS = "%0A" } { print }')
  echo "::error title=${title}::${message}"
fi
rm -f "$out"
exit "$status"
