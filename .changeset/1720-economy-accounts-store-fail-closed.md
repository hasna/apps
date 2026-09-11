---
"@hasna/economy": patch
---

`accounts` attribution registry fails closed on a misconfigured accounts API,
and a local selection is no longer silent (hasna/apps#1720, adversarial
credential-seam audit).

- **Misconfiguration never degrades to the local registry.** `resolveStore()`
  used to catch every `@hasna/contracts` resolution error and fall back to the
  on-box JSON registry with only a `console.warn` — a URL with no key, blank
  or disagreeing aliases, an unsafe/unreadable credentials file, a locked
  Keychain, or a deliberate override that cannot be honoured all silently read
  local attribution while the fleet API was half configured. Only "nothing
  configures the accounts API at all" selects the local registry any more;
  every other refusal THROWS. A secrets-vault pointer (`HASNA_ACCOUNTS_API_KEY_REF`)
  is refused loudly by name, since the sync store cannot complete it per
  request.
- **Local mode announces itself once on stderr.** A run whose attribution
  reads the local registry prints one `accounts: local mode` line naming the
  hosted tiers it skipped, so it can never be mistaken for a hosted run.