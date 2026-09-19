---
"@hasna/recordings": minor
---

`recordings hosted` now resolves its authority and credential through the one
fleet chain (`resolveRecordingsSdkTransport` → `@hasna/contracts/client`)
instead of demanding an operator-supplied authority. `--api-base` and
`--credential-env` are no longer required options: with neither flag the
command reads the hosted `/v1` plane the same way every other recordings
surface does, so a station that already holds a recordings credential can read
the hosted Library, paste history and transcription providers without
hand-building an authority or exporting a bearer value. Both flags remain
available as an explicit override and still behave exactly as before, and the
unhosted local serve is never treated as a hosted Library — when nothing
resolves, the command fails closed instead of reading a local process.
