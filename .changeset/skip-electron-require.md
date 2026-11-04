---
"@licenseman/electron": patch
---

Only `require("electron")` when running inside Electron. In plain Node, requiring the `electron` npm package could trigger a download of the Electron binary.
