---
"@hasna/files": patch
---

`createFilesClientFromEnv` refuses loudly when a caller pins an explicit
`baseUrl` without an explicit `apiKey` (hasna/apps#1720, adversarial
credential-seam audit). Before, that combination silently built an
UNAUTHENTICATED `FilesClient` pointed at the named authority: the ambient
fleet key was correctly never attached, but the caller was left with a client
that looks like a fleet client and sends no credential at all. The factory
now throws `FILES_CREDENTIAL_PINNED` BEFORE any resolver tier is read and
before any request can go out, naming the expected env sources
(`HASNA_FILES_API_URL` / `HASNA_FILES_API_KEY`) and never carrying a key
value. The explicit `baseUrl` + explicit `apiKey` pin and the from-env chain
path keep working unchanged; the regression suite pins all three.