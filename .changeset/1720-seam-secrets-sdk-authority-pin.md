---
"@hasna/secrets": patch
---

The direct `SecretsClient` constructor refuses loudly when a caller pins an
explicit `baseUrl` without a key (hasna/apps#1720, adversarial credential-seam
audit). `apiKey: options.apiKey ?? ""` silently built an UNAUTHENTICATED
transport — the factory path already refused, but a direct
`new SecretsClient({ baseUrl })` (or a blank `apiKey: ""`) still produced a
client that sends no credential at all. The constructor now throws
`SECRETS_CLIENT_PIN_REQUIRED` at construction time, naming the expected env
sources (`HASNA_SECRETS_API_URL` / `HASNA_SECRETS_API_KEY`) and never
carrying a key value; an explicit key or a per-request `CredentialProvider`
is unchanged, and `createSecretsClientFromEnv` behaves exactly as before.
The regression suite pins the refusal (absent key and blank key), the
provider path, and the pinned-key path.