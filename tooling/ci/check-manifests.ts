/**
 * Contract-manifest gate — PLACEHOLDER.
 *
 * The contract-manifest schema for member packages is deferred to the
 * contracts lane (tier-0 path, founder-owned). This stub exists so the CI
 * gates job names the gate it will run; it is NOT a check that can refuse yet.
 *
 * It must be replaced by a real schema-validation gate in the lane that owns
 * the contract, with a two-sided self-test of its own (prove-it-can-fail
 * discipline). Do not delete this job and leave the name dangling; do not let
 * the placeholder masquerade as coverage.
 */
console.log(
  "PLACEHOLDER: contract-manifest gate not yet implemented (schema deferred to the contracts lane; tier-0 founder-owned).",
);
console.log("No manifest files exist in this skeleton — nothing to validate. rc=0 by design, with this notice.");
process.exit(0);
