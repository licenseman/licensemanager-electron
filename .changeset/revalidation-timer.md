---
"@licenseman/electron": patch
---

Scheduled re-validations now run on time after system sleep or a clock change. Long waits are re-armed every hour against the wall clock, instead of in one timer of up to 24 days that could fire days late.
