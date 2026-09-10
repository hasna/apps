---
"@hasna/skills": patch
---

Preserve own JSON keys such as `__proto__` while canonicalizing skill manifests for content hashes. Changing those fields now changes the digest and invalidates an old declaration. Ordinary manifest hashes and the SHA-256 framing remain unchanged.
