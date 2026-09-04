---
"@hasna/contracts": minor
---

Single paths resolver in `@hasna/contracts/paths` (ruling hasna/apps#1668):
every app now resolves its local data/config/state/cache roots through it —
`~/.hasna/<app>/` on macOS for every kind, XDG on other platforms, with the
`HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides honored first. The
in-package resolver copies (added after `@hasna/paths` was deleted) and the
legacy `.hasna/<app>` hard-coded sites are gone from all members, and a
repo-conformance check guards the seam. Members' `@hasna/contracts` pins move
to exact `1.0.0` together with the `./paths` export.