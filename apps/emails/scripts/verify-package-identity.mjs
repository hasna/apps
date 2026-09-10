#!/usr/bin/env bun
/**
 * Canonical published identity gate for @hasna/emails.
 *
 * Refuses (exit 1) when the live manifest is not @hasna/emails from
 * hasna/apps at apps/emails, publishing to the public registry. The predicate
 * lives in ./package-identity-lib.mjs so CI, the prepublish chain and the test
 * suite all run the same code — see the library header for why.
 *
 * Usage: bun run scripts/verify-package-identity.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_PACKAGE,
  CANONICAL_REPOSITORY,
  CANONICAL_REPOSITORY_DIRECTORY,
  packageIdentityFailures,
} from "./package-identity-lib.mjs";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = packageIdentityFailures(pkg);

if (failures.length > 0) {
  process.stderr.write(`package identity refused (${failures.length}):\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}

console.log(
  `package identity: ${CANONICAL_PACKAGE} -> ${CANONICAL_REPOSITORY} (${CANONICAL_REPOSITORY_DIRECTORY})`,
);
