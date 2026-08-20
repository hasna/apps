---
"@hasna/secrets": patch
---

fix(secrets): xai_api_key detector requires a value-shaped suffix, not a bare 'xai-' prefix

The detector matched `xai-` followed by 12+ of `[A-Za-z0-9_-]`, so ordinary xAI
model ids (a hyphenated word after the prefix) tripped `secrets scan` at rc=1
and blocked commits on files containing no credential (bug a869386e, incident
715866). The pattern now matches the vendor's published shape
(xai-org/xai-proto `.gitleaks.toml`): `xai-` plus 20-80 alphanumeric
characters. Applied consistently to the scanner detector, the history-scan
git-grep pattern, and the redaction token mask. Regression tests cover both
directions: model ids pass, a value-shaped key still trips.
