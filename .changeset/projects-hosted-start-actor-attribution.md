---
"@hasna/projects": minor
---

Resolve explicit project-start actors through the hosted `/v1/agents/{id-or-slug}` registry and carry the returned immutable agent ID into the real start event and project-update writes without opening the local Projects database. Hosted lookups now reject malformed or mismatched success responses, and the server rejects a supplied agent ID that no longer exists instead of silently storing an unattributed event. Omitted actors remain unattributed rather than inventing a local identity. Prompt mode, whose agent-run ledger is still machine-local, now refuses hosted execution before opening SQLite. Document the existing read-only `/v1/machines` route in OpenAPI, regenerate the SDK with `Machine`, `MachineList`, and `listMachines()`, and make package packing refuse stale generated SDK bytes.
