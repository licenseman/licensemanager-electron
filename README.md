# @licenseman/electron

Electron SDK for [licensemanager.dev](https://licensemanager.dev).

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
import { LicenseError, LicenseManager } from "@licenseman/electron";

const license = new LicenseManager({
  productId: "your-product-id",
  // Ed25519 public key from the Security page. Hard-code it: never load it
  // from a file or fetch it at runtime.
  publicKey: "-----BEGIN PUBLIC KEY-----\n…",
});

license.onStateChange((state) => updateUi(state));
const state = await license.ready(); // e.g. "ACTIVE" or "MISSING_KEY"

// When the user types their key:
try {
  await license.setLicenseKey(input);
} catch (error) {
  if (error instanceof LicenseError) showError(error.code);
}

// On shutdown:
license.dispose();
```

### License state

`getState()` returns one of:

| State | Meaning |
| --- | --- |
| `LOADING` | Startup validation in progress. |
| `MISSING_KEY` | No key stored yet: ask the user for one. |
| `ACTIVE` | Valid license, verified online or with the stored token. |
| `INVALID_KEY` | The key doesn't exist for this product (`not_found`). |
| `EXPIRED` | The license expired (`license_expired`). |
| `VERSION_NOT_ALLOWED` | The license doesn't include this version. `getLatestAllowedVersion()` returns the latest allowed version, or null. |
| `MACHINE_LIMIT_REACHED` | The license is active on its maximum number of machines. |
| `OFFLINE_EXPIRED` | The server can't be reached and there is no valid stored token. |
| `CLOCK_TAMPERED` | The server can't be reached and the system clock was moved back. |

Subscribe with `onStateChange(listener)`, which returns an unsubscribe function.

`getPortalUrl()` returns the link to the customer portal for your product
(`https://app.licensemanager.dev/portal/<productId>`), e.g. to let customers
manage or renew their license.

### Validation

The stored key is validated online on every launch. The token the server
returns is a JWT, verified like an offline token (EdDSA signature, product,
key, machine fingerprint and expiry) and stored in the OS secret store.

When the stored token is valid, `ready()` resolves with `ACTIVE` right away
and the online validation runs in the background; a refused license then
switches the state through `onStateChange`. Otherwise `ready()` waits for the
server.

`setLicenseKey(key)` validates a key the user typed (trimmed, case kept) and
stores it only on success. On failure it throws a `LicenseError` whose `code`
is a server code (`not_found`, `license_expired`, `version_not_allowed`,
`machine_limit_reached`, `plan_limit_exceeded`, `validation_error`,
`internal_error`) or `network_error` / `invalid_response`, and the current
license is left untouched.

Only the four license errors lock the app. When the server can't be reached,
times out, or answers another error, the SDK falls back to the stored token
until it expires. `getOfflineState()` returns `{ mode: "online" }`, or
`{ mode: "offline", validUntil, remainingMs }` while running on the stored
token.

The key is re-validated in the background at 2/3 of the token lifetime. Set
`minOfflineDurationMs` to re-validate earlier, so that at least that much
offline time remains; it never moves re-validation within 1 day of the last
one. While offline, retries back off from 5 minutes to 1 hour. Call
`refresh()` to re-validate on demand, e.g. after the customer renewed.

Each validation retries transient failures (network errors, timeouts, 408,
429 and 5xx) with exponential backoff and jitter: for up to 30 seconds when a
caller is waiting (startup without a valid stored token, `setLicenseKey()`,
`refresh()`), and up to 5 minutes for background validations. Answers about the key are never
retried.

`version` (defaults to Electron's `app.getVersion()`) and `platform` (macOS,
Windows or Linux by default) are sent with every validation, along with
`machineName` (the hostname by default). While offline, `version` is also
checked against the token's max version (`mv`): a stored token for 2.x refuses
3.0 with `VERSION_NOT_ALLOWED` until the server can be reached, since online the
server's answer is authoritative.

### Device fingerprint

`getFingerprint()` returns a stable identifier unique to the machine, installation
and product. It joins a SHA-256 digest of a machine component with a per-install
random ID that is stored in the OS secret store (see below), so it survives
uninstall/reinstall and is far more stable than the OS version.

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

The install ID, last-seen timestamp, license key and token are stored in the OS secret store
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
