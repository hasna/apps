---
"@hasna/skills": patch
---

Validate declared runtime entrypoints when preparing portable executable skills, allowing Python and custom JavaScript entrypoints without an unused src/index scaffold. Reject missing, unsafe, non-file, or symlinked runtime entrypoints.
