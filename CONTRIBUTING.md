# Contributing

Thanks for your interest in improving YouTube Auto Feed.

## Ground rules

This extension works by mirroring YouTube's own private InnerTube `/browse` response and mutating the live Polymer grid in place. That surface is undocumented and changes without notice, so:

- The feed is live YouTube. Mutate `ytd-rich-grid-renderer` only through Polymer's `set(path, value)`, never through `innerHTML`.
- Section structure is read-only. The extension may only add or remove videos within a section, never reorder, move, or merge section markers.
- InnerTube renderer shapes are modelled as Zod schemas. Go through the schemas and guards; never index into raw shapes.

## Development

Requirements:

- Node.js 20 or newer
- pnpm (pinned in `package.json` under `packageManager`; run `corepack enable` to use it)

```sh
pnpm install
pnpm dev
```

`pnpm dev` launches the supported browsers through `web-ext-run` and reloads on rebuild.

## Before opening a pull request

- Run `pnpm lint` and `pnpm compile` and make sure both pass.
- Keep changes focused; match the surrounding code's style and naming.
- Verify behaviour against a real subscriptions feed. Compare the extension's output against a browser without the extension (that is the ground truth) - every video must land in the same section, with the same per-section counts.

## Reporting bugs

Open an issue with the browser, extension version, and steps to reproduce. Because the feed is non-deterministic, a screenshot or the affected section usually helps.

## License

By contributing, you agree that your contributions are licensed under the [GPL-3.0-or-later](LICENSE).
