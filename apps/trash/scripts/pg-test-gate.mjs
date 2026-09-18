#!/usr/bin/env bun
// Real domain transactions, auth, HTTP handlers and retention; never a SELECT 1 substitute.
if (!process.env.TRASH_TEST_DATABASE_URL?.trim()) {
  console.error("[pg-test-gate] Set TRASH_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database.");
  process.exit(2);
}
try {
  await import("./pg-domain-proof.ts");
  await import("./pg-credential-proof.ts");
  await import("./pg-service-proof.ts");
  await import("./pg-retention-proof.ts");
  await import("./pg-filesystem-proof.ts");
  console.log("[pg-test-gate] PASS: domain, authentication, credential provisioning, HTTP, retention and hosted filesystem proofs.");
} catch {
  console.error("[pg-test-gate] FAIL: PostgreSQL delivery proof failed; run the individual proof in a private diagnostic session.");
  process.exitCode = 1;
}
