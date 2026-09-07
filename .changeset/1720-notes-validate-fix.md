---
"@hasna/notes": patch
---

Resolver validation fixes for the @hasna/contracts credential chain
(hasna/apps#1720, notes P1 lane, round 1).

- **Non-JSON responses name the HTTP status.** `NotesHttpStoreError` for a
  non-JSON body now reads `Notes API GET /notes returned HTTP 404 with a
  non-JSON body` (code `invalid_json`, `status` set) instead of `returned
  invalid JSON`, so the CLI and MCP — which print only the message — let an
  operator tell a gateway/deployment mismatch (an origin that does not serve
  `/v1` answers 404 text/plain) apart from a corrupt body.
- **`storage status` reports `apiUrlPresent` honestly.** The transport report's
  `api_url_present` was a copy of `api_key_present`; it is now true when an
  operator configured the authority (`HASNA_NOTES_API_URL`, the Keychain
  `api-url` item, or the credentials file) and false when the default fleet
  gateway applied (`apiUrlSource: "default"`).
- **Maintenance path module is name-only.** `server/paths.mjs` keeps just the
  data-home branch (`HASNA_DATA_HOME`, else the platform data location): the
  unused config/state/cache branches — including the retired `~/.config/hasna`
  path shape — the unprefixed `NOTES_HOME` override and the import-time
  `DEFAULT_DB_PATH` (`<data root>/server.db`) constant are removed. Exact
  overrides stay `HASNA_NOTES_HOME`, then `HASNA_NOTES_ROOT`. Credentials and
  the service authority never resolved here (the contracts chain owns
  `~/.hasna/notes/config/credentials` and `HASNA_HOME`).
- **Hermetic bin/MCP tests.** The bin-runtime and MCP edge suites pin
  `HASNA_STATION` to a sentinel account and hand the child a throwaway
  `HASNA_HOME`, so a provisioned macOS station's Keychain items can no longer
  turn the fixed-authority case into an authority conflict or the
  no-credential case into a live fleet request. Both suites now also assert
  the fail-closed first stderr line names every credential tier and that
  nothing (no `*.db`, no data root) is created under the fake home.

No client behaviour changes otherwise: hosted with no credential still fails
closed on the CLI, MCP and `./sdk`, and there is no local fallback.
