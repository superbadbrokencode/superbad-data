# 0001: The data job

Date: Oct 29, 2026. Phase 0 of Buy Desk, on Fable 5.1. The job in jobs/prices and .github/workflows/prices.yml; the rules in packages/core; unit tests in packages/core/src and jobs/prices; the files it writes, docs/schema.md.

## Context

Buy Desk shows the most to pay for a card selling live, from its owner's own rules, fast enough for 7-second auctions and with no AI call per lookup. Its two fronts, a phone page now and a PC engine later, need the same thing under them: TCGplayer's market price for every English and Japanese Pokémon card and sealed product, refreshed nightly, with the price a week and a month earlier for hot and cold flags, read from a browser page with no server and no secrets. From a browser page the only cross-origin source at hand is GitHub, so the data lives in a public repo of its own, apart from the TCG App's, and a GitHub Actions workflow writes it.

The price source is TCGCSV, which republishes TCGplayer's catalog and prices once a day, around 20:00 UTC, for Pokémon (category 3, English) and Pokémon Japan (category 85): groups (TCGplayer's sets), products and prices per printing. On Oct 28, 2026 that was 220 English groups with 32,953 products and 45,408 prices, and 461 Japanese groups with 30,741 products and 28,758 prices, 88 MB raw, downloaded in 8 seconds. TCGCSV's own daily price archive is offline (its page says so: server costs and moderation), so the only history is what this job keeps.

The TCG App has a TCGCSV job of its own (its decision 0010) that matches TCGplayer's products onto a catalog built from TCGdex and PokéAPI. This repo borrows its shape, not its files: the fetch and build steps, fixtures and tests, pinned actions and annotations, plain TypeScript run by Node with no build step. Nothing from the app is copied verbatim, and nothing of the business (its buy rules, its stock) goes in a public repo. The job keeps TCGplayer's own ids and names instead of matching onto a catalog, since the fronts search TCGplayer's names and numbers directly and the app's catalog can take these rows by the same product id and printing later.

## Decision

**Two steps, no secrets.** fetch.ts downloads one day of TCGCSV, raw and unchanged, with four requests in flight and a stop when more than 2% of a category's requests fail. build.ts reads the download and the history days already in the repo, builds the data tree with packages/core (plain TypeScript, no I/O), and writes it to a temporary folder. The workflow replaces `data/` with that folder on main and commits it as "Prices as of <asOf>", pushing with the run's own token, which starts no other workflow. Off main the build runs and nothing is committed. It runs nightly at 21:37 UTC, by hand, and when the job's code changes, and keeps each main run's raw download for 14 days as an artifact.

**The files** are docs/schema.md's: catalog.json, one row per priced printing of every product, with the sets apart from the rows, the columns named once and each row an array (about 8 MB, 1.3 MB gzipped, for a phone to load once a day); history/<day>.json, every market price of a day keyed `"<id>:<sub>"`, the old tracker's own key; and summary.json, the run's counts and issues.

**The rules, in packages/core with unit tests:**

- A product is a card when TCGplayer gives it any card field (number, rarity, HP, type, stage, an attack); anything else is sealed.
- A number stays as printed, slash and all ("006/165"), since the part after the slash says which set a card is from when its name is ambiguous. A number TCGplayer writes oddly (a two-card product: "094/103(LeftHalf)…") is left null and counted.
- A rarity stays as TCGplayer writes it; None and Unconfirmed are null.
- A group's date is kept only when it's a real one: TCGplayer dates every set at midnight UTC and gives dateless groups TCGCSV's own publish time, which would date them today, every day.
- Prices are read as TCGCSV writes them, dollars with two decimals; anything else stops the job, since that means the format changed.
- The price 7 days earlier comes from the history day nearest 7 days before today, at most 2 days off it, the later day on a tie, never today's own day; 30 days earlier the same way, at most 3 days off. No day near enough means null, never a stale price.
- A product with no price rows at all keeps one row with no printing and no price, so the fronts can still find it by name.
- A day with fewer than 90% of the previous day's prices is refused. The tree keeps 45 days of history; git keeps every day ever committed.
- The same inputs write the same bytes, one row and one price per line, so a day TCGCSV hasn't refreshed changes nothing and a day that has shows a readable diff.

**What the data job never does:** no graded prices (PriceCharting's terms and eBay's automation ban leave no source a script may read; grading stays a flag and a link the owner opens himself), no prices for Chinese or Korean cards (TCGplayer has no category for them), no buy rules (those are the business's, and go with the fronts in a private repo).

## Consequences

- The first data landed with this decision, from the Oct 28, 2026 day: 80,345 rows, 67,359 priced; 46,909 English rows (30,012 cards and 2,941 sealed products) and 33,436 Japanese (30,417 cards, 324 sealed); 22 numbers left null. `m7` fills from about Nov 4 and `m30` from about Nov 27, since no history older than this day exists.
- The repo grows by what git stores of a day's changes: a catalog.json of about 8 MB rewritten with mostly the same lines, and a 1.7 MB history file, perhaps half a megabyte a day packed. At a gigabyte, a year or two on, the history starts over on a fresh branch; the TCG App keeps 13 weeks of weekly prices of its own and needs nothing from here.
- The phone page reads `catalog.json` from raw.githubusercontent.com or jsDelivr (docs/schema.md); which host a published page may reach is checked when the page is built. The PC engine loads the same file into SQLite.
- Consumers key prices as the old tracker does, `"<tcgId>:<tcgSub>"`, so the tracker's price refresh could read from here instead of third-party mirrors; that move is parked in the Superbad project.
- jobs/prices/fixture holds a trimmed real day (seven groups, 34 products, 33 prices) and made-up history days; build.test.ts holds the job to its expected output byte for byte, and `bash jobs/prices/fixture/refresh.sh` rebuilds that output when the job changes.
