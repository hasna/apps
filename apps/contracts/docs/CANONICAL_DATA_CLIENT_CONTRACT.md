# Canonical data and client contract

This document is the normative architecture for public Hasna app data access.

## Public clients

A public app client has exactly one data transport: the authenticated service
API. The authority comes from `HASNA_<APP>_API_URL` (or its short alias), the
macOS Keychain item `hasna.credentials.<app>.api-url`, or the same key in
`~/.hasna/<app>/config/credentials` (`HASNA_HOME` and `HASNA_CONFIG_HOME`
override the roots); with none configured and a credential resolved, it
defaults to the fleet gateway `https://api.hasna.com/<app>`. Production
authorities use HTTPS. Exact loopback HTTP is allowed only for explicitly
bounded development and tests.

Blank, malformed, conflicting, or insecure authorities fail before a client is
constructed. Missing, blank, malformed, conflicting, or unsafe credentials do
the same. A public client never opens SQLite, a local file
store, PostgreSQL, or any other database DSN, and it never turns an auth or
network failure into a local read.

For each request, authority and credential form one stability-checked binding.
The client revalidates the reviewed pair immediately before dispatch and sends
nothing if either changed while the request was prepared. Authentication error
bodies are discarded before parsing so an upstream echo cannot enter error
enumeration, JSON serialization, inspection, logs, or stack diagnostics.

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

Service capability manifests may truthfully declare PostgreSQL alone. They add
`sqlite` or `json` only when explicit legacy import/migration tooling supports
that engine; conformance never requires a fictional legacy capability.

`Notes` is the Hasna app and CLI name. `PersonalNotes` is a separate SaaS
product; this contract does not couple or rename either identity.
