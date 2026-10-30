# 0002: The day's catalog as an npm package

Date: 2026-10-29; accepted 2026-10-30.

## The problem

The first consumer, the Buy Desk page, is a claude.ai artifact. Checked Oct 29 on the phone: its Content-Security-Policy allows `connect-src 'self'` only, so `fetch()` to raw.githubusercontent.com and to cdn.jsdelivr.net both fail, and script tags are allowed only from a short list of CDN hosts, among them `https://cdn.jsdelivr.net/npm/` (the `/gh/` path is not on the list). The page can load the catalog only as a script from that path, and jsDelivr's `/npm/` path serves npm packages only.

## The decision

The Prices workflow publishes the day's tree as the npm package `superbad-data`, one version per data day, the day as CalVer (`2026.10.28`): `catalog.js` sets `self.SUPERBAD_CATALOG_TEXT` to the text of catalog.json and `summary.js` the same for summary.json. A reader loads the exact version it wants, so jsDelivr's caching of tags never serves a stale day; the Buy Desk page tries the expected day (the UTC day after 21:50 UTC, else the day before) and the day before that.

The publish step (jobs/prices/publish.ts) runs on main only, after the data commit; a version already on the registry is left alone, so a re-run or an unchanged day publishes nothing. It signs in by npm's trusted publishing: the workflow has `id-token: write`, npmjs.com holds a trusted publisher for this repository's `prices.yml`, and npm 11.5.1+ (Node 24, set up for that step alone) exchanges the run's OIDC token itself, so the repository holds no secret. If an `NPM_TOKEN` secret exists it is used instead; the first publish needed one, because a trusted publisher can only be set on a package that exists, and that token and secret were deleted once trusted publishing had published a night on its own.

## What it costs and what it opens

- No long-lived secret: trusted publishing ties publish rights to this repository's workflow file on GitHub-hosted runners, and npm attaches provenance to each version. A granular access token (7 days, publish rights, 2FA bypassed for the non-interactive run) was used once, for the first publish, then deleted with its repository secret; CLAUDE.md's rule stands at "no secrets".
- About 1.3 MB gzipped per day on the registry; a year is about 365 versions. npm packages with daily data releases are common; nothing private is in it.
- The alternative considered: a Claude scheduled task republishing the catalog beside the page each night. It would spend the owner's plan usage nightly and tie the data to one artifact; rejected for the same reason the job runs on GitHub.
