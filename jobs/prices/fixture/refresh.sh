#!/usr/bin/env bash
# Rebuilds the fixture's expected output, out/, from raw/ and history/ after
# the job or the fixture changes. build.test.ts holds the job to it byte for
# byte, so read the diff before committing: a change here is a change to what
# every consumer of data/ will read.
#
# Usage: bash jobs/prices/fixture/refresh.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."
fixture=jobs/prices/fixture
rm -rf "$fixture/out"
node jobs/prices/build.ts --raw "$fixture/raw" --history "$fixture/history" --out "$fixture/out" >/dev/null
echo "Fixture refreshed: $fixture/out"
