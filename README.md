# YouTube Auto Feed

A browser extension that keeps the YouTube subscriptions feed (`/feed/subscriptions`) live. New uploads, status changes (upcoming -> live -> ended), removed videos, and metadata edits show up without reloading the page.

## How it works

The extension mirrors YouTube's own InnerTube `/browse` response for the subscriptions feed and polls it on a short cadence (5s for the full feed, 10s for metadata-only changes), pausing while the tab is hidden. Each fresh snapshot is diffed against the previous one, and the minimal set of add / remove / reposition mutations is applied to the live grid through Polymer, so the feed updates in place without a reload.

## Browser support

Chromium (Chrome, Edge, Opera) and Firefox, both Manifest V3.

## Development

Requirements:

- Node.js 20 or newer
- pnpm (the version is pinned in `package.json` under `packageManager`; run `corepack enable` to use it)

Install dependencies and start the dev server:

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm build            # Chrome (default)
pnpm build:firefox    # Firefox MV3
pnpm build:opera      # Opera

pnpm zip              # produce an uploadable zip for the built target
```

## Configuration

The source-zip upload to Google Drive is maintainer-only and optional. It reads Drive folder IDs from a gitignored `.env` (see `.env.example`) alongside a Drive credentials file. Both are absent by default, and the build skips the upload when they are missing.
