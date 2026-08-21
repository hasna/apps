---
"@hasna/secrets": none
---

Dependency-graph repair: @hasna/contracts moved from devDependencies to peerDependencies to break the turbo package cycle (contracts -> secrets -> contracts). Runtime imports of @hasna/contracts/auth are bundled at build time; the peer declaration documents the build-time contract.
