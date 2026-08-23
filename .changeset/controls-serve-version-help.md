---
"@hasna/controls": patch
---

controls-serve answers --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `controls-serve --version`/`--help` fell through to assertServeSafe()/Bun.serve and bound :3482 with no output.
