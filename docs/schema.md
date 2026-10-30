# The data tree

What the Prices workflow commits under `data/`, nightly, and what each file holds. Every consumer (the Buy Desk page, the PC engine, the old tracker, the TCG App) reads these files and nothing else, so a change here is a change for all of them: it gets a decision record (docs/decisions) and keeps old readers working (a new column goes at the end of the row; a column is never renamed or removed without a new file name).

## Where to read it from

- `https://raw.githubusercontent.com/superbadbrokencode/superbad-data/main/data/catalog.json` (open CORS, cached about 5 minutes, gzipped on request).
- `https://cdn.jsdelivr.net/gh/superbadbrokencode/superbad-data@main/data/catalog.json` (open CORS, cached up to 12 hours).

The same paths serve `summary.json` and `history/<day>.json`.

A page that can load scripts only from a CDN (a claude.ai artifact: its CSP blocks fetch() to both hosts above) reads the day's catalog as an npm package instead, one version per data day, named by that day as CalVer: `https://cdn.jsdelivr.net/npm/superbad-data@2026.10.28/catalog.js` sets `self.SUPERBAD_CATALOG_TEXT` to the text of catalog.json, and `summary.js` does the same for summary.json (docs/decisions/0002-the-npm-feed.md). The Prices workflow publishes it nightly by trusted publishing; versions start on 2026.10.29.

## data/catalog.json

Every TCGplayer product in the Pokémon (English) and Pokémon Japan categories, one row per printing TCGplayer prices, as of TCGCSV's last refresh. About 80,000 rows, 8 MB (1.3 MB gzipped).

```json
{
  "source": "tcgcsv",
  "asOf": "2026-10-28T20:06:05Z",
  "columns": ["id", "sub", "lang", "kind", "setId", "name", "number", "rarity", "market", "low", "m7", "m30", "img"],
  "sets": {
    "23237": { "name": "SV: Scarlet & Violet 151", "code": "MEW", "lang": "en", "released": "2023-09-22" }
  },
  "rows": [
    [502558, "Holofoil", "en", "card", 23237, "Charizard ex - 006/165", "006/165", "Double Rare", 8.46, 5.75, null, null, 1]
  ]
}
```

| Field | What it holds |
| --- | --- |
| `source` | Always `tcgcsv`: the prices are TCGplayer's, read from tcgcsv.com. |
| `asOf` | When TCGCSV last refreshed, UTC: the moment every price is as of. |
| `columns` | The name of each position in a row, in order. Read rows by these names, never by position alone. |
| `sets` | TCGplayer's groups, keyed by group id (a string, since JSON keys are): `name` as TCGplayer writes it ("M6: Storm Emeralda"), `code` its abbreviation (`""` when it has none), `lang`, and `released`, the set's release date or null. |
| `rows` | One row per product and printing, sorted by `lang` (en first), `setId`, `id`, `sub`. |

The columns of a row:

| Column | Type | What it holds |
| --- | --- | --- |
| `id` | number | TCGplayer's product id. The picture is `https://tcgplayer-cdn.tcgplayer.com/product/<id>_200w.jpg` (also `_in_1000x1000.jpg`) when `img` is 1. |
| `sub` | string or null | The printing, as TCGplayer names it: `Normal`, `Holofoil`, `Reverse Holofoil`, `1st Edition`, `1st Edition Holofoil`, `Unlimited`, `Unlimited Holofoil`. Null for a product TCGplayer prices under no printing at all (then `market` and `low` are null too). |
| `lang` | `en` or `ja` | The category: English (3) or Japanese (85). |
| `kind` | `card` or `sealed` | A card carries at least one card field on TCGplayer (number, rarity, HP, type, stage or an attack); anything else is sealed: boxes, packs, bundles, collections, tins, decks. |
| `setId` | number | The group id: look it up in `sets`. |
| `name` | string | As TCGplayer writes it, qualifiers included: "Charizard ex - 006/165", "Doduo (Master Ball Pattern)", "151 Booster Bundle". Some sets carry the number in the name and some don't; strip ` - 006/165` and `(…)` before matching names. |
| `number` | string or null | The number printed on the card, as written: "006/165", "SV001", "TG01/TG30". Null for sealed products, unnumbered cards and the few two-card products whose number TCGplayer writes oddly (counted in summary.json). The part after the slash is the set's size, a strong hint of the set when a name alone is ambiguous. |
| `rarity` | string or null | TCGplayer's rarity name as written: English "Illustration Rare", "Special Illustration Rare", "Double Rare"; Japanese "Art Rare", "Super Rare", "Special Art Rare". Null when TCGplayer gives none, or writes None or Unconfirmed (a set not out yet). |
| `market` | number or null | TCGplayer's market price in US dollars, two decimals, as TCGCSV writes it. Null when TCGplayer has none (a presale, or nothing sold). |
| `low` | number or null | The lowest listing on TCGplayer, the same way. |
| `m7` | number or null | The market price 7 days earlier, from the history day nearest 7 days before `asOf`, at most 2 days off it. Null until a week of history exists, when that day has no price for the row, or when no day is near enough. |
| `m30` | number or null | The market price 30 days earlier, the same way, at most 3 days off the mark. |
| `img` | 1 or 0 | Whether TCGplayer has a picture of the product. |

Rules the job applies, and never bends:

- A row holds only what TCGplayer says. The job never guesses a number, a rarity, a set or a price; what it can't read is left null and counted in summary.json.
- A price is never moved back in time: `asOf` only goes forward, and a day TCGCSV hasn't refreshed changes nothing in the repo.
- A day with fewer than 90% of the previous day's prices is refused, since that's a broken download, not a market.
- Prices are in US dollars for both languages, condition near mint, as TCGplayer sells them.

What the old tracker and the TCG App call these: the tracker's `tcgId` is `id` and its `tcgSub` is `sub`, so its price key `"<tcgId>:<tcgSub>"` is this file's `id` and `sub` joined by a colon, the key the history files use. The TCG App links a catalog product to TCGplayer by the same product id and printing.

## data/history/<day>.json

One file per day TCGCSV refreshed, named by the UTC date of `asOf`, holding every market price of that day (about 67,000; 1.7 MB, 320 KB gzipped). The job keeps the last 45 days in the tree and drops older files; git keeps them all.

```json
{
  "day": "2026-10-28",
  "asOf": "2026-10-28T20:06:05Z",
  "market": {
    "502558:Holofoil": 8.46
  }
}
```

`market` is keyed `"<id>:<sub>"` and holds only rows that had a market price that day, so a missing key means TCGplayer had no market price, not zero.

## data/summary.json

What the last run found: `asOf` and `day`; per category (`3` English, `85` Japanese) the groups, products, cards, sealed products, rows and priced rows; the totals `rows`, `priced`, `withM7` and `withM30`; `lookback`, the history days the earlier prices came from (null when none was near enough); `historyDays`, the days in the tree; and the issues, counted by kind with the first few examples of each. Read it to see whether the night's run landed before trusting `asOf`.
