// Test isolation for the domains suite.
//
// The store is selected by the shared @hasna/contracts resolver plus the
// explicit local-path opt-in (src/test/setup.ts): a machine whose shell carries
// a fleet credential would otherwise route local-isolation suites to the
// hosted API. This file scrubs the resolver's authority/credential names for
// THIS app (canonical, alias, deliberate pointers and the global profile) plus
// the shared-root overrides its disk tier reads, so every test starts from the
// scrubbed local default; tests that exercise hosted routing pass an explicit
// env object to the resolver.

for (const key of [
  "HASNA_DOMAINS_API_URL",
  "DOMAINS_API_URL",
  "HASNA_DOMAINS_API_KEY",
  "DOMAINS_API_KEY",
  "HASNA_DOMAINS_API_KEY_OVERRIDE",
  "HASNA_DOMAINS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_HOME",
  "HASNA_CONFIG_HOME",
]) {
  delete process.env[key];
}