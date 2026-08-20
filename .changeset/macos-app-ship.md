---
"@hasna/recordings": patch
---

Make the recordings macOS native CI discoverable: the Swift/C compile gate moved from the nested `apps/recordings/.github/workflows/ci.yml` (a silent dead lane — GitHub Actions only discovers workflows at the repo root, so the native half compiled nowhere in the monorepo) to the root-discoverable `.github/workflows/recordings-macos.yml`, scoped to `apps/recordings/**`. A merged main now provably compiles the macOS app's Swift half, closing the "CI build-and-sign path" gap named by the stale-sweep on todos 1a2ba6ad. App assembly and delivery to the owner's Mac remain the fleet-Mac ship lane (Developer ID signing material tracked separately on todos 63ce6ecc).
