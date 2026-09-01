---
"@hasna/contracts": major
---

Make authenticated service HTTP the only public client data transport and
authoritative PostgreSQL the only server backend. Missing, blank, invalid, or
conflicting URL/credential/database configuration now fails closed; automatic
SQLite/local fallback and client database DSNs are outside the contract.

Move automatic disk configuration to the XDG config root, refuse unsafe
credential files, keep retired storage selectors inert, and harden generated
migration ledgers against transaction-control statements.
