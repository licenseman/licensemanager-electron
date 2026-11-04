---
"@licenseman/electron": minor
---

The default `platform` now includes the OS version (e.g. `macOS 26.5.1`, `Windows 11 (10.0.22631)`, `Linux (Ubuntu 24.04.1 LTS)`), and the default `machineName` is the user-facing computer name (`scutil --get ComputerName` on macOS, the pretty hostname on Linux) instead of the network hostname.
