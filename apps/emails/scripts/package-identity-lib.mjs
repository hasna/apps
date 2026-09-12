/**
 * Canonical published identity for @hasna/emails — ONE code path.
 *
 * The same predicate runs in three places that must never drift:
 *   - CI (`scripts/verify-package-identity.mjs`, invoked by `verify` in
 *     `.github/workflows/ci.yml`);
 *   - the `prepublishOnly` chain (`pack:identity` → `src/self-hosted-container.test.ts`);
 *   - `src/package-identity.test.ts`, which drives this library directly.
 *
 * Extracted from the inline `bun -e` block that used to sit in the workflow so
 * the gate is testable. An inline shell copy cannot be exercised against a
 * fixture, so the only evidence it worked was that CI stayed green — and a
 * check that has never been shown to fire is indistinguishable from no check
 * at all. `src/package-identity.test.ts` holds the negative arm: a foreign
 * repository url MUST be refused.
 *
 * ORG LAW (2026-09-10): the `hasnaxyz` org and the pre-monorepo per-app repos
 * no longer exist. @hasna/emails lives in hasna/apps at apps/emails, and its
 * `repository.url` is the monorepo url — no `git+` prefix, no per-app name,
 * no `#readme` on the repository field.
 */

export const CANONICAL_PACKAGE = "@hasna/emails";
export const CANONICAL_REPOSITORY = "https://github.com/hasna/apps.git";
export const CANONICAL_REPOSITORY_DIRECTORY = "apps/emails";
export const CANONICAL_REGISTRY = "https://registry.npmjs.org";
export const CANONICAL_ACCESS = "public";
export const CANONICAL_BINS = ["emails", "emails-mcp", "emails-serve"];

/**
 * Pure predicate: the identity violations for a manifest. An empty array means
 * the manifest conforms; every entry is a human-readable refusal reason.
 *
 * `@hasna/mailery` is an abandoned package line and must not be revived by
 * publishing this tree under that name — the name check is exact, so any other
 * name (including a `mailery` one) is refused.
 */
export function packageIdentityFailures(pkg) {
  const failures = [];
  const check = (ok, reason) => {
    if (!ok) failures.push(reason);
  };

  check(pkg?.name === CANONICAL_PACKAGE, `unexpected package name: ${pkg?.name}`);
  check(pkg?.publishConfig?.access === CANONICAL_ACCESS, "npm package must publish with public access");
  check(pkg?.publishConfig?.registry === CANONICAL_REGISTRY, "npm registry must be the public registry");
  check(
    pkg?.repository?.url === CANONICAL_REPOSITORY,
    `repository provenance must be ${CANONICAL_REPOSITORY} (got ${pkg?.repository?.url ?? "no repository.url"})`,
  );
  check(
    pkg?.repository?.directory === CANONICAL_REPOSITORY_DIRECTORY,
    `repository directory must be ${CANONICAL_REPOSITORY_DIRECTORY} (got ${pkg?.repository?.directory ?? "no repository.directory"})`,
  );

  return failures;
}
