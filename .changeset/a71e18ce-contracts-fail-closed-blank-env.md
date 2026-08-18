---
"@hasna/contracts": patch
---

Fail-closed blank backend env and secure credential-file reads (todos a71e18ce):

- A DEFINED-but-blank `HASNA_<NAME>_DATABASE_URL` / `<NAME>_DATABASE_URL`
  (empty, whitespace, quoted whitespace) now throws instead of silently
  selecting the local sqlite store; conflicting canonical/short aliases are
  rejected rather than silently first-wins.
- Credential and app-config files must be owner-only regular files: exact
  `0400`/`0600` on the full mode bits (setuid/setgid/sticky variants refused),
  no symlinks (`O_NOFOLLOW`), owned by the current uid, size-capped, and
  stable across the read (fd identity plus a second content proof). An
  existing-but-unsafe file is refused loudly, never treated as absent.
- A deliberately blank explicit `apiKey`/`profile` argument fails closed
  instead of falling through to a lower credential tier.
- Client transport resolves endpoint and credential coherently from one disk
  read; env-vs-disk authority conflicts and same-file alias conflicts are
  misconfigured, and a long-lived client refuses to send a rotated credential
  to a retired authority (fails closed on authority change; same-authority key
  rotation still heals).
- The migration ledger statically refuses transaction-control statements
  (migration-id-only diagnostic) before any SQL runs.
- The test-only deprecation-reset seam is removed from the public transport
  surface.
