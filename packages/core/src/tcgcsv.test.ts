import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupDate,
  priceDollars,
  readGroups,
  readPrices,
  readProducts,
  tcgcsvResults,
  type Issue,
} from './tcgcsv.ts';

const wrap = (results: unknown[]): string =>
  JSON.stringify({ totalItems: results.length, success: true, errors: [], results });

test('a body without its results list means the format changed', () => {
  assert.deepEqual(tcgcsvResults(wrap([1, 2]), 'x'), [1, 2]);
  assert.deepEqual(tcgcsvResults({ results: [] }, 'x'), []);
  assert.throws(() => tcgcsvResults('{"success":false}', '3/groups'), /3\/groups: no results list/);
  assert.throws(() => tcgcsvResults('[]', 'x'), /no results list/);
});

test('a group keeps only a real release date, never TCGCSV’s own publish time', () => {
  assert.equal(groupDate('2023-09-22T00:00:00'), '2023-09-22');
  assert.equal(groupDate('2023-09-22'), '2023-09-22');
  assert.equal(groupDate('2026-10-28T20:06:05'), null);
  assert.equal(groupDate('2023-02-30T00:00:00'), null);
  assert.equal(groupDate(null), null);
});

test('groups are read with their id, name, code and date; unreadable ones are counted', () => {
  const issues: Issue[] = [];
  const groups = readGroups(
    wrap([
      {
        groupId: 23237,
        name: ' SV: Scarlet &  Violet 151 ',
        abbreviation: 'MEW',
        publishedOn: '2023-09-22T00:00:00',
      },
      {
        groupId: 2214,
        name: 'Kids WB Promos',
        abbreviation: null,
        publishedOn: '2026-10-28T20:06:05',
      },
      { groupId: 'x', name: 'Broken' },
      'not an object',
    ]),
    3,
    issues,
  );
  assert.deepEqual(groups, [
    {
      groupId: 23237,
      categoryId: 3,
      name: 'SV: Scarlet & Violet 151',
      abbreviation: 'MEW',
      publishedOn: '2023-09-22',
    },
    { groupId: 2214, categoryId: 3, name: 'Kids WB Promos', abbreviation: '', publishedOn: null },
  ]);
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.kind === 'group-unreadable'));
});

test('a product is a card when it carries any card field; its number stays as printed', () => {
  const issues: Issue[] = [];
  const products = readProducts(
    wrap([
      {
        productId: 502558,
        name: 'Charizard ex - 006/165',
        imageCount: 1,
        presaleInfo: { isPresale: false, releasedOn: null },
        extendedData: [
          { name: 'Rarity', value: 'Double Rare' },
          { name: 'Number', value: ' 006/165 ' },
          { name: 'CardType', value: 'Fire' },
        ],
      },
      {
        productId: 501999,
        name: '151 Pokemon Center Elite Trainer Box (Exclusive)',
        imageCount: 0,
        presaleInfo: { isPresale: true, releasedOn: '2026-11-06T00:00:00' },
        extendedData: [{ name: 'Description', value: 'Contains 9 booster packs' }],
      },
      {
        productId: 726510,
        name: 'Masquerain',
        extendedData: [
          { name: 'Rarity', value: 'Unconfirmed' },
          { name: 'Number', value: '094/103(LeftHalf)<br>095/103(RightHalf)' },
        ],
      },
      { productId: 0, name: 'No id' },
    ]),
    3,
    23237,
    issues,
  );
  assert.deepEqual(products, [
    {
      productId: 502558,
      groupId: 23237,
      categoryId: 3,
      name: 'Charizard ex - 006/165',
      number: '006/165',
      rarity: 'Double Rare',
      isCard: true,
      hasImage: true,
      releasedOn: null,
    },
    {
      productId: 501999,
      groupId: 23237,
      categoryId: 3,
      name: '151 Pokemon Center Elite Trainer Box (Exclusive)',
      number: null,
      rarity: null,
      isCard: false,
      hasImage: false,
      releasedOn: '2026-11-06',
    },
    {
      productId: 726510,
      groupId: 23237,
      categoryId: 3,
      name: 'Masquerain',
      number: null,
      rarity: null,
      isCard: true,
      hasImage: false,
      releasedOn: null,
    },
  ]);
  assert.deepEqual(
    issues.map((issue) => issue.kind),
    ['number-unreadable', 'product-unreadable'],
  );
});

test('prices are dollars with at most two decimals; a missing market is null, a strange one is refused', () => {
  assert.equal(priceDollars(67.47), 67.47);
  assert.equal(priceDollars(0.1 + 0.2), 0.3);
  assert.equal(priceDollars(null), null);
  assert.equal(priceDollars(undefined), null);
  assert.equal(priceDollars(1.234), undefined);
  assert.equal(priceDollars('12.34'), undefined);
  assert.equal(priceDollars(-1), undefined);
  const issues: Issue[] = [];
  const prices = readPrices(
    wrap([
      { productId: 502558, subTypeName: 'Holofoil', marketPrice: 8.46, lowPrice: 5.75 },
      { productId: 726512, subTypeName: 'Holofoil', marketPrice: null, lowPrice: 4.99 },
      { productId: 726512, subTypeName: 'Normal', marketPrice: '12.34', lowPrice: 1 },
    ]),
    '3/23237/prices',
    issues,
  );
  assert.deepEqual(prices, [
    { productId: 502558, printing: 'Holofoil', market: 8.46, low: 5.75 },
    { productId: 726512, printing: 'Holofoil', market: null, low: 4.99 },
  ]);
  assert.deepEqual(
    issues.map((issue) => issue.kind),
    ['price-unreadable'],
  );
});
