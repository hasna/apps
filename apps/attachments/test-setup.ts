// Test isolation for the attachments suite.
//
// The client store is selected by the env contract alone: HASNA_ATTACHMENTS_API_URL
// + HASNA_ATTACHMENTS_API_KEY both set -> hosted API, otherwise local SQLite. CI
// runs with a clean environment, but a machine whose fleet env-flip points
// attachments at the hosted API would otherwise route the whole local-isolation
// suite to the API (the old mode variable that used to force local is removed).
// Scrub the flip vars here so every test starts from the local default; tests
// that exercise hosted routing pass an explicit env object to the resolver.

for (const key of [
  "HASNA_ATTACHMENTS_API_URL",
  "ATTACHMENTS_API_URL",
  "HASNA_ATTACHMENTS_API_KEY",
  "ATTACHMENTS_API_KEY",
]) {
  delete process.env[key];
}
