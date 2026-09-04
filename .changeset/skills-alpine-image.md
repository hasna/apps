---
"@hasna/skills": patch
---

The hosted service image builds FROM `oven/bun:1.3.14-alpine` (digest-pinned, with libssl3/libcrypto3 pinned to the patched 3.5.8-r0) instead of the Debian `-slim` variant, and the member lockfile resolves `fast-uri` to 3.1.7. The deploy lane's image scan (CRITICAL/HIGH, unfixed included) rejected the Debian image with 3 critical and 86 high findings, almost all unfixed OS packages; the Alpine image scans clean. No runtime behaviour change.
