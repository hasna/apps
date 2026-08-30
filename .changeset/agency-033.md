---
"@hasna/agency": patch
---

Backing changeset for the 0.3.3 release (hasna/apps#1474): the number 0.3.2 is permanently locked on the npm registry — @hasna/agency had prior published history under the scoped name (0.2.0/0.3.0/0.3.1/0.3.2, published 2026-08-21) and the whole package was unpublished 2026-08-28; npm refuses to republish a previously published version. 0.3.3 carries the fully-reviewed 0.3.2 candidate code (release-gate remediation cycles 1-5; [REVIEW] GO @ b589c107d, hasna/apps#1471) plus the 0.3.3 release-review remediations (committed dist bound to the reviewed source, prepack byte-identity gate), and is the first publication after the unpublish.
