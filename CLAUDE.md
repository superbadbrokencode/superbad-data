# Working on superbad-data

Read docs/schema.md first: the files under data/ are what every consumer reads, so a change to them gets a decision record in docs/decisions and keeps old readers working. Read docs/decisions/0001-the-data-job.md for why the job is shaped as it is.

## Checks

Before every push: `pnpm install`, then `pnpm lint`, `pnpm format:check` (`pnpm format` fixes it), `pnpm typecheck` and `pnpm test`, the same checks as .github/workflows/ci.yml. Change the script list and ci.yml together. Lint reads tsconfig.json, so a new file outside its include list fails lint: add it there. When a workflow changes, lint it with actionlint (`pip install --break-system-packages actionlint-py`).

- The job runs here as it runs in Actions, since tcgcsv.com is reachable from this workspace: `node jobs/prices/fetch.ts --out <dir>` downloads a day (8 seconds, 88 MB), and `node jobs/prices/build.ts --raw <dir> --history data/history --out <dir>` builds the tree in about 2 seconds. Never point `--out` at data/ by hand: the workflow is what commits data/, so a hand-built tree would need its own commit message and could skip the refusal rules.
- If build.ts, packages/core or the fixture's raw/ or history/ changes, run `bash jobs/prices/fixture/refresh.sh` and read the diff of jobs/prices/fixture/out: build.test.ts holds the job to it byte for byte, and that diff is what every consumer of data/ will see.
- Read a run's result from its annotations: `gh run list --limit 5`, then `gh api 'repos/{owner}/{repo}/actions/runs/<run id>/jobs' --jq '.jobs[] | {name, conclusion, id}'` and `gh api 'repos/{owner}/{repo}/check-runs/<job id>/annotations' --jq '.[].message'`.

## Rules

- Public repo: nothing of the business in it. No buy rules, no stock, no personal details, no secrets (the job needs none: the npm publish uses trusted publishing, docs/decisions/0002-the-npm-feed.md). The data is TCGplayer's public prices and nothing else.
- Borrow the TCG App's shape, never its files: the same layout (jobs/ with fetch and build steps, packages/core for rules with no I/O, fixtures and byte-for-byte tests, pinned actions, annotations), written fresh here. Nothing copied verbatim from a private repo.
- The job never guesses: what it can't read is null and counted in summary.json, and a changed format or a shrunken day stops it rather than writing a wrong day.
- The data tree's columns are added at the end and never renamed or removed (docs/schema.md); a consumer reads rows by column name.
- Workflows pin every action by commit, with its version in a comment, and run with the least permission that works: the Prices workflow writes contents to commit data/, CI reads.
- Dependencies: change package.json and pnpm-lock.yaml together (`pnpm install`). pnpm installs only versions at least 3 days old (minimumReleaseAge in pnpm-workspace.yaml, equal to Dependabot's cooldown).
- Small changes on a branch, CI green before merge, tests and docs in the same commit, never rewrite pushed history. The nightly data commits go straight to main from the workflow, by design.
