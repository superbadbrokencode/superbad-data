/**
 * Prices job, step 1 of 2: download one day of TCGplayer's catalog and
 * prices from TCGCSV for Pokémon (category 3, English) and Pokémon Japan
 * (category 85). Holds no secrets.
 *
 * Writes the response bodies unchanged, so a run's raw download can be kept
 * and read again:
 *   <out>/meta.json                       when TCGCSV last updated, counts
 *   <out>/<category>/groups.json          TCGplayer's sets ("groups")
 *   <out>/<category>/<group>/products.json
 *   <out>/<category>/<group>/prices.json
 *
 * Usage: node jobs/prices/fetch.ts --out <dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { TCGCSV_CATEGORIES, tcgcsvResults } from '../../packages/core/src/tcgcsv.ts';

const BASE = 'https://tcgcsv.com';
/** Requests in flight at once: a light, steady load on a free service. */
const CONCURRENCY = 4;
/** More failed requests than this share of a category's means something is wrong upstream: stop. */
const MAX_FAILED_SHARE = 0.02;
const USER_AGENT =
  'superbad-data prices job (GitHub Actions; github.com/superbadbrokencode/superbad-data)';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) {
  console.error('Usage: node jobs/prices/fetch.ts --out <dir>');
  process.exit(2);
}
const outDir = values.out;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.status = status;
  }
}

/** The body as text, retrying timeouts, 429s and server errors a few times. */
async function getText(path: string): Promise<string> {
  const url = `${BASE}${path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/plain' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.text();
      if (response.status !== 429 && response.status < 500) {
        throw new HttpError(response.status, url);
      }
      if (attempt >= 4) throw new HttpError(response.status, url);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      if (attempt >= 4) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
}

async function inPool<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

const started = new Date();
const lastUpdated = (await getText('/last-updated.txt')).trim();
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(lastUpdated)) {
  throw new Error(`last-updated.txt is not a timestamp: "${lastUpdated.slice(0, 40)}"`);
}
const meta: {
  source: string;
  lastUpdated: string;
  fetchedAt: string;
  categories: Record<
    string,
    { groups: number; products: number; prices: number; failed: string[] }
  >;
} = { source: 'tcgcsv', lastUpdated, fetchedAt: started.toISOString(), categories: {} };

for (const category of TCGCSV_CATEGORIES) {
  const dir = join(outDir, String(category.id));
  mkdirSync(dir, { recursive: true });
  const groupsBody = await getText(`/tcgplayer/${category.id}/groups`);
  writeFileSync(join(dir, 'groups.json'), groupsBody);
  const groupIds = tcgcsvResults(groupsBody, `${category.id}/groups`).map((group) => {
    const id = (group as { groupId?: unknown }).groupId;
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      throw new Error(`${category.id}/groups: a group without a whole-number groupId`);
    }
    return id;
  });
  if (groupIds.length === 0) throw new Error(`${category.id}/groups: no groups`);

  const stats = { groups: groupIds.length, products: 0, prices: 0, failed: [] as string[] };
  await inPool(groupIds, async (groupId) => {
    const groupDir = join(dir, String(groupId));
    mkdirSync(groupDir, { recursive: true });
    for (const file of ['products', 'prices'] as const) {
      const path = `/tcgplayer/${category.id}/${groupId}/${file}`;
      try {
        const body = await getText(path);
        const count = tcgcsvResults(body, path).length;
        writeFileSync(join(groupDir, `${file}.json`), body);
        stats[file] += count;
      } catch (error) {
        stats.failed.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  meta.categories[category.id] = stats;
  console.log(
    `Category ${category.id} (${category.language}): ${stats.groups} groups, ` +
      `${stats.products} products, ${stats.prices} prices, ${stats.failed.length} failed`,
  );
  if (stats.failed.length > groupIds.length * 2 * MAX_FAILED_SHARE) {
    for (const failure of stats.failed.slice(0, 10)) console.error(failure);
    throw new Error(`${stats.failed.length} TCGCSV requests failed in category ${category.id}`);
  }
}

writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(
  `TCGCSV last updated ${lastUpdated}; fetched in ${Math.round((Date.now() - started.getTime()) / 1000)} s`,
);
