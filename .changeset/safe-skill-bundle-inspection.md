---
"@hasna/skills": patch
---

Expose a bounded asynchronous bundle inspector and deterministic packer through the SDK. Uploaded gzip/ustar bundles can now be validated with streaming decompression, finite byte/path/entry/deadline budgets, strict archive checks, owned file buffers and no filesystem writes or execution. Existing synchronous unpack callers remain unchanged and must migrate separately for untrusted input.
