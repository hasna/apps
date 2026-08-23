---
"@hasna/economy": patch
---

economy-otel answers --version/-V before any bind (todos row 7e5f8f3d). Previously `economy-otel --version` fell through to resolvePort()/Bun.serve and bound the OTLP listener (:4318) with no output.
