# @licenseman/electron

Electron SDK for [licensemanager.dev](https://licensemanager.dev).

> Work in progress. The current release provides the device fingerprint and
> clock-tamper detection; offline license-key verification is coming next.

## Install

```sh
pnpm add @licenseman/electron
```

Requires Electron 28 or later.

## Usage

Create a single `LicenseManager` instance and treat it as a singleton for the
lifetime of your app (create it after the Electron `app` is ready, from the main
process):

```ts
import { LicenseManager } from "@licenseman/electron";

const license = new LicenseManager({
  productId: "your-product-id",
  publicKey: "-----BEGIN PUBLIC KEY-----\n…", // used for offline validation
});

const fingerprint = await license.getFingerprint();

if (license.isClockTampered()) {
  // The system clock was moved backwards since we last saw it.
}

// On shutdown:
license.dispose();
```

### Device fingerprint

`getFingerprint()` returns a stable SHA-256 hex digest unique to the machine and
installation. It mixes a machine component with a per-install random ID that is
stored in the OS secret store (see below), so it survives uninstall/reinstall
and is far more stable than the OS version.

The machine component defaults to the native machine GUID (`IOPlatformUUID` on
macOS, `MachineGuid` on Windows, `/etc/machine-id` on Linux), falling back to a
hardware MAC address or hostname. Override it with the `fingerprint` option —
either a fixed string or a (sync or async) function:

```ts
new LicenseManager({
  productId,
  publicKey,
  fingerprint: () => myCustomMachineId(), // or a plain string
});
```

### Persistence

The install ID and the last-seen timestamp are stored in the OS secret store
(macOS Keychain, Windows Credential Manager, Linux Secret Service) via the
optional native `@napi-rs/keyring` dependency, namespaced by `productId` so
multiple apps never overlap. When no keyring is available (e.g. headless Linux),
the SDK transparently falls back to redundant copies in non-obvious files.

### Clock-tamper detection

On construction and roughly once an hour, the SDK records the newest
`Date.now()` it has observed. If a later check sees an earlier time,
`isClockTampered()` returns `true` — a signal that the system clock was rolled
back (e.g. to defeat a time-limited license). Checks never throw and never block
the host app.

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
