// TEST-ONLY global preload: scrub the retired storage-mode variables from the
// ambient process env before any test file loads.
//
// WHY THIS EXISTS. Deployment modes no longer exist (owner directive 2026-07-29;
// knowledge k_ms5wv466_u0jidq) and the resolver's fail-loud ratchet refuses ANY
// set storage-mode variable — including a stale one exported into every
// interactive shell by an old fleet profile (measured on station01:
// HASNA_CONVERSATIONS_STORAGE_MODE survives in the ambient env). The production
// ratchet must keep firing: an operator's stale variable is an error, never a
// hint. But a TEST RUNNER is not the operator: the suite pins its own store env
// per file, and a stale ambient variable would make every file that spreads
// `process.env` fail on the box that carries the residue while passing on a
// clean CI runner. The e2e helpers already scrub these names in their CLEARED
// lists; this preload generalises the scrub to the whole suite, so the suite is
// hermetic on BOTH machines.
//
// The ratchet's own behaviour is tested with explicit env objects
// (src/lib/store/server-mode.test.ts, store-resolution.test.ts) and is
// unaffected by this scrub.

const RETIRED_STORAGE_MODE_KEYS = [
  "HASNA_CONVERSATIONS_STORAGE_MODE",
  "HASNA_CONVERSATIONS_MODE",
  "CONVERSATIONS_STORAGE_MODE",
  "CONVERSATIONS_MODE",
];

for (const key of RETIRED_STORAGE_MODE_KEYS) {
  delete process.env[key];
}
