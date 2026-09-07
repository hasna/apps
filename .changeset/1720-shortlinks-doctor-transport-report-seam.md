---
"@hasna/shortlinks": patch
---

`shortlinks doctor`'s hosted transport report now resolves through the same
app-seam environment as every other command (hasna/apps#1720 release-quality).

`doctor` used to hand `@hasna/contracts` the RAW `process.env` for its
transport report while the seam normalises declared-but-blank authority
variables away before the resolver sees them
(`src/client-resolver-inputs.ts`). The resolver refuses a declared-but-blank
variable LOUDLY by design, so an environment carrying blanks (e.g. scrubbed
`HASNA_SHORTLINKS_API_KEY_OVERRIDE` / `HASNA_SHORTLINKS_API_KEY_REF` /
`HASNA_PROFILE`) alongside a valid key made `doctor` exit non-zero with a
blank-variable error while every store-backed command worked against the same
environment. The report now runs on the normalised inputs the store itself was
resolved with (`shortlinksResolverInputs(process.env)`, credentials included),
so `doctor` reports the same transport the CLI actually uses — the report
still only ever names WHERE the authority and credential came from, never a
value.

New hermetic CLI test spawns the real bin against a local HTTP double with a
blank pointer tier alongside the valid key + URL: `doctor` exits 0, reports
`api_url_source: HASNA_SHORTLINKS_API_URL` and
`api_key_source: HASNA_SHORTLINKS_API_KEY`, and the double really receives the
`/v1/stats` request. The suite now runs the hosted CLI path without touching
the fleet.