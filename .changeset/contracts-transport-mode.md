---
"@hasna/contracts": patch
---

Client transport selection is explicit configuration, never pointer presence (todos a8c08df1). A defined-but-blank `HASNA_<NAME>_API_URL` is an explicit local choice that now wins over the fleet app-config disk pointer — previously the blank was skipped and the disk pointer silently flipped the client to the server. A server URL supplied by the disk tier while the environment is silent is no longer silent: the resolution warning names the file that decided, so a transport flip is always observable.
