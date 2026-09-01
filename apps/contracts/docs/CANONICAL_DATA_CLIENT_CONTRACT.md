# Canonical data and client contract

This document is the normative architecture for public Hasna app data access.

## Public clients

A public app client has exactly one data transport: the authenticated service
API. The authority comes from `HASNA_<APP>_API_URL` (or its short alias) or the
same key in `$XDG_CONFIG_HOME/hasna/<app>.env` (default
`~/.config/hasna/<app>.env`). Production authorities use HTTPS. Exact loopback
HTTP is allowed only for explicitly bounded development and tests.

Missing, blank, malformed, conflicting, or insecure authorities fail before a
client is constructed. Missing, blank, malformed, conflicting, or unsafe
credentials do the same. A public client never opens SQLite, a local file
store, PostgreSQL, or any other database DSN, and it never turns an auth or
network failure into a local read.

Retired deployment and storage selector variables are inert. They are not
parsed, mapped, rejected as a compatibility mode, or used to select a backend.

## Server authority

The authoritative server data store is PostgreSQL. A valid
`HASNA_<APP>_DATABASE_URL` (or an identical short alias) is required at the
server boundary. Missing, blank, malformed, non-PostgreSQL, or conflicting
values stop startup. There is no production SQLite default.

Database URLs are server-only configuration. They must never be exposed to or
accepted by public clients.

## XDG and legacy data

XDG config/state/cache directories hold non-authoritative configuration,
operational state, and disposable caches. They are not canonical app data.
Legacy SQLite or local-file paths may be described only as explicit migration
inputs. Migration tooling must require a deliberate source and destination,
preserve the source until verification succeeds, and must never make legacy
data an automatic fallback.

`Notes` is the Hasna app and CLI name. `PersonalNotes` is a separate SaaS
product; this contract does not couple or rename either identity.
