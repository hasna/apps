/**
 * Public package repository-identity gate for hasna/apps.
 *
 * The member census is derived live from the root `apps/*` workspace. No
 * package-name snapshot or allowlist is kept here. Every top-level public
 * member must identify this monorepo and its real member directory; nested
 * generated connector packages are deliberately outside this top-level gate.
 *
 * Usage:
 *   bun tooling/ci/check-package-identities.ts [--root <dir>]
 *   bun tooling/ci/check-package-identities.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPOSITORY_URL = "https://github.com/hasna/apps.git";
const BUGS_URL = "https://github.com/hasna/apps/issues";

type PackageManifest = {
  name?: unknown;
  private?: unknown;
  repository?: unknown;
  homepage?: unknown;
  bugs?: unknown;
};

function memberManifestPaths(root: string): string[] {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    workspaces?: unknown;
  };
  if (!Array.isArray(rootManifest.workspaces) || !rootManifest.workspaces.includes("apps/*")) {
    throw new Error(`${path.join(root, "package.json")}: missing apps/* workspace`);
  }
  const appsDir = path.join(root, "apps");
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name, "package.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

function identityFailures(manifest: PackageManifest, relativeManifestPath: string): string[] {
  const failures: string[] = [];
  const directory = path.posix.dirname(relativeManifestPath.replaceAll(path.sep, "/"));
  const slug = path.posix.basename(directory);
  const expectedName = `@hasna/${slug}`;
  const homepageBase = `https://github.com/hasna/apps/tree/main/${directory}`;
  const repository = manifest.repository as { type?: unknown; url?: unknown; directory?: unknown } | undefined;
  const bugs = manifest.bugs as { url?: unknown } | undefined;

  if (manifest.private === true) return failures;
  if (manifest.name !== expectedName) failures.push(`name must be ${expectedName}`);
  if (!repository || typeof repository !== "object") {
    failures.push("repository must be an object");
  } else {
    if (repository.type !== "git") failures.push('repository.type must be "git"');
    if (repository.url !== REPOSITORY_URL) failures.push(`repository.url must be ${REPOSITORY_URL}`);
    if (repository.directory !== directory) failures.push(`repository.directory must be ${directory}`);
  }
  if (manifest.homepage !== homepageBase && manifest.homepage !== `${homepageBase}#readme`) {
    failures.push(`homepage must point to ${homepageBase}`);
  }
  if (!bugs || typeof bugs !== "object" || bugs.url !== BUGS_URL) {
    failures.push(`bugs.url must be ${BUGS_URL}`);
  }
  return failures;
}

function checkRoot(root: string): { count: number; violations: string[] } {
  const violations: string[] = [];
  let count = 0;
  for (const manifestPath of memberManifestPaths(root)) {
    const relative = path.relative(root, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackageManifest;
    if (manifest.private === true) continue;
    count += 1;
    for (const failure of identityFailures(manifest, relative)) {
      violations.push(`${relative}: ${failure}`);
    }
  }
  return { count, violations };
}

function run(root: string): number {
  const { count, violations } = checkRoot(root);
  if (violations.length > 0) {
    console.error(`PACKAGE-IDENTITY VIOLATIONS (${violations.length} across ${count} public top-level members):`);
    for (const violation of violations) console.error(`  ${violation}`);
    return 1;
  }
  console.log(`package identity: ${count} public top-level members, 0 violations`);
  return 0;
}

function selfTest(): number {
  let failed = false;
  const assert = (label: string, condition: boolean) => {
    console.log(`  ${condition ? "PASS" : "FAIL"} — ${label}`);
    if (!condition) failed = true;
  };
  const base: PackageManifest = {
    name: "@hasna/example",
    repository: { type: "git", url: REPOSITORY_URL, directory: "apps/example" },
    homepage: "https://github.com/hasna/apps/tree/main/apps/example#readme",
    bugs: { url: BUGS_URL },
  };
  const failures = (patch: Partial<PackageManifest>) =>
    identityFailures({ ...structuredClone(base), ...patch }, "apps/example/package.json");

  assert("canonical member passes", failures({}).length === 0);
  assert("wrong public package name refuses", failures({ name: "@hasna/other" }).some((failure) => failure.startsWith("name must be")));
  assert("missing repository refuses", failures({ repository: undefined }).includes("repository must be an object"));
  assert(
    "wrong repository type refuses",
    failures({ repository: { type: "svn", url: REPOSITORY_URL, directory: "apps/example" } }).includes(
      'repository.type must be "git"',
    ),
  );
  assert(
    "per-member homepage without anchor also passes",
    failures({ homepage: "https://github.com/hasna/apps/tree/main/apps/example" }).length === 0,
  );
  assert(
    "retired per-app repository refuses",
    failures({ repository: { type: "git", url: "https://github.com/hasna/example.git", directory: "apps/example" } }).some((failure) =>
      failure.startsWith("repository.url"),
    ),
  );
  assert(
    "git+ spelling refuses",
    failures({ repository: { type: "git", url: `git+${REPOSITORY_URL}`, directory: "apps/example" } }).some((failure) =>
      failure.startsWith("repository.url"),
    ),
  );
  assert(
    "foreign directory refuses",
    failures({ repository: { type: "git", url: REPOSITORY_URL, directory: "apps/other" } }).some((failure) =>
      failure.startsWith("repository.directory"),
    ),
  );
  assert("root-only homepage refuses", failures({ homepage: "https://github.com/hasna/apps" }).some((failure) => failure.startsWith("homepage")));
  assert("per-app issue tracker refuses", failures({ bugs: { url: "https://github.com/hasna/example/issues" } }).some((failure) => failure.startsWith("bugs.url")));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hasna-package-identities-"));
  try {
    fs.mkdirSync(path.join(tmp, "apps", "example"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
    fs.writeFileSync(
      path.join(tmp, "apps", "example", "package.json"),
      JSON.stringify({ ...base, repository: { type: "git", url: "https://github.com/hasna/example.git" } }),
    );
    const rejected = checkRoot(tmp);
    assert(
      "live workspace census forwards manifest violations",
      rejected.count === 1 && rejected.violations.some((violation) => violation.includes("repository.url must be")),
    );

    fs.writeFileSync(path.join(tmp, "apps", "example", "package.json"), JSON.stringify(base));
    const accepted = checkRoot(tmp);
    assert("live workspace census passes without a package snapshot", accepted.count === 1 && accepted.violations.length === 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failed) {
    console.error("self-test FAILED — package identity gate cannot be trusted");
    return 1;
  }
  console.log("self-test: PASS (canonical and refusal controls)");
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest());
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd();
process.exit(run(root));
