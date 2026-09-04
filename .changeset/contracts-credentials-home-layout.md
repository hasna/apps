---
"@hasna/contracts": patch
---

Credential resolver follows the 2026-09-04 home-layout ruling (#1668, #1690) and
the same-day owner directive on Keychain reads and URL defaults:

- The disk tier is `~/.hasna/<app>/config/credentials` (profile variant
  `credentials-<profile>`). `HASNA_HOME` replaces `~/.hasna`; `HASNA_CONFIG_HOME`
  replaces the config root (`<HASNA_CONFIG_HOME>/<app>/credentials`); both
  follow XDG semantics (absolute only, blank is unset). `XDG_CONFIG_HOME` and
  `~/.config/hasna/` are no longer consulted; `~/.hasna/fleet-env/`,
  `~/.hasna/cloud/` and `*-cloud.env` stay retired. The 0400/0600 mode check,
  ownership, read-coherence and unsafe-file refusals are unchanged.
- New darwin-only `keychain` tier between the env pointers and the disk file:
  reads `hasna.credentials.<app>.api-key` (and `.api-url` for the authority)
  for account `HASNA_STATION`, else the short hostname, else `USER`, via
  `security find-generic-password … -w` spawned by argv (no shell), fresh per
  call. A missing item falls through; any other failure is terminal; values are
  never logged. Ambient (live `process.env`) unless a runner is injected
  (`credentials.keychain.run`, which tests use) or `enabled` is set.
- `HASNA_<NAME>_API_KEY` is a legitimate `env` tier below disk: the deprecation
  notice, its registry, `onDeprecation`, `__resetCredentialDeprecationNotices`
  and the `deprecated` field are removed; tier names `legacy-env` / `config`
  become `env` / `disk`.
- With a credential from any tier and no configured URL, the base URL defaults
  to the fleet gateway `https://api.hasna.com/<app>` (`apiUrlSource` and
  `transportSource` report `"default"`); `HASNA_<NAME>_API_URL`, the Keychain
  `api-url` item and the credentials file override it and must agree.
