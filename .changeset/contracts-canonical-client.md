---
"@hasna/contracts": none
---

The canonical-client major release is applied as 1.0.0 in this change, including
the package, runtime, kit and changelog version surfaces. This release record
intentionally schedules no additional bump: retaining `major` would incorrectly
schedule 2.0.0 after the already-applied 1.0.0 release.

Authenticated service HTTP is the only public client data transport and
authoritative PostgreSQL the only server backend. Missing, blank, invalid, or
conflicting URL/credential/database configuration fails closed; automatic
SQLite/local fallback and client database DSNs are outside the contract.
Disk configuration uses the XDG config root, unsafe credential files are refused,
retired storage selectors are inert, and generated migration ledgers reject
transaction-control statements. Existing consumers retain their published pins
until their individual breaking-contract adoption is explicitly verified.
