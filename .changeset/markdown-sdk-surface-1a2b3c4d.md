---
"@hasna/markdown": patch
---

Add the `./sdk` importable module surface: the four-surface conformance gate requires an `./sdk` export (`exports["./sdk"] !== undefined` in the standard census); markdown was a recorded WARN exception (census `SDK_EXCEPTIONS`, P5 lane c7ce8b75). The existing `sdk/` package (client for OMP) is now built into `sdk/dist` and exported as `@hasna/markdown`'s `./sdk` subpath, and markdown is removed from the census SDK exception list.
