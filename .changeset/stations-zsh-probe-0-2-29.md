---
"@hasna/stations": patch
---

Generated Bun package probes (`stations apps plan`/`apply`) now execute under an explicit `bash -c` wrapper, fixing `zsh:1: parse error near 'printf'` on macOS targets whose remote login shell is zsh — installs ran but verification always failed (bug e406620f, measured station03). The output contract is unchanged and linux targets keep working. Shipped as 0.2.27 with the station-template floor bump; the fix is carried into the renamed @hasna/stations lineage at the continued version.
