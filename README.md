# @licenseman/electron

Electron SDK for [licensemanager.dev](https://licensemanager.dev).

> Work in progress — no features yet.

## Install

```sh
pnpm add @licenseman/electron
```

Requires Electron 28 or later.

## Development

```sh
pnpm install
pnpm lint          # Biome lint + format check
pnpm lint:fix      # Apply Biome fixes
pnpm typecheck
pnpm test          # Vitest
pnpm test:coverage
pnpm build         # tsup, emits ESM + CJS + types to dist/
```

## Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets):

1. Run `pnpm changeset` and commit the generated file with your change.
2. On merge to `main`, the release workflow opens a "Version Packages" PR.
3. Merging that PR publishes to npm.

The release workflow needs an `NPM_TOKEN` repository secret.

## License

MIT
