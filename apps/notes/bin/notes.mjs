#!/usr/bin/env node
// Hasna Notes CLI entry. The client is a plain HTTP API client: the hosted
// sync/cloud/billing verbs and sync-state handling were removed. Local note
// commands are implemented in cli/notes.mjs; this file is the package bin
// entry and delegates to it.
await import('../cli/notes.mjs');
