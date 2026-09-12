---
"@hasna/recordings": minor
---

`recordings hosted list` and `recordings hosted get` now read the hosted `/v1`
Library through the one fleet credential chain. `--api-base` and
`--credential-env` are no longer required: with neither flag the command
resolves the recordings authority and credential the same way every other
recordings surface does, so a station that already holds a recordings
credential can read the hosted Library without hand-building an authority or
exporting a bearer value. Both flags remain available as an explicit override
and still behave exactly as before, and the unhosted local serve is never
treated as a hosted Library — when nothing resolves, the command fails closed
instead of reading a local process.
