# YouTube Auto Feed

YouTube couldn't make the subscriptions feed (`/feed/subscriptions`) update on its own, so I did. New uploads, live status changes (upcoming -> live -> ended), removed videos, edited titles and thumbnails - they all just show up. No refreshing, no missing that stream that went live 30 seconds ago.

Made by [Avi](https://avi12.com)

## Install

[![Chrome Web Store users](https://img.shields.io/chrome-web-store/users/jcdebdlnakhdinkindpogcehnhggbfad?color=white&label=Chrome%20%2F%20Edge%20users&style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/jcdebdlnakhdinkindpogcehnhggbfad)  
[![Firefox Add-on users](https://img.shields.io/amo/users/youtube-auto-feed@avi12.com?color=white&label=Firefox%20users&style=flat-square&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/youtube-auto-feed@avi12.com)  
[![Opera](https://img.shields.io/badge/Opera-Install-red?style=flat-square&logo=opera&logoColor=white)](https://addons.opera.com/extensions/details/youtube-auto-feed)

## Features

- New uploads pop in right where they belong, no reload needed
- Live status flips (upcoming -> live -> ended) update on the spot
- Removed videos vanish; edited titles and thumbnails refresh themselves
- Leaves YouTube's sections exactly how it laid them out
- Chills out when the tab is hidden, and doesn't collect any of your data

## How it works

It piggybacks on YouTube's own InnerTube `/browse` response for the feed and checks it every few seconds (5s for the full feed, 10s just for metadata), taking a break while the tab is hidden. Each new snapshot gets diffed against the last one, and only the actual changes - adds, removals, repositions - get poked into the live grid through Polymer. That's why the feed updates in place instead of blinking through a reload.

## Browser support

Works on Chromium (Chrome, Edge, Opera) and Firefox, both on Manifest V3.

| Browser       | Minimum version |
| ------------- | --------------- |
| Chrome / Edge | 111             |
| Opera         | 97              |
| Firefox       | 142             |

## Development

You'll want:

- Node.js 22.13 or newer (required by the pinned pnpm version)
- pnpm (grab it from the [pnpm installation page](https://pnpm.io/installation); the version's pinned in `package.json` under `packageManager`)

Grab the dependencies and fire up the dev server:

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm build            # Chrome (default)
pnpm build:firefox    # Firefox MV3
pnpm build:opera      # Opera

pnpm zip              # bundle up an uploadable zip for whatever you just built
```

## License

[GPL-3.0-or-later](LICENSE)
