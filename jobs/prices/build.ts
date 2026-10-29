/**
 * Prices job, step 2 of 2: turn the raw download from fetch.ts and the
 * history days already in the repo into the data/ tree (docs/schema.md):
 *   <out>/catalog.json        every TCGplayer product and printing, with its
 *                             market price and the prices 7 and 30 days earlier
 *   <out>/summary.json        counts, the history days used, issues
 *   <out>/history/<day>.json  today's market prices by product and printing,
 *                             beside the kept days copied from --history
 *
 * The workflow replaces data/ with <out> on main. Holds no secrets. Writes
 * the same bytes for the same inputs, so a day TCGCSV hasn't refreshed
 * changes nothing in the repo.
 *
 * Usage:
 *   node jobs/prices/build.ts --raw <dir> --history <dir> --out <dir>
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildSnapshot,
  keptHistory,
  parseAsOf,
  type Catalog,
  type HistoryDay,
} from '../../packages/core/src/snapshot.ts';
import {
  TCGCSV_CATEGORIES,
  readGroups,
  readPrices,
  readProducts,
  tcgcsvResults,
  type Issue,
  type TcgcsvCategoryDay,
} from '../../packages/core/src/tcgcsv.ts';

/** More unreadable rows than this share means the source's format changed: stop. */
const MAX_UNREADABLE_SHARE = 0.01;
/** Fewer rows than this share of the newest history day means a shrunken download: stop. */
const MIN_ROWS_SHARE = 0.9;

const { values } = parseArgs({
  options: {
    raw: { type: 'string' },
    history: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.raw || !values.history || !values.out) {
  console.error('Usage: node jobs/prices/build.ts --raw <dir> --history <dir> --out <dir>');
  process.exit(2);
}
const rawDir = values.raw;
const historyDir = values.history;
const outDir = values.out;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

// When TCGCSV last refreshed: the moment every price in this run is as of.
const meta = readJson(join(rawDir, 'meta.json')) as { lastUpdated?: unknown };
if (typeof meta.lastUpdated !== 'string') {
  throw new Error(`meta.json has no lastUpdated: ${JSON.stringify(meta.lastUpdated)}`);
}
const asOf = parseAsOf(meta.lastUpdated);

const issues: Issue[] = [];
let rowsRead = 0;
const days: TcgcsvCategoryDay[] = TCGCSV_CATEGORIES.map((category) => {
  const dir = join(rawDir, String(category.id));
  const groups = readGroups(readJson(join(dir, 'groups.json')), category.id, issues);
  rowsRead += groups.length;
  const day: TcgcsvCategoryDay = { category, groups, products: [], prices: [] };
  for (const group of groups) {
    for (const file of ['products', 'prices'] as const) {
      const path = join(dir, String(group.groupId), `${file}.json`);
      const label = `${category.id}/${group.groupId}/${file}`;
      if (!existsSync(path)) {
        issues.push({ kind: 'file-missing', path: label, detail: '' });
        continue;
      }
      const body = readJson(path);
      rowsRead += tcgcsvResults(body, label).length;
      if (file === 'products') {
        day.products.push(...readProducts(body, category.id, group.groupId, issues));
      } else {
        day.prices.push(...readPrices(body, label, issues));
      }
    }
  }
  if (groups.length === 0 || day.products.length === 0 || day.prices.length === 0) {
    throw new Error(`TCGCSV category ${category.id} has no groups, products or prices`);
  }
  return day;
});
// Rows that couldn't be read at all; a card whose number alone is odd still has its row.
const ROW_ISSUES = new Set(['group-unreadable', 'product-unreadable', 'price-unreadable']);
const unreadable = issues.filter((issue) => ROW_ISSUES.has(issue.kind)).length;
if (unreadable > rowsRead * MAX_UNREADABLE_SHARE) {
  for (const problem of issues.slice(0, 10)) console.error(`${problem.path}: ${problem.kind}`);
  throw new Error(
    `${unreadable} of ${rowsRead} TCGCSV rows could not be read; the format may have changed`,
  );
}

// The history days already in the repo: data/history/<day>.json.
const history: HistoryDay[] = [];
if (existsSync(historyDir)) {
  for (const name of readdirSync(historyDir).sort()) {
    const named = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1];
    if (named === undefined) continue;
    const day = readJson(join(historyDir, name)) as Partial<HistoryDay>;
    if (
      day.day !== named ||
      typeof day.asOf !== 'string' ||
      typeof day.market !== 'object' ||
      day.market === null
    ) {
      throw new Error(`${name} is not a history day`);
    }
    history.push({ day: named, asOf: day.asOf, market: day.market });
  }
}

const snapshot = buildSnapshot(days, history, asOf, issues);

// A day with far fewer prices than the last one is a broken download, not a market.
const newest = keptHistory(history, snapshot.today.day).at(-1);
if (newest !== undefined) {
  const before = Object.keys(newest.market).length;
  const now = Object.keys(snapshot.today.market).length;
  if (now < before * MIN_ROWS_SHARE) {
    throw new Error(
      `only ${now} prices today against ${before} on ${newest.day}: refusing to write`,
    );
  }
}

/** The catalog with one row, and one set, per line: readable diffs, the same bytes for the same data. */
function catalogText(catalog: Catalog): string {
  const sets = Object.entries(catalog.sets)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, set]) => `${JSON.stringify(id)}:${JSON.stringify(set)}`);
  const rows = catalog.rows.map((row) => JSON.stringify(row));
  return (
    `{"source":${JSON.stringify(catalog.source)},"asOf":${JSON.stringify(catalog.asOf)},` +
    `"columns":${JSON.stringify(catalog.columns)},\n"sets":{\n${sets.join(',\n')}\n},\n` +
    `"rows":[\n${rows.join(',\n')}\n]}\n`
  );
}

/** A history day with one price per line. */
function historyText(day: HistoryDay): string {
  const entries = Object.entries(day.market).map(
    ([key, market]) => `${JSON.stringify(key)}:${JSON.stringify(market)}`,
  );
  return (
    `{"day":${JSON.stringify(day.day)},"asOf":${JSON.stringify(day.asOf)},` +
    `"market":{\n${entries.join(',\n')}\n}}\n`
  );
}

mkdirSync(join(outDir, 'history'), { recursive: true });
writeFileSync(join(outDir, 'catalog.json'), catalogText(snapshot.catalog));
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(snapshot.summary, null, 2)}\n`);
for (const day of keptHistory(history, snapshot.today.day)) {
  writeFileSync(join(outDir, 'history', `${day.day}.json`), historyText(day));
}
writeFileSync(join(outDir, 'history', `${snapshot.today.day}.json`), historyText(snapshot.today));

const { summary } = snapshot;
console.log(
  JSON.stringify(
    {
      asOf: summary.asOf,
      rows: summary.rows,
      priced: summary.priced,
      withM7: summary.withM7,
      withM30: summary.withM30,
      lookback: summary.lookback,
      categories: summary.categories,
      issueCounts: summary.issueCounts,
    },
    null,
    2,
  ),
);
