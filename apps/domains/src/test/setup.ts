// Keep unit tests on their per-test SQLite databases even when the shell has
// domains cloud client credentials exported for normal CLI use.
process.env["HASNA_DOMAINS_STORAGE_MODE"] = "local";
process.env["DOMAINS_STORAGE_MODE"] = "local";
