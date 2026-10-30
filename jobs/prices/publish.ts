/**
 * Prices job, step 3 (optional): publish the day's catalog as an npm package,
 * so a page that can load scripts only from cdn.jsdelivr.net/npm/ (a claude.ai
 * artifact: docs/decisions/0002-the-npm-feed.md) can read the prices with no
 * server of its own:
 *   https://cdn.jsdelivr.net/npm/superbad-data@<Y.M.D>/catalog.js
 *   https://cdn.jsdelivr.net/npm/superbad-data@<Y.M.D>/summary.js
 *
 * The version is the data day as CalVer (2026-10-28 → 2026.10.28), one
 * version per day TCGCSV refreshed. A version that already exists on the
 * registry is left alone, so a re-run publishes nothing. Signs in one of two
 * ways: an npm token in NODE_AUTH_TOKEN (written to the package folder's
 * .npmrc), else npm's trusted publishing from the run's OIDC token (the
 * workflow's id-token: write permission and a trusted publisher set on
 * npmjs.com; npm 11.5.1 or newer). With neither it only builds the folder.
 *
 * Usage:
 *   node jobs/prices/publish.ts --data <dir> --out <dir> [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const PACKAGE = 'superbad-data';

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    out: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.data || !values.out) {
  console.error('Usage: node jobs/prices/publish.ts --data <dir> --out <dir> [--dry-run]');
  process.exit(2);
}
const dataDir = values.data;
const outDir = values.out;

const summaryText = readFileSync(join(dataDir, 'summary.json'), 'utf8');
const summary = JSON.parse(summaryText) as { day?: unknown; asOf?: unknown };
if (typeof summary.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(summary.day)) {
  console.error('summary.json has no day');
  process.exit(1);
}
const [y, m, d] = summary.day.split('-').map((p) => parseInt(p, 10));
const version = `${y}.${m}.${d}`;

// The catalog as a script: the page reads one global string and parses it itself.
const catalogText = readFileSync(join(dataDir, 'catalog.json'), 'utf8');
const script = (name: string, text: string): string => `self.${name}=${JSON.stringify(text)};\n`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'catalog.js'), script('SUPERBAD_CATALOG_TEXT', catalogText));
writeFileSync(join(outDir, 'summary.js'), script('SUPERBAD_SUMMARY_TEXT', summaryText));
writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: PACKAGE,
      version,
      description: `TCGplayer market prices for English and Japanese Pokémon products, as of ${String(summary.asOf)}, as scripts for pages that can only load from a CDN. Built nightly from tcgcsv.com; schema at the repository.`,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'git+https://github.com/superbadbrokencode/superbad-data.git',
      },
      homepage: 'https://github.com/superbadbrokencode/superbad-data/blob/main/docs/schema.md',
      files: ['catalog.js', 'summary.js', 'README.md'],
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(outDir, 'README.md'),
  `# ${PACKAGE}\n\nTCGplayer market prices for English and Japanese Pokémon products as of ${String(summary.asOf)}, one npm version per day (${version}), built nightly by https://github.com/superbadbrokencode/superbad-data. The prices are TCGplayer's, read from tcgcsv.com.\n\n- \`catalog.js\` sets \`self.SUPERBAD_CATALOG_TEXT\` to the text of catalog.json (docs/schema.md in the repository).\n- \`summary.js\` sets \`self.SUPERBAD_SUMMARY_TEXT\` to the text of summary.json.\n\nLoad the day you want by its exact version: https://cdn.jsdelivr.net/npm/${PACKAGE}@${version}/catalog.js\n`,
);
console.log(
  `built ${PACKAGE}@${version} in ${outDir} (${(catalogText.length / 1e6).toFixed(1)} MB catalog)`,
);

if (values['dry-run']) process.exit(0);
const token = process.env.NODE_AUTH_TOKEN ?? '';
const oidc = (process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '') !== '';
if (token === '' && !oidc) {
  console.log('no NODE_AUTH_TOKEN and no OIDC token in this environment: not publishing');
  process.exit(0);
}
if (token === '') {
  // Trusted publishing: npm 11.5.1+ exchanges the run's OIDC token itself.
  const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  const [major = 0, minor = 0, patch = 0] = npmVersion.split('.').map((p) => parseInt(p, 10));
  if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
    console.error(`npm ${npmVersion} cannot use trusted publishing (needs 11.5.1 or newer)`);
    process.exit(1);
  }
  console.log(`publishing by trusted publishing (npm ${npmVersion})`);
} else {
  writeFileSync(join(outDir, '.npmrc'), `//registry.npmjs.org/:_authToken=${token}\n`);
  console.log('publishing with the token in NODE_AUTH_TOKEN');
}

const exists = (() => {
  try {
    const out = execFileSync('npm', ['view', `${PACKAGE}@${version}`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out !== '' && out !== '[]';
  } catch {
    return false; // E404: not published yet
  }
})();
if (exists) {
  console.log(`${PACKAGE}@${version} is already on the registry: nothing to publish`);
  process.exit(0);
}
execFileSync('npm', ['publish', '--access', 'public'], { cwd: outDir, stdio: 'inherit' });
console.log(`published ${PACKAGE}@${version}`);
