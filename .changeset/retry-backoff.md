---
"@licenseman/electron": minor
---

Retry transient validate-key failures with exponential backoff: up to 30 seconds for `setLicenseKey()`, `refresh()` and startup without a valid stored token, up to 5 minutes for background validations. When the stored token is valid, `ready()` now resolves right away and the online validation runs in the background.
