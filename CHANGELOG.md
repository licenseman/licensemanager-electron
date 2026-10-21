# @licenseman/electron

## 1.1.0

### Minor Changes

- [`d50fcca`](https://github.com/licenseman/licensemanager-electron/commit/d50fcca0acc429a24e38c95d4f9e4eb30880b809) Thanks [@nick-keller](https://github.com/nick-keller)! - Add `getPortalUrl()`, which returns the link to the product's customer portal.

- [`d50fcca`](https://github.com/licenseman/licensemanager-electron/commit/d50fcca0acc429a24e38c95d4f9e4eb30880b809) Thanks [@nick-keller](https://github.com/nick-keller)! - Retry transient validate-key failures with exponential backoff: up to 30 seconds for `setLicenseKey()`, `refresh()` and startup without a valid stored token, up to 5 minutes for background validations. When the stored token is valid, `ready()` now resolves right away and the online validation runs in the background.

### Patch Changes

- [`d50fcca`](https://github.com/licenseman/licensemanager-electron/commit/d50fcca0acc429a24e38c95d4f9e4eb30880b809) Thanks [@nick-keller](https://github.com/nick-keller)! - Scheduled re-validations now run on time after system sleep or a clock change. Long waits are re-armed every hour against the wall clock, instead of in one timer of up to 24 days that could fire days late.
