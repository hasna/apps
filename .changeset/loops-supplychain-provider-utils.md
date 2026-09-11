---
"@hasna/loops": patch
---

Dependency bump for GHSA-866g-f22w-33x8: `ai` 6.0.204 -> 6.0.277, which pins `@ai-sdk/provider-utils` 4.0.50 (the advisory covers `>=4.0.0-beta.10 <4.0.33`).

The advisory reached the SHIPPED surface of this package: `apps/loops/package.json` pinned `ai` exactly at 6.0.204, whose exact `@ai-sdk/provider-utils` 4.0.29 pin is inside the affected range, so `bun run check:supply-chain` failed the packed-member audit (`audit of the packed member surface failed (rc=1)`) and blocked the release. Every other member in this monorepo already resolved `ai` 6.0.277 / provider-utils 4.0.50 through a caret range, so the bump is a dedupe: the root lockfile now carries ONE `ai` and ONE `@ai-sdk/provider-utils` version instead of two, and loops' nested copies are gone. `@openrouter/ai-sdk-provider` needs no change — its `ai` peer range is `^6.0.0`. The only addition to the shipped closure is `undici@6.28.1`, a new dependency of provider-utils 4.0.50.

Both lockfiles were regenerated with the repo-pinned bun 1.3.14 (never hand-edited): the root `bun.lock` at the monorepo root, and `apps/loops/bun.lock` through the standalone procedure `tooling/ci/check-frozen-locks.ts` documents (member manifest + lockfile copied into a directory with no workspace parent). No source change.
