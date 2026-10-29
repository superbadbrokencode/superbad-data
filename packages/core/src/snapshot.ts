/**
 * Turns one day of TCGCSV plus the days before it into the files Buy Desk
 * reads (docs/schema.md): catalog.json, one row per priced printing of
 * every TCGplayer product, with the market price 7 and 30 days earlier
 * from the history files, and today's history file.
 *
 * Plain TypeScript, no dependencies, no I/O: jobs/prices/build.ts reads and
 * writes the files.
 */
import type { Issue, TcgcsvCategoryDay, TcgcsvProduct } from './tcgcsv.ts';

export type Language = 'en' | 'ja';
export type Kind = 'card' | 'sealed';

/** The columns of every row of catalog.json, in order. docs/schema.md says what each holds. */
export const CATALOG_COLUMNS = [
  'id',
  'sub',
  'lang',
  'kind',
  'setId',
  'name',
  'number',
  'rarity',
  'market',
  'low',
  'm7',
  'm30',
  'img',
] as const;

export type CatalogRow = [
  id: number,
  sub: string | null,
  lang: Language,
  kind: Kind,
  setId: number,
  name: string,
  number: string | null,
  rarity: string | null,
  market: number | null,
  low: number | null,
  m7: number | null,
  m30: number | null,
  img: 0 | 1,
];

export interface CatalogSet {
  name: string;
  /** TCGplayer's abbreviation ("MEW"); '' when it has none. */
  code: string;
  lang: Language;
  /** The set's release date, or null. */
  released: string | null;
}

export interface Catalog {
  source: 'tcgcsv';
  /** When TCGCSV last refreshed: the moment every price is as of (ISO 8601, UTC). */
  asOf: string;
  columns: typeof CATALOG_COLUMNS;
  /** Keyed by TCGplayer's group id, as a string, since JSON keys are. */
  sets: Record<string, CatalogSet>;
  rows: CatalogRow[];
}

/** One day's market prices, keyed by priceKey: data/history/<day>.json. */
export interface HistoryDay {
  /** The UTC date of asOf: the file's name. */
  day: string;
  asOf: string;
  market: Record<string, number>;
}

/** How far back the catalog's earlier prices look, and how many days off the mark a history day may be. */
export const LOOKBACKS = {
  m7: { back: 7, within: 2 },
  m30: { back: 30, within: 3 },
} as const;

export interface CategoryCounts {
  groups: number;
  products: number;
  cards: number;
  sealed: number;
  rows: number;
  priced: number;
}

export interface Summary {
  source: 'tcgcsv';
  asOf: string;
  day: string;
  categories: Record<string, CategoryCounts>;
  rows: number;
  priced: number;
  withM7: number;
  withM30: number;
  /** The history days the earlier prices came from, or null when none was close enough. */
  lookback: { m7: string | null; m30: string | null };
  historyDays: string[];
  issueCounts: Record<string, number>;
  /** The first few of each kind, so the summary stays small. */
  issues: Issue[];
}

/** "<product id>:<printing>": the key of a price in the history files, and how the old tracker keys TCGplayer prices. */
export function priceKey(id: number, printing: string): string {
  return `${id}:${printing}`;
}

/**
 * TCGCSV's last-updated text ("2026-10-28T20:06:05+0000") as an ISO 8601
 * UTC timestamp ("2026-10-28T20:06:05Z"). Throws on anything else: the
 * date every price is as of must never be guessed.
 */
export function parseAsOf(text: string): string {
  const fixed = text.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const time = new Date(fixed).getTime();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(fixed) || Number.isNaN(time)) {
    throw new Error(`not a timestamp: "${text.slice(0, 40)}"`);
  }
  return new Date(time).toISOString().replace(/\.000Z$/, 'Z');
}

/** The UTC date of an ISO timestamp: "2026-10-28". */
export function dayOf(asOf: string): string {
  return asOf.slice(0, 10);
}

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  const time = new Date(`${day}T00:00:00Z`).getTime();
  // A date that reads back as itself: "2026-02-30" would read as March 2.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(time) ||
    new Date(time).toISOString().slice(0, 10) !== day
  ) {
    throw new RangeError(`not a date: "${day}"`);
  }
  return Math.round(time / DAY_MS);
}

/** Days from one date to another: daysBetween("2026-10-01", "2026-10-08") is 7. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** A date some days before another: dayBefore("2026-10-08", 7) is "2026-10-01". */
export function dayBefore(day: string, days: number): string {
  return new Date((dayNumber(day) - days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The history day to read an earlier price from: the one nearest to `back`
 * days before today, at most `within` days off it, the later day when two
 * are as near. Today's own day never counts, and null means no day was
 * close enough, so the earlier price stays unknown rather than stale.
 */
export function lookback(
  history: readonly HistoryDay[],
  today: string,
  back: number,
  within: number,
): HistoryDay | null {
  const target = dayBefore(today, back);
  let best: HistoryDay | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const day of history) {
    if (day.day === today) continue;
    const distance = Math.abs(daysBetween(target, day.day));
    if (distance > within) continue;
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && day.day > best.day)
    ) {
      best = day;
      bestDistance = distance;
    }
  }
  return best;
}

/** Which history days to keep in the tree: enough for the 30-day lookback with room to spare. */
export const HISTORY_KEEP_DAYS = 45;

export function keptHistory(history: readonly HistoryDay[], today: string): HistoryDay[] {
  return history
    .filter((day) => day.day !== today && daysBetween(day.day, today) <= HISTORY_KEEP_DAYS)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface Snapshot {
  catalog: Catalog;
  today: HistoryDay;
  summary: Summary;
}

function kindOf(product: TcgcsvProduct): Kind {
  return product.isCard ? 'card' : 'sealed';
}

const compareRows = (a: CatalogRow, b: CatalogRow): number =>
  a[2].localeCompare(b[2]) || a[4] - b[4] || a[0] - b[0] || (a[1] ?? '').localeCompare(b[1] ?? '');

/** The catalog, today's history and the summary from the day's reads and the history days before it. */
export function buildSnapshot(
  days: readonly TcgcsvCategoryDay[],
  history: readonly HistoryDay[],
  asOf: string,
  readIssues: readonly Issue[] = [],
): Snapshot {
  const today = dayOf(asOf);
  const issues: Issue[] = [...readIssues];
  const earlier = {
    m7: lookback(history, today, LOOKBACKS.m7.back, LOOKBACKS.m7.within),
    m30: lookback(history, today, LOOKBACKS.m30.back, LOOKBACKS.m30.within),
  };
  const sets: Record<string, CatalogSet> = {};
  const rows: CatalogRow[] = [];
  const market: Record<string, number> = {};
  const categories: Record<string, CategoryCounts> = {};

  for (const day of days) {
    const lang = day.category.language;
    const counts: CategoryCounts = {
      groups: day.groups.length,
      products: day.products.length,
      cards: 0,
      sealed: 0,
      rows: 0,
      priced: 0,
    };
    for (const group of day.groups) {
      sets[String(group.groupId)] = {
        name: group.name,
        code: group.abbreviation,
        lang,
        released: group.publishedOn,
      };
    }
    const products = new Map<number, TcgcsvProduct>();
    for (const product of day.products) {
      if (products.has(product.productId)) {
        issues.push({
          kind: 'product-duplicate',
          path: `${day.category.id}/${product.groupId}/products`,
          detail: String(product.productId),
        });
        continue;
      }
      products.set(product.productId, product);
      if (product.isCard) counts.cards++;
      else counts.sealed++;
    }
    const priced = new Map<
      number,
      { printing: string; market: number | null; low: number | null }[]
    >();
    const seen = new Set<string>();
    for (const price of day.prices) {
      const product = products.get(price.productId);
      if (product === undefined) {
        issues.push({
          kind: 'price-orphan',
          path: `${day.category.id}/prices`,
          detail: `${price.productId}:${price.printing}`,
        });
        continue;
      }
      const key = priceKey(price.productId, price.printing);
      if (seen.has(key)) {
        issues.push({
          kind: 'price-duplicate',
          path: `${day.category.id}/${product.groupId}/prices`,
          detail: key,
        });
        continue;
      }
      seen.add(key);
      const list = priced.get(price.productId) ?? [];
      list.push({ printing: price.printing, market: price.market, low: price.low });
      priced.set(price.productId, list);
    }
    for (const product of products.values()) {
      const printings = priced.get(product.productId) ?? [
        { printing: null, market: null, low: null },
      ];
      for (const printing of printings) {
        const key =
          printing.printing === null ? null : priceKey(product.productId, printing.printing);
        if (key !== null && printing.market !== null) {
          market[key] = printing.market;
          counts.priced++;
        }
        rows.push([
          product.productId,
          printing.printing,
          lang,
          kindOf(product),
          product.groupId,
          product.name,
          product.number,
          product.rarity,
          printing.market,
          printing.low,
          key === null ? null : (earlier.m7?.market[key] ?? null),
          key === null ? null : (earlier.m30?.market[key] ?? null),
          product.hasImage ? 1 : 0,
        ]);
        counts.rows++;
      }
    }
    categories[String(day.category.id)] = counts;
  }
  rows.sort(compareRows);

  const issueCounts: Record<string, number> = {};
  for (const issue of issues) issueCounts[issue.kind] = (issueCounts[issue.kind] ?? 0) + 1;
  const kept = keptHistory(history, today);
  const summary: Summary = {
    source: 'tcgcsv',
    asOf,
    day: today,
    categories,
    rows: rows.length,
    priced: rows.filter((row) => row[8] !== null).length,
    withM7: rows.filter((row) => row[10] !== null).length,
    withM30: rows.filter((row) => row[11] !== null).length,
    lookback: { m7: earlier.m7?.day ?? null, m30: earlier.m30?.day ?? null },
    historyDays: [...kept.map((day) => day.day), today],
    issueCounts,
    issues: Object.keys(issueCounts).flatMap((kind) =>
      issues.filter((issue) => issue.kind === kind).slice(0, 5),
    ),
  };
  return {
    catalog: { source: 'tcgcsv', asOf, columns: CATALOG_COLUMNS, sets, rows },
    today: {
      day: today,
      asOf,
      market: Object.fromEntries(Object.entries(market).sort(([a], [b]) => a.localeCompare(b))),
    },
    summary,
  };
}
