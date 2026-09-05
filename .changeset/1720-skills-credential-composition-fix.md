---
"@hasna/skills": patch
---

Fix two ways the new `@hasna/contracts` credential path could not reach the
fleet (follow-up to hasna/apps#1780, umbrella #1720).

- **Every remote read on the default authority 404'd.** `buildSkillsApiUrl()`
  treated a base URL whose path ends in `/skills` as one that already names the
  collection and appended nothing. On the fleet gateway the trailing `/skills`
  is the app *path prefix* (`https://api.hasna.com/skills`), so `/api/v1` was
  never added and every request collapsed onto the gateway app root — which
  answers 404. A correctly credentialled install could not run `skills list`
  at all, on the plain merge path as well as `--remote`. The collection segment
  is now only stripped when the API prefix precedes it (`.../api/v1/skills`),
  so this composes the same URL `RemoteSkillsClient` does from the same origin.
- **A vault pointer no longer degrades to the local corpus.**
  `HASNA_SKILLS_API_KEY_REF` resolves to a credential whose value still has to
  be fetched from the secrets vault; the empty placeholder was being published
  as the resolved key, so a configured install sent `Authorization: Bearer `
  on some paths and, on the read path, was mistaken for "no credential" and
  silently answered from the bundled corpus with a zero exit. The pointer is
  now completed through the vault on each send (`resolveSkillsApiKey`), and a
  pointer that cannot be completed exits non-zero — configuring a credential is
  never less safe than configuring none. `resolveSkillsFleet()` reports
  `apiKey: null` plus the pointer instead of a blank key, and no tier can
  produce a hosted resolution with an empty key any more.
- **`HASNA_PROFILE` failures are structured refusals again.** A profile with no
  entry raised `@hasna/contracts`' own `CredentialResolutionError` straight
  through the helpers that exist to turn a refusal into data, so `--json`
  commands and MCP tools saw an unhandled exception. It is translated to
  `SkillsFleetCredentialError` (`code: "MISSING_API_CREDENTIAL"`) like every
  other refusal.
