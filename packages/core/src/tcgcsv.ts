/**
 * Reads one day of TCGCSV, TCGplayer's catalog and prices as tcgcsv.com
 * republishes them (docs/decisions/0001-the-data-job.md).
 *
 * TCGplayer sorts its products into groups, mostly one per set, and prices
 * each product per printing (Normal, Holofoil, Reverse Holofoil, 1st Edition
 * and so on). Every list TCGCSV serves is { success, errors, results: [...] }.
 * This module turns those lists into plain rows and never guesses: a row it
 * can't read is counted as an issue and left out, and a file without its
 * results list stops the job, since that means the format changed.
 *
 * Plain TypeScript, no dependencies, no I/O: jobs/prices does the reading and
 * writing of files.
 */

export interface TcgcsvCategory {
  id: number;
  /** ISO 639-1: en, ja. */
  language: 'en' | 'ja';
}

/** TCGplayer's Pokémon categories: English (3) and Japanese (85). */
export const TCGCSV_CATEGORIES: readonly TcgcsvCategory[] = [
  { id: 3, language: 'en' },
  { id: 85, language: 'ja' },
];

export interface TcgcsvGroup {
  groupId: number;
  categoryId: number;
  name: string;
  abbreviation: string;
  /** The set's release date, or null when TCGplayer gives it none (see groupDate). */
  publishedOn: string | null;
}

export interface TcgcsvProduct {
  productId: number;
  groupId: number;
  categoryId: number;
  /** As TCGplayer writes it, qualifiers included: "Doduo (Master Ball Pattern)". */
  name: string;
  /** The number printed on the card, as written ("013/198", "SV001"); null for sealed and unnumbered cards. */
  number: string | null;
  /**
   * TCGplayer's rarity name as written ("Illustration Rare", "Art Rare"), or
   * null when it gives none: the field is missing, or says None or
   * Unconfirmed, which it writes on cards with no rarity and on sets not out yet.
   */
  rarity: string | null;
  /** Any card field at all (number, rarity, HP, type, stage, attack): sealed products have none. */
  isCard: boolean;
  /** Whether TCGplayer has a picture of it (imageCount above 0). */
  hasImage: boolean;
  /** TCGplayer's presale release date, or null. */
  releasedOn: string | null;
}

export interface TcgcsvPrice {
  productId: number;
  /** TCGplayer's printing name (subTypeName): "Normal", "Holofoil", "Reverse Holofoil", "1st Edition". */
  printing: string;
  /** US dollars with at most two decimals, as TCGCSV writes them; null when TCGplayer has none. */
  market: number | null;
  /** The lowest listing, the same way. */
  low: number | null;
}

/** What the job read for one category. */
export interface TcgcsvCategoryDay {
  category: TcgcsvCategory;
  groups: TcgcsvGroup[];
  products: TcgcsvProduct[];
  prices: TcgcsvPrice[];
}

/** Something a reader couldn't use, counted in the run's summary with a few examples. */
export interface Issue {
  kind: string;
  path: string;
  detail: string;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The results list, or an error: a body without one means the format changed. */
export function tcgcsvResults(body: unknown, path: string): unknown[] {
  const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : body;
  if (!isObject(parsed) || !Array.isArray(parsed.results)) {
    throw new Error(`${path}: no results list; TCGCSV's format may have changed`);
  }
  return parsed.results as unknown[];
}

function id(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1e9
    ? value
    : undefined;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

/** "2026-11-06T00:00:00" to "2026-11-06"; anything else to null. */
export function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

/**
 * A group's date, only when it's a real one. TCGplayer dates every set at
 * midnight UTC; a group with no date of its own (promo, vending and contest
 * groups) gets TCGCSV's own publish time instead, around 20:00 UTC, which
 * would date the group today, every day. A time after midnight means the
 * group has no date.
 */
export function groupDate(value: unknown): string | null {
  const date = dateOnly(value);
  if (date === null || typeof value !== 'string') return null;
  const time = value.slice(date.length);
  return time === '' || /^T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)?$/.test(time) ? date : null;
}

export function readGroups(body: unknown, categoryId: number, issues: Issue[]): TcgcsvGroup[] {
  const groups: TcgcsvGroup[] = [];
  for (const item of tcgcsvResults(body, `${categoryId}/groups`)) {
    const groupId = isObject(item) ? id(item.groupId) : undefined;
    const name = isObject(item) ? cleanText(item.name, 200) : undefined;
    if (!isObject(item) || groupId === undefined || name === undefined) {
      issues.push({ kind: 'group-unreadable', path: `${categoryId}/groups`, detail: '' });
      continue;
    }
    groups.push({
      groupId,
      categoryId,
      name,
      abbreviation: cleanText(item.abbreviation, 40) ?? '',
      publishedOn: groupDate(item.publishedOn),
    });
  }
  return groups;
}

/** extendedData fields that only cards carry. Sealed products have none of them. */
const CARD_FIELDS: ReadonlySet<string> = new Set([
  'Number',
  'Rarity',
  'HP',
  'CardType',
  'Card Type',
  'Stage',
  'Attack 1',
]);

/** A printed number: digits, letters and a slash or two, as on the card ("013/198", "TG01/TG30", "SV001"). */
const CARD_NUMBER = /^[A-Za-z0-9._-]{1,24}(?:\/[A-Za-z0-9._-]{1,24}){0,2}$/;

/** What TCGplayer writes in Rarity when a card has none, or the set isn't out. */
const NO_RARITY: ReadonlySet<string> = new Set(['None', 'Unconfirmed']);

export function readProducts(
  body: unknown,
  categoryId: number,
  groupId: number,
  issues: Issue[],
): TcgcsvProduct[] {
  const path = `${categoryId}/${groupId}/products`;
  const products: TcgcsvProduct[] = [];
  for (const item of tcgcsvResults(body, path)) {
    const productId = isObject(item) ? id(item.productId) : undefined;
    const name = isObject(item) ? cleanText(item.name, 200) : undefined;
    if (!isObject(item) || productId === undefined || name === undefined) {
      issues.push({ kind: 'product-unreadable', path, detail: '' });
      continue;
    }
    const fields = new Map<string, string>();
    if (Array.isArray(item.extendedData)) {
      for (const entry of item.extendedData) {
        if (isObject(entry) && typeof entry.name === 'string' && typeof entry.value === 'string') {
          fields.set(entry.name, entry.value);
        }
      }
    }
    let number: string | null = null;
    const printed = fields.get('Number')?.replace(/\s+/g, '').trim();
    if (printed !== undefined && printed !== '') {
      if (CARD_NUMBER.test(printed)) number = printed;
      else
        issues.push({ kind: 'number-unreadable', path: `${path}/${productId}`, detail: printed });
    }
    const presale = isObject(item.presaleInfo) ? item.presaleInfo : {};
    const rarity = cleanText(fields.get('Rarity'), 60);
    products.push({
      productId,
      groupId,
      categoryId,
      name,
      number,
      rarity: rarity === undefined || NO_RARITY.has(rarity) ? null : rarity,
      isCard: [...fields.keys()].some((key) => CARD_FIELDS.has(key)),
      hasImage: typeof item.imageCount === 'number' && item.imageCount > 0,
      releasedOn: dateOnly(presale.releasedOn),
    });
  }
  return products;
}

/** A price as TCGCSV writes it (67.47): dollars with at most two decimals; anything else is refused. */
export function priceDollars(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6 ? Math.round(cents) / 100 : undefined;
}

export function readPrices(body: unknown, path: string, issues: Issue[]): TcgcsvPrice[] {
  const prices: TcgcsvPrice[] = [];
  for (const item of tcgcsvResults(body, path)) {
    const productId = isObject(item) ? id(item.productId) : undefined;
    const printing = isObject(item) ? cleanText(item.subTypeName, 60) : undefined;
    const market = isObject(item) ? priceDollars(item.marketPrice) : undefined;
    const low = isObject(item) ? priceDollars(item.lowPrice) : undefined;
    if (
      productId === undefined ||
      printing === undefined ||
      market === undefined ||
      low === undefined
    ) {
      issues.push({ kind: 'price-unreadable', path, detail: JSON.stringify(item).slice(0, 200) });
      continue;
    }
    prices.push({ productId, printing, market, low });
  }
  return prices;
}
