import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const fixture = join(here, 'fixture');

function build(raw: string, history: string, out: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [join(here, 'build.ts'), '--raw', raw, '--history', history, '--out', out],
    { encoding: 'utf8' },
  );
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

test('the fixture builds to exactly the data tree the repo keeps', () => {
  const out = mkdtempSync(join(tmpdir(), 'prices-out-'));
  try {
    const result = build(join(fixture, 'raw'), join(fixture, 'history'), out);
    assert.equal(result.status, 0, String(result.stderr));
    const expected = filesUnder(join(fixture, 'out'));
    assert.deepEqual(filesUnder(out), expected);
    for (const name of expected) {
      assert.equal(
        readFileSync(join(out, name), 'utf8'),
        readFileSync(join(fixture, 'out', name), 'utf8'),
        `${name} changed: run bash jobs/prices/fixture/refresh.sh and read the diff`,
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a TCGCSV file without its results list stops the job', () => {
  const work = mkdtempSync(join(tmpdir(), 'prices-broken-'));
  try {
    cpSync(join(fixture, 'raw'), join(work, 'raw'), { recursive: true });
    writeFileSync(join(work, 'raw', '3', '23237', 'prices.json'), '{"success": false}\n');
    const result = build(join(work, 'raw'), join(fixture, 'history'), join(work, 'out'));
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /3\/23237\/prices: no results list/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('rows that stop reading as TCGCSV rows stop the job', () => {
  const work = mkdtempSync(join(tmpdir(), 'prices-unreadable-'));
  try {
    cpSync(join(fixture, 'raw'), join(work, 'raw'), { recursive: true });
    const path = join(work, 'raw', '85', '24791', 'prices.json');
    const body = JSON.parse(readFileSync(path, 'utf8')) as { results: object[] };
    body.results = body.results.map((row, i) => (i % 2 ? { ...row, marketPrice: '12.34' } : row));
    writeFileSync(path, JSON.stringify(body));
    const result = build(join(work, 'raw'), join(fixture, 'history'), join(work, 'out'));
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /4 of \d+ TCGCSV rows could not be read/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('a day with far fewer prices than the last one is refused, not written', () => {
  const work = mkdtempSync(join(tmpdir(), 'prices-shrunken-'));
  try {
    cpSync(join(fixture, 'raw'), join(work, 'raw'), { recursive: true });
    const path = join(work, 'raw', '3', '23237', 'prices.json');
    const body = JSON.parse(readFileSync(path, 'utf8')) as { results: object[] };
    body.results = body.results.slice(0, 2);
    writeFileSync(path, JSON.stringify(body));
    const result = build(join(work, 'raw'), join(fixture, 'history'), join(work, 'out'));
    assert.notEqual(result.status, 0);
    assert.match(
      String(result.stderr),
      /only \d+ prices today against 33 on 2026-10-23: refusing to write/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('a history file that is not a day stops the job', () => {
  const work = mkdtempSync(join(tmpdir(), 'prices-history-'));
  try {
    cpSync(join(fixture, 'history'), join(work, 'history'), { recursive: true });
    writeFileSync(join(work, 'history', '2026-10-20.json'), '{"day":"2026-10-21","market":{}}\n');
    const result = build(join(fixture, 'raw'), join(work, 'history'), join(work, 'out'));
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr), /2026-10-20\.json is not a history day/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
