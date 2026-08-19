---
"@hasna/changelog": patch
---

publishChangelog no longer rewrites the target file when the generated markdown is unchanged. Previously every write-mode publish touched the file even when `changed` was false, churning mtime and defeating incremental sync; now an unchanged render writes nothing (the backup and content guarantees are unchanged for changed renders). Covered by a regression test that asserts mtime and byte preservation on an unchanged render.
