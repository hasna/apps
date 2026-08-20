---
"@hasna/secrets": patch
---

Emit a machine-readable stderr notice naming the local-vault fallback when no hosted API config (API_URL + API_KEY) is present, instead of a silent rc=0 "Vault is empty." — names the fallback path, the local secret count, and that hosted secrets are not visible (incident 715558, BUG b76e2d56).
