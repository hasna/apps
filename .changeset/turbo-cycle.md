---
"@hasna/contracts": patch
---

fix: declare @hasna/secrets as a peerDependency instead of a dependency — breaks the turbo package-graph cycle with @hasna/secrets (devDep on @hasna/contracts) that made `turbo run build` fail with "Cyclic dependency detected" at any head (todos d2776e8f). The runtime path (`contracts issue-key --secrets-ref`, a non-literal dynamic import in src/cli/secrets-bridge.ts) resolves through the peer, which npm 7+ and bun auto-install; the @hasna/secrets -> @hasna/contracts devDependency (build-time bundling in secrets' server) is unchanged and now orders correctly.
