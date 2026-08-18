---
"@hasna/recordings": patch
---

Record the strong reason for the local-only artifact policy (local-only-capability-removal workflow 2026-08-18): ad-hoc / Developer ID signed, non-notarized builds bound to a single approved target machine are a native macOS distribution policy, not a data-backend capability — the signing identity is keychain-held on the build Mac and the machine binding is the capability itself. The release path keeps rejecting the local-only policy fields as a security control; gate comments in release-install-policy.ts now carry the dated evidence chain. No runtime behavior change.
