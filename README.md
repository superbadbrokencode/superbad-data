# superbad-data

Nightly TCGplayer price snapshots for Buy Desk: every English and Japanese Pokémon card and sealed product, with its market price and the prices 7 and 30 days earlier, in files a browser page or a script reads straight from GitHub. The prices are TCGplayer's, republished daily by [TCGCSV](https://tcgcsv.com); this repo keeps a day's worth and the history TCGCSV no longer shares.

Start with [the data tree](docs/schema.md), then [the decision record](docs/decisions/0001-the-data-job.md).

| Path | What's there |
| --- | --- |
| data | What the Prices workflow commits every night: catalog.json, summary.json and history/ |
| jobs/prices | The job: fetch.ts downloads a day from TCGCSV, build.ts writes the data tree |
| packages/core | The reading and snapshot rules: plain TypeScript, no dependencies, no I/O |
| docs | The data tree's schema and the decision records |

## Reading the data

- `https://raw.githubusercontent.com/superbadbrokencode/superbad-data/main/data/catalog.json`
- `https://cdn.jsdelivr.net/gh/superbadbrokencode/superbad-data@main/data/catalog.json`

## Running the job

Node 22.18 or later runs the TypeScript directly, with no installs:

    node jobs/prices/fetch.ts --out /tmp/raw
    node jobs/prices/build.ts --raw /tmp/raw --history data/history --out /tmp/out

The workflow (.github/workflows/prices.yml) does the same nightly at 21:37 UTC and commits the result.

## Checks

    pnpm install
    pnpm lint && pnpm format:check && pnpm typecheck && pnpm test

CI runs them on every push that changes code. The unit tests alone need no installs: `node --test "packages/core/src/**/*.test.ts" "jobs/**/*.test.ts"`.
