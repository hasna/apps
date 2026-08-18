---
"@hasna/notes": minor
---

Two-backend storage (cloud-transition task 5b2d66b4): notes-serve reads PostgreSQL selected by HASNA_NOTES_DATABASE_URL or SQLite by default; the client selects the server HTTP API via HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY (fail-closed when the key is missing) or stays on the local SQLite+markdown store. The PostgreSQL backend drops sync_batches (multi-machine sync is being removed fleet-wide) and issues @hasna/contracts api keys; the personalnotes/v1 wire dialect is unchanged on both backends. Adds `notes storage status` / `notes storage migrate --dry-run`, an `./sdk` package export, an OpenAPI document, and a Dockerfile/compose self-host artifact. Breaking: the transport selection env contract replaces the retired storage-mode selectors (PERSONALNOTES_MODE and friends now fail loud), and the client no longer falls back to a default localhost server.
