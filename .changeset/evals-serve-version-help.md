---
"@hasna/evals": patch
---

evals-serve answers --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `evals-serve --version`/`--help` fell through to startEvalsServer() and bound :19440 with no output.
