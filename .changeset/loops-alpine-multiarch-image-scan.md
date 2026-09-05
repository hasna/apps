---
"@hasna/loops": patch
---

Harden the deploy image for the ECR candidate scan gate: base the Dockerfile on the `oven/bun:1.3.14-alpine` multi-arch **index** digest (`sha256:5acc90a9…`) instead of a single-platform manifest, drop the `--platform=linux/amd64` pins so buildx produces the native `linux/arm64` image the lane and ECS actually run, pin `libcrypto3`/`libssl3` to the patched `3.5.8-r0` (and assert the installed versions, plus the absence of glibc/perl) next to the existing `postgresql16-client`/`libpq` pins, and delete dependency-shipped development lockfiles from `node_modules` so stale metadata inside a published tarball is not scanned as if it were installed. Also moves the `fast-uri` override to `3.1.7` in the member lockfile, closing four HIGH advisories that the previous `3.1.5` pin held open.
