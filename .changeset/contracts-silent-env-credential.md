---
"@hasna/contracts": patch
---

The client credential resolver no longer prints a `DEPRECATED: the API key came
from HASNA_<NAME>_API_KEY ...` stderr notice when the key arrives through the
process environment. Env-injected credentials are the sanctioned per-call
delivery channel on fleet stations (the wrappers read macOS Keychain and inject
the key into a one-shot child process), so the old notice — which advised
writing the key to a disk file — fired on every invocation of the fleet CLIs
(`todos`, `economy`, `projects`, ...) and contradicted station policy
(hasna/apps#1513). The env tier keeps its place at the end of the chain and
keeps its `deprecated` marker for 401 diagnostics; only the notice is dropped,
and an env-sourced resolution now carries no warning. The
`CredentialChainOptions.onDeprecation` option and the
`__resetCredentialDeprecationNotices` test seam are removed with the notice.