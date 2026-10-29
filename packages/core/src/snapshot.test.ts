import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_COLUMNS,
  HISTORY_KEEP_DAYS,
  buildSnapshot,
  dayBefore,
  daysBetween,
  keptHistory,
  lookback,
  parseAsOf,
  priceKey,
  type HistoryDay,
} from './snapshot.ts';
import type { TcgcsvCategoryDay } from './tcgcsv.ts';

test('TCGCSV’s last-updated text becomes an ISO timestamp in UTC', () => {
  assert.equal(parseAsOf('2026-10-28T20:06:05+0000'), '2026-10-28T20:06:05Z');
  assert.equal(parseAsOf('2026-10-28T20:06:05Z\n'), '2026-10-28T20:06:05Z');
  assert.equal(parseAsOf('2026-10-28T22:06:05+02:00'), '2026-10-28T20:06:05Z');
  assert.throws(() => parseAsOf('yesterday'), /not a timestamp/);
  assert.throws(() => parseAsOf('2026-10-28'), /not a timestamp/);
});

test('days are counted in UTC', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-08'), 7);
  assert.equal(daysBetween('2026-10-08', '2026-10-01'), -7);
  assert.equal(dayBefore('2026-10-08', 7), '2026-10-01');
  assert.equal(dayBefore('2026-03-01', 1), '2026-02-28');
  assert.throws(() => dayBefore('2026-02-30', 1), /not a date/);
});

const day = (date: string, market: Record<string, number>): HistoryDay => ({
  day: date,
  asOf: `${date}T20:05:00Z`,
  market,
});

test('the lookback picks the nearest day to the mark, the later on a tie, and nothing too far off', () => {
  const history = [
    day('2026-10-28', { a: 1 }),
    day('2026-10-23', { a: 2 }),
    day('2026-10-21', { a: 3 }),
    day('2026-10-19', { a: 4 }),
    day('2026-09-28', { a: 5 }),
  ];
  assert.equal(lookback(history, '2026-10-28', 7, 2)?.day, '2026-10-21');
  // Two days off on either side: the later one.
  assert.equal(
    lookback(
      history.filter((d) => d.day !== '2026-10-21'),
      '2026-10-28',
      7,
      2,
    )?.day,
    '2026-10-23',
  );
  // Today's own day never counts, however near the mark.
  assert.equal(lookback(history, '2026-10-28', 0, 2), null);
  assert.equal(lookback(history, '2026-10-28', 30, 3)?.day, '2026-09-28');
  // Four days off the mark is too far for the 30-day lookback.
  assert.equal(lookback([day('2026-09-24', { a: 6 })], '2026-10-28', 30, 3), null);
  assert.equal(lookback([], '2026-10-28', 7, 2), null);
});

test('the tree keeps the last 45 days of history, today apart, oldest first', () => {
  const history = [
    day('2026-10-28', { a: 1 }),
    day('2026-09-13', { a: 2 }),
    day('2026-09-12', { a: 3 }),
    day('2026-10-21', { a: 4 }),
  ];
  assert.equal(HISTORY_KEEP_DAYS, 45);
  assert.deepEqual(
    keptHistory(history, '2026-10-28').map((d) => d.day),
    ['2026-09-13', '2026-10-21'],
  );
});

const category = (
  id: 3 | 85,
  groups: TcgcsvCategoryDay['groups'],
  products: TcgcsvCategoryDay['products'],
  prices: TcgcsvCategoryDay['prices'],
): TcgcsvCategoryDay => ({
  category: { id, language: id === 3 ? 'en' : 'ja' },
  groups,
  products,
  prices,
});

const product = (
  productId: number,
  groupId: number,
  name: string,
  rest: Partial<TcgcsvCategoryDay['products'][number]> = {},
): TcgcsvCategoryDay['products'][number] => ({
  productId,
  groupId,
  categoryId: 3,
  name,
  number: null,
  rarity: null,
  isCard: true,
  hasImage: true,
  releasedOn: null,
  ...rest,
});

test('one row per priced printing, with the prices 7 and 30 days earlier, sorted and summed up', () => {
  const days = [
    category(
      3,
      [
        {
          groupId: 23237,
          categoryId: 3,
          name: 'SV: Scarlet & Violet 151',
          abbreviation: 'MEW',
          publishedOn: '2023-09-22',
        },
        {
          groupId: 609,
          categoryId: 3,
          name: 'DP Training Kit 1 Blue',
          abbreviation: 'PR',
          publishedOn: null,
        },
      ],
      [
        product(502552, 23237, 'Bulbasaur - 001/165', { number: '001/165', rarity: 'Common' }),
        product(501999, 23237, '151 Pokemon Center Elite Trainer Box', {
          isCard: false,
          hasImage: false,
        }),
        product(531960, 23237, 'Code Card - 151', { rarity: 'Code Card' }),
        product(502552, 23237, 'Bulbasaur again'),
      ],
      [
        { productId: 502552, printing: 'Reverse Holofoil', market: 0.33, low: 0.07 },
        { productId: 502552, printing: 'Normal', market: 0.2, low: 0.01 },
        { productId: 502552, printing: 'Normal', market: 0.21, low: 0.02 },
        { productId: 501999, printing: 'Normal', market: 1173.14, low: 1097.99 },
        { productId: 999999, printing: 'Normal', market: 1, low: 1 },
      ],
    ),
    category(
      85,
      [
        {
          groupId: 24791,
          categoryId: 85,
          name: 'M6: Storm Emeralda',
          abbreviation: 'm6',
          publishedOn: '2026-07-31',
        },
      ],
      [product(709110, 24791, 'Storm Emeralda Booster Box', { categoryId: 85, isCard: false })],
      [{ productId: 709110, printing: 'Normal', market: 91.71, low: 89.65 }],
    ),
  ];
  const history = [
    day('2026-10-21', { '502552:Normal': 0.18, '501999:Normal': 1100 }),
    day('2026-09-28', {
      '502552:Normal': 0.25,
      '502552:Reverse Holofoil': 0.41,
      '709110:Normal': 114.64,
    }),
    day('2026-08-01', { '502552:Normal': 9 }),
  ];
  const { catalog, today, summary } = buildSnapshot(days, history, '2026-10-28T20:06:05Z');

  assert.equal(catalog.source, 'tcgcsv');
  assert.equal(catalog.asOf, '2026-10-28T20:06:05Z');
  assert.equal(catalog.columns, CATALOG_COLUMNS);
  assert.deepEqual(catalog.sets, {
    '23237': { name: 'SV: Scarlet & Violet 151', code: 'MEW', lang: 'en', released: '2023-09-22' },
    '609': { name: 'DP Training Kit 1 Blue', code: 'PR', lang: 'en', released: null },
    '24791': { name: 'M6: Storm Emeralda', code: 'm6', lang: 'ja', released: '2026-07-31' },
  });
  assert.deepEqual(catalog.rows, [
    [
      501999,
      'Normal',
      'en',
      'sealed',
      23237,
      '151 Pokemon Center Elite Trainer Box',
      null,
      null,
      1173.14,
      1097.99,
      1100,
      null,
      0,
    ],
    [
      502552,
      'Normal',
      'en',
      'card',
      23237,
      'Bulbasaur - 001/165',
      '001/165',
      'Common',
      0.2,
      0.01,
      0.18,
      0.25,
      1,
    ],
    [
      502552,
      'Reverse Holofoil',
      'en',
      'card',
      23237,
      'Bulbasaur - 001/165',
      '001/165',
      'Common',
      0.33,
      0.07,
      null,
      0.41,
      1,
    ],
    [
      531960,
      null,
      'en',
      'card',
      23237,
      'Code Card - 151',
      null,
      'Code Card',
      null,
      null,
      null,
      null,
      1,
    ],
    [
      709110,
      'Normal',
      'ja',
      'sealed',
      24791,
      'Storm Emeralda Booster Box',
      null,
      null,
      91.71,
      89.65,
      null,
      114.64,
      1,
    ],
  ]);
  assert.deepEqual(today, {
    day: '2026-10-28',
    asOf: '2026-10-28T20:06:05Z',
    market: {
      '501999:Normal': 1173.14,
      '502552:Normal': 0.2,
      '502552:Reverse Holofoil': 0.33,
      '709110:Normal': 91.71,
    },
  });
  assert.deepEqual(summary.categories, {
    '3': { groups: 2, products: 4, cards: 2, sealed: 1, rows: 4, priced: 3 },
    '85': { groups: 1, products: 1, cards: 0, sealed: 1, rows: 1, priced: 1 },
  });
  assert.equal(summary.rows, 5);
  assert.equal(summary.priced, 4);
  assert.equal(summary.withM7, 2);
  assert.equal(summary.withM30, 3);
  assert.deepEqual(summary.lookback, { m7: '2026-10-21', m30: '2026-09-28' });
  assert.deepEqual(summary.historyDays, ['2026-09-28', '2026-10-21', '2026-10-28']);
  assert.deepEqual(summary.issueCounts, {
    'product-duplicate': 1,
    'price-duplicate': 1,
    'price-orphan': 1,
  });
  assert.equal(priceKey(502552, 'Normal'), '502552:Normal');
});

test('with no history every earlier price is unknown, never guessed', () => {
  const days = [
    category(
      3,
      [
        {
          groupId: 604,
          categoryId: 3,
          name: 'Base Set',
          abbreviation: 'BS',
          publishedOn: '1999-01-09',
        },
      ],
      [product(42346, 604, 'Alakazam', { number: '001/102', rarity: 'Holo Rare' })],
      [{ productId: 42346, printing: 'Holofoil', market: 72.77, low: 43.5 }],
    ),
  ];
  const { catalog, summary } = buildSnapshot(days, [], '2026-10-28T20:06:05Z');
  assert.deepEqual(catalog.rows, [
    [
      42346,
      'Holofoil',
      'en',
      'card',
      604,
      'Alakazam',
      '001/102',
      'Holo Rare',
      72.77,
      43.5,
      null,
      null,
      1,
    ],
  ]);
  assert.deepEqual(summary.lookback, { m7: null, m30: null });
  assert.deepEqual(summary.historyDays, ['2026-10-28']);
});
