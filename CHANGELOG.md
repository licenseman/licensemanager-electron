# @licenseman/electron

## 1.3.0

### Minor Changes

- [`21dacb0`](https://github.com/licenseman/licensemanager-electron/commit/21dacb06b2e66b78d9ad15d8804fa224c53933c2) Thanks [@nick-keller](https://github.com/nick-keller)! - The default `platform` now includes the OS version (e.g. `macOS 26.5.1`, `Windows 11 (10.0.22631)`, `Linux (Ubuntu 24.04.1 LTS)`), and the default `machineName` is the user-facing computer name (`scutil --get ComputerName` on macOS, the pretty hostname on Linux) instead of the network hostname.

### Patch Changes

- [`f3f8033`](https://github.com/licenseman/licensemanager-electron/commit/f3f8033fd4636bef40a762c669476f54fa3c3805) Thanks [@nick-keller](https://github.com/nick-keller)! - Only `require("electron")` when running inside Electron. In plain Node, requiring the `electron` npm package could trigger a download of the Electron binary.

## 1.2.0

### Minor Changes

- [`2945349`](https://github.com/licenseman/licensemanager-electron/commit/2945349be2cfd84bc53ba9782d093c5fd9d21a03) Thanks [@nick-keller](https://github.com/nick-keller)! - Add `keychainService` (defaults to the app's bundle id) and `useKeychain` (defaults to `app.isPackaged`, so development builds use only the file fallback) options.

## 1.1.0

### Minor Changes

- [`d50fcca`](https://github.com/licenseman/licensemanager-electron/commit/d50fcca0acc429a24e38c95d4f9e4eb30880b809) Thanks [@nick-keller](https://github.com/nick-keller)! - Add `getPortalUrl()`, which returns the link to the product's customer portal.

- [`d50fcca`](https://github.com/licenseman/licensemanager-electron/commit/d50fcca0acc429a24e38c95d4f9e4eb30880b809) Thanks [@nick-keller](https://github.com/nick-keller)! - Retry transient validate-key failures with exponential backoff: up to 30 seconds for `setLicenseKey()`, `refresh()` and startup without a valid stored token, up to 5 minutes for background validations. When the stored token is valid, `ready()` now resolves right away and the online validation runs in the background.

### Patch Changes

- [`d50fcca`](https://github.com/licenseman/licensemanager-electron/commit/d50fcca0acc429a24e38c95d4f9e4eb30880b809) Thanks [@nick-keller](https://github.com/nick-keller)! - Scheduled re-validations now run on time after system sleep or a clock change. Long waits are re-armed every hour against the wall clock, instead of in one timer of up to 24 days that could fire days late.
