---
"@hasna/catalog": patch
---

Fix pre-existing scaffold defects surfaced by the hygiene coverage corpus (BUG b87f5915): VERSION constant now matches package.json (0.2.0); blank/whitespace-only CATALOG_* env values fall back to the documented defaults and valid values are trimmed; the shared rollout event-type allowlist is frozen so callers cannot widen it; the HTTP handler contains store failures as a bounded JSON 500 instead of leaking internals.
