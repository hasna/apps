---
"@hasna/loops": patch
---

A loop created with a machine pin could lose the pin before it reached storage, leaving a pinned loop claimable by any fleet runner with no route to its machine (BUG 96c837b0). `POST /v1/loops` now validates the machine ref fail-closed (a bare string or empty object is rejected 422 instead of persisting a never-claimable loop), and the MCP create surfaces (`loops_create_command`, `loops_create_workflow`) accept a machine id resolved through the machines topology — an unresolvable machine fails the create loudly and stores nothing, never a silent NULL. The OpenAPI/SDK `LoopMachineRef` contract additionally types `confidence` as the `exact | high | medium | low | none` string enum instead of a number, matching the runtime type and the machines consumer contract.
