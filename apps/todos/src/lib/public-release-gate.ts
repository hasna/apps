export type PackageJson = {
  name?: string;
  version?: string;
  license?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  workspaces?: string[];
  packageManager?: string;
  scripts?: Record<string, string>;
  publishConfig?: {
    registry?: string;
    access?: string;
  };
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  homepage?: string;
  bugs?: {
    url?: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  gitHead?: string;
};

export type TextFile = {
  path: string;
  text: string;
};

export type ReleaseGateFailure = {
  check: string;
  message: string;
};

export type ReleaseProvenance = {
  packageName?: string;
  packageVersion?: string;
  repository?: string;
  gitCommit?: string;
  gitTree?: string;
  sourceTreeSha256?: string;
  generatedAt?: string;
};

export type ReleaseSourceIdentity = {
  gitCommit: string;
  gitTree: string;
  sourceTreeSha256: string;
};

export type ReleaseGateAuthority = {
  mode: "review" | "publish" | null;
  authoritative: boolean;
  expectedCommit: string | undefined;
  skipped: string[];
};

export type TrackedWorktreeProof = {
  path: string;
  headType: string;
  headMode: string;
  headObject: string;
  actualType: "blob" | "symlink" | "missing" | "other";
  actualMode: string | null;
  actualObject: string | null;
};

export type InstallSmokeCommand = {
  command: string;
  args: string[];
  required?: boolean;
};

const PACKAGE_NAME = "@hasna/todos";
const REPOSITORY_URL = "https://github.com/hasna/todos.git";
const HOMEPAGE_URL = "https://github.com/hasna/todos";
const ISSUES_URL = "https://github.com/hasna/todos/issues";

const FORBIDDEN_DEPENDENCY_PARTS = [
  "aws",
  "cloudflare",
  "stripe",
  "cerebras",
  `hasna${"studio"}`,
  `platform${"-"}todos`,
];

const LEGACY_CLOUD_PACKAGE = `@hasna/${"cloud"}`;
const LEGACY_OPEN_CLOUD = `${"open"}-${"cloud"}`;
const LEGACY_CLOUD_MCP = `${"cloud"}-${"mcp"}`;
const LEGACY_REGISTER_CLOUD_TOOLS = `register${"Cloud"}Tools`;
const LEGACY_REGISTER_CLOUD_COMMANDS = `register${"Cloud"}Commands`;
const LEGACY_SHARED_ENV_PREFIX = `HASNA_${"CLOUD"}`;
const LEGACY_RDS_ENV_NAME = `HASNA_${"RDS"}_PASSWORD`;
const LEGACY_CLOUD_FLAG = `--${"cloud"}`;

const FORBIDDEN_TEXT_PATTERNS: RegExp[] = [
  new RegExp(`github\\.com/hasna/${"open"}-todos`, "i"),
  wordPattern(`${"open"}-todos`),
  /npm install -g @hasna\/todos/i,
  /npm install @hasna\/todos-sdk/i,
  /bun add -g @hasna\/todos/i,
  /https:\/\/api\.cerebras\.ai/i,
  /\bCEREBRAS_API_KEY\b/,
  /\bTODOS_API_URL\b/,
  /\bTODOS_MODE\b/,
  /\bAWS_[A-Z0-9_]+\b/,
  /\bCLOUDFLARE_[A-Z0-9_]+\b/,
  /\bSTRIPE_[A-Z0-9_]+\b/,
  new RegExp(escapeRegExp(LEGACY_CLOUD_PACKAGE), "i"),
  wordPattern(LEGACY_OPEN_CLOUD),
  wordPattern(LEGACY_CLOUD_MCP),
  wordPattern(LEGACY_REGISTER_CLOUD_TOOLS),
  wordPattern(LEGACY_REGISTER_CLOUD_COMMANDS),
  new RegExp(`\\b${escapeRegExp(LEGACY_SHARED_ENV_PREFIX)}[_A-Z0-9]*\\b`),
  wordPattern(LEGACY_RDS_ENV_NAME),
  new RegExp(`${escapeRegExp(LEGACY_CLOUD_FLAG)}\\b`),
  /\bcloud[- ]sync\b/i,
  new RegExp(`hasna${"studio"}`, "i"),
  new RegExp(`platform${"-"}todos`, "i"),
];

const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /[A-Za-z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\s*=\s*['"][^'"]{12,}/,
];

const INSTALL_SMOKE_COMMANDS: InstallSmokeCommand[] = [
  { command: "bun", args: ["add", "--cwd", "<install-root>", "<tarball>", "--minimum-release-age=0"] },
  { command: "bash", args: ["-lc", "test -x <install-root>/node_modules/.bin/todos && test -x <install-root>/node_modules/.bin/todos-mcp && test -x <install-root>/node_modules/.bin/todos-serve"] },
  { command: "<install-root>/node_modules/.bin/todos", args: ["--version"] },
  { command: "<install-root>/node_modules/.bin/todos", args: ["--help"] },
  { command: "<install-root>/node_modules/.bin/todos-mcp", args: ["--help"] },
  { command: "<install-root>/node_modules/.bin/todos-serve", args: ["--port=<port>", "--host", "127.0.0.1", "--no-open"] },
];

export function validateRootPackageMetadata(packageJson: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, packageJson.name !== PACKAGE_NAME, "package-name", `package name must be ${PACKAGE_NAME}`);
  addIf(failures, !isSemver(packageJson.version), "package-version", "package version must be a valid semver version");
  addIf(failures, packageJson.license !== "Apache-2.0", "package-license", "package license must be Apache-2.0");
  addIf(failures, packageJson.main !== "dist/index.js", "package-main", "main must point at dist/index.js");
  addIf(failures, packageJson.types !== "dist/index.d.ts", "package-types", "types must point at dist/index.d.ts");
  addIf(
    failures,
    packageJson.publishConfig?.registry !== "https://registry.npmjs.org",
    "publish-registry",
    "publishConfig.registry must be the public npm registry",
  );
  addIf(
    failures,
    packageJson.publishConfig?.access !== "public",
    "publish-access",
    "publishConfig.access must be public",
  );
  addIf(
    failures,
    packageJson.repository?.url !== REPOSITORY_URL,
    "repository-url",
    `repository.url must be ${REPOSITORY_URL}`,
  );
  addIf(failures, packageJson.homepage !== HOMEPAGE_URL, "homepage", `homepage must be ${HOMEPAGE_URL}`);
  addIf(failures, packageJson.bugs?.url !== ISSUES_URL, "bugs-url", `bugs.url must be ${ISSUES_URL}`);

  const bin = packageJson.bin ?? {};
  addIf(failures, bin.todos !== "dist/cli/index.js", "bin-todos", "todos bin must resolve to dist/cli/index.js");
  addIf(failures, bin["todos-mcp"] !== "dist/mcp/index.js", "bin-mcp", "todos-mcp bin must resolve to dist/mcp/index.js");
  addIf(failures, bin["todos-serve"] !== "dist/server/index.js", "bin-serve", "todos-serve bin must resolve to dist/server/index.js");
  addIf(failures, Object.hasOwn(bin, "todos-remote"), "bin-remote", "package must not expose a hosted remote CLI bin");
  addIf(failures, Object.hasOwn(packageJson.exports ?? {}, "./remote"), "export-remote", "package must not export hosted remote code");

  const files = packageJson.files ?? [];
  for (const required of ["dist", "dashboard/dist", "LICENSE", "README.md"]) {
    addIf(failures, !files.includes(required), "package-files", `files must include ${required}`);
  }
  const allowedFiles = ["dist", "dashboard/dist", "LICENSE", "README.md"];
  for (const file of files) {
    addIf(failures, !allowedFiles.includes(file), "package-files-extra", `files must not include unbuilt or unreviewed path ${file}`);
  }
  addIf(failures, packageJson.packageManager !== "bun@1.3.14", "package-manager", "packageManager must pin bun@1.3.14");
  failures.push(...validatePackLifecycleScripts(packageJson));
  addIf(failures, !packageJson.workspaces?.includes("dashboard"), "workspace-dashboard", "workspaces must include dashboard");

  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    const lower = name.toLowerCase();
    const forbidden = FORBIDDEN_DEPENDENCY_PARTS.find((part) => lower.includes(part));
    addIf(failures, Boolean(forbidden), "dependency-boundary", `dependency ${name} looks cloud/private (${forbidden})`);
  }

  return failures;
}

export function validateBunReleaseToolchain(actualVersion: string | undefined): ReleaseGateFailure[] {
  return actualVersion === "1.3.14" ? [] : [{
    check: "release-bun-version",
    message: `release verification requires Bun 1.3.14, received ${actualVersion ?? "unknown"}`,
  }];
}

export function validateSdkPackageMetadata(packageJson: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, packageJson.name !== "@hasna/todos-sdk", "sdk-name", "SDK package name must be @hasna/todos-sdk");
  addIf(failures, packageJson.publishConfig?.access !== "public", "sdk-publish-access", "SDK publishConfig.access must be public");
  addIf(failures, packageJson.repository?.url !== REPOSITORY_URL, "sdk-repository-url", `SDK repository.url must be ${REPOSITORY_URL}`);
  addIf(failures, packageJson.homepage !== HOMEPAGE_URL, "sdk-homepage", `SDK homepage must be ${HOMEPAGE_URL}`);
  addIf(failures, packageJson.bugs?.url !== ISSUES_URL, "sdk-bugs-url", `SDK bugs.url must be ${ISSUES_URL}`);
  return failures;
}

export function validatePublicTextSurfaces(files: TextFile[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const file of files) {
    for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
      addIf(failures, pattern.test(file.text), "public-text-boundary", `${file.path} matches forbidden pattern ${pattern}`);
    }
    for (const pattern of SECRET_PATTERNS) {
      addIf(failures, pattern.test(file.text), "secret-scan", `${file.path} looks like it contains a secret`);
    }
  }

  const readme = files.find((file) => file.path === "README.md" || file.path.endsWith("/README.md"))?.text ?? "";
  addIf(
    failures,
    !readme.includes("bun install -g @hasna/todos"),
    "readme-install",
    "README.md must document bun install -g @hasna/todos",
  );

  return failures;
}

export function isPublicReleaseTextSurface(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("docs/")) return true;
  return new Set([
    "README.md",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "package.json",
    "sdk/README.md",
    "sdk/package.json",
  ]).has(normalized);
}

function collectPackageTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string") {
    if (!value.startsWith("#") && !value.includes("*")) targets.add(value.replace(/^\.\//, ""));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPackageTargets(item, targets);
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) collectPackageTargets(nested, targets);
  }
}

export function derivePackedPackageTargets(packageJson: PackageJson): string[] {
  const targets = new Set<string>();
  collectPackageTargets(packageJson.main, targets);
  collectPackageTargets(packageJson.types, targets);
  collectPackageTargets(packageJson.bin, targets);
  collectPackageTargets(packageJson.exports, targets);
  return [...targets].filter(Boolean).sort().map((target) => `package/${target}`);
}

export function validatePackedPackageFiles(paths: string[], packageJson?: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const requiredPaths = new Set([
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/cli/index.js",
    "package/dist/mcp/index.js",
    "package/dist/server/index.js",
    "package/dist/release-provenance.json",
    "package/dashboard/dist/index.html",
  ]);
  if (packageJson) {
    for (const target of derivePackedPackageTargets(packageJson)) requiredPaths.add(target);
    for (const entry of packageJson.files ?? []) {
      const packedEntry = `package/${entry.replace(/^\.\//, "").replace(/\/$/, "")}`;
      const contributes = paths.some((path) => path === packedEntry || path.startsWith(`${packedEntry}/`));
      addIf(failures, !contributes, "package-files-empty", `package files entry ${entry} contributes no packed path`);
    }
  }
  for (const required of [...requiredPaths].sort()) {
    addIf(failures, !paths.includes(required), "pack-contents", `packed package must include ${required}`);
  }

  for (const path of paths) {
    addIf(failures, path.startsWith("package/src/"), "pack-source", `packed package must not include source file ${path}`);
    addIf(failures, path.startsWith("package/.github/"), "pack-github", `packed package must not include GitHub config ${path}`);
    addIf(failures, path.includes(".env"), "pack-env", `packed package must not include env file ${path}`);
    addIf(failures, path.includes(".secrets"), "pack-secrets", `packed package must not include secrets path ${path}`);
  }

  return failures;
}

export function validatePackedProvenanceMetadata(
  packageJson: PackageJson,
  sourcePackageJson?: PackageJson,
): ReleaseGateFailure[] {
  const failures = validateRootPackageMetadata(packageJson);
  addIf(
    failures,
    sourcePackageJson !== undefined && packageJson.version !== sourcePackageJson.version,
    "packed-version",
    "packed package version must match the clean source package version",
  );
  return failures;
}

export function validateReleaseProvenanceMetadata(
  provenance: ReleaseProvenance,
  packageJson: PackageJson,
  expectedSource?: ReleaseSourceIdentity,
): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(
    failures,
    provenance.packageName !== PACKAGE_NAME,
    "provenance-package-name",
    `release provenance packageName must be ${PACKAGE_NAME}`,
  );
  addIf(
    failures,
    provenance.packageVersion !== packageJson.version,
    "provenance-package-version",
    "release provenance packageVersion must match package.json",
  );
  addIf(
    failures,
    provenance.repository !== REPOSITORY_URL,
    "provenance-repository",
    `release provenance repository must be ${REPOSITORY_URL}`,
  );
  addIf(
    failures,
    !provenance.gitCommit || !/^[0-9a-f]{40}$/i.test(provenance.gitCommit),
    "provenance-git-commit",
    "release provenance gitCommit must be a 40-character commit SHA",
  );
  addIf(
    failures,
    !provenance.gitTree || !/^[0-9a-f]{40}$/i.test(provenance.gitTree),
    "provenance-git-tree",
    "release provenance gitTree must be a 40-character tree SHA",
  );
  addIf(
    failures,
    !provenance.sourceTreeSha256 || !/^[0-9a-f]{64}$/i.test(provenance.sourceTreeSha256),
    "provenance-source-hash",
    "release provenance sourceTreeSha256 must be a 64-character SHA-256 digest",
  );
  addIf(
    failures,
    !provenance.generatedAt || Number.isNaN(Date.parse(provenance.generatedAt)),
    "provenance-generated-at",
    "release provenance generatedAt must be an ISO timestamp",
  );
  if (expectedSource) {
    addIf(
      failures,
      provenance.gitCommit !== expectedSource.gitCommit,
      "provenance-commit-match",
      "release provenance commit must match the clean source commit",
    );
    addIf(
      failures,
      provenance.gitTree !== expectedSource.gitTree,
      "provenance-tree-match",
      "release provenance tree must match the clean source tree",
    );
    addIf(
      failures,
      provenance.sourceTreeSha256 !== expectedSource.sourceTreeSha256,
      "provenance-source-hash-match",
      "release provenance source hash must match the clean source tree listing",
    );
  }
  return failures;
}

export function validateReleaseRepositoryState(porcelainStatus: string): ReleaseGateFailure[] {
  if (!porcelainStatus.trim()) return [];
  const entries = porcelainStatus.split(/\r?\n/).filter(Boolean).length;
  return [{
    check: "release-worktree-dirty",
    message: `release input must be a clean tracked tree with no untracked files (${entries} change${entries === 1 ? "" : "s"} found)`,
  }];
}

export function classifyReleaseGateAuthority(
  args: string[],
  expectedCommitFromEnvironment?: string,
  lifecycleEvent?: string,
): ReleaseGateAuthority {
  const skipped: string[] = [];
  let hasCliExpectedCommit = false;
  let mode: ReleaseGateAuthority["mode"] = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--skip-npm-view") skipped.push("npm-view");
    else if (arg === "--skip-install-smoke") skipped.push("install-smoke");
    else if (arg === "--expected-commit" || arg.startsWith("--expected-commit=")) {
      hasCliExpectedCommit = true;
      if (arg === "--expected-commit") index += 1;
    }
    else if (arg === "--mode") {
      const candidate = args[index + 1];
      if (candidate === "review" || candidate === "publish") mode = candidate;
      index += 1;
    } else if (arg.startsWith("--mode=")) {
      const candidate = arg.slice("--mode=".length);
      if (candidate === "review" || candidate === "publish") mode = candidate;
    }
  }
  const expectedCommit = mode === "publish" ? expectedCommitFromEnvironment?.trim() || undefined : undefined;
  return {
    mode,
    authoritative: mode === "publish" && lifecycleEvent === "prepublishOnly" && skipped.length === 0 && !hasCliExpectedCommit &&
      Boolean(expectedCommit && /^[0-9a-f]{40}$/i.test(expectedCommit)),
    expectedCommit,
    skipped,
  };
}

export function validateReleaseGateArguments(
  args: string[],
  options: { expectedCommit?: string; lifecycleEvent?: string } = {},
): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const allowedFlags = new Set(["--skip-npm-view", "--skip-install-smoke"]);
  const authority = classifyReleaseGateAuthority(args, options.expectedCommit, options.lifecycleEvent);
  if (args.includes("--skip-build")) {
    failures.push({
      check: "release-build-required",
      message: "release verification must rebuild the artifact from the clean source commit",
    });
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--mode") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) continue;
    if (arg === "--expected-commit" || arg.startsWith("--expected-commit=")) {
      failures.push({
        check: "release-expected-commit-argument",
        message: "expected commit must come only from HASNA_TODOS_EXPECTED_COMMIT in publish mode",
      });
      if (arg === "--expected-commit") index += 1;
      continue;
    }
    if (arg !== "--skip-build" && !allowedFlags.has(arg)) {
      failures.push({ check: "release-argument", message: `unsupported release verification argument: ${arg}` });
    }
  }
  if (!authority.mode) {
    failures.push({ check: "release-mode", message: "release verification requires --mode=review or --mode=publish" });
  }
  if (authority.mode === "publish" && (!authority.expectedCommit || !/^[0-9a-f]{40}$/i.test(authority.expectedCommit))) {
    failures.push({ check: "release-expected-commit", message: "publish mode requires HASNA_TODOS_EXPECTED_COMMIT with a 40-character commit" });
  }
  if (authority.mode === "publish" && options.lifecycleEvent !== "prepublishOnly") {
    failures.push({ check: "release-publish-lifecycle", message: "publish mode is valid only during npm_lifecycle_event=prepublishOnly" });
  }
  if (authority.mode === "publish" && authority.skipped.length > 0) {
    failures.push({ check: "release-prepublish-skip", message: "prepublishOnly must not use skip flags" });
  }
  return failures;
}

export function validateExpectedReleaseCommit(expected: string, actual: string): ReleaseGateFailure[] {
  return expected === actual ? [] : [{
    check: "release-expected-commit-match",
    message: `release commit ${actual} does not match externally supplied expected commit ${expected}`,
  }];
}

export function validateReleaseIndexFlags(output: string): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const tag = line[0] ?? "";
    const path = line.slice(2);
    if (tag.toUpperCase() === "S") {
      failures.push({ check: "release-index-skip-worktree", message: `tracked release input uses skip-worktree: ${path}` });
    }
    if (/^[a-z]$/.test(tag)) {
      failures.push({ check: "release-index-assume-unchanged", message: `tracked release input uses assume-unchanged: ${path}` });
    }
  }
  return failures;
}

export function validateTrackedWorktreeProof(entries: TrackedWorktreeProof[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const entry of entries) {
    if (entry.actualType === "missing" || entry.actualType === "other") {
      failures.push({ check: "release-tracked-type", message: `tracked path type differs from HEAD: ${entry.path}` });
      continue;
    }
    const expectedType = entry.headMode === "120000" ? "symlink" : "blob";
    if (entry.headType !== "blob" || entry.actualType !== expectedType) {
      failures.push({ check: "release-tracked-type", message: `tracked path type differs from HEAD: ${entry.path}` });
      continue;
    }
    if (entry.actualMode !== entry.headMode) {
      failures.push({ check: "release-tracked-mode", message: `tracked path mode differs from HEAD: ${entry.path}` });
    }
    if (entry.actualObject !== entry.headObject) {
      failures.push({
        check: expectedType === "symlink" ? "release-tracked-symlink" : "release-tracked-blob",
        message: `tracked ${expectedType} bytes differ from HEAD: ${entry.path}`,
      });
    }
  }
  return failures;
}

export function isPackedTextContent(content: Uint8Array): boolean {
  if (content.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    let disallowedControls = 0;
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) disallowedControls += 1;
    }
    return disallowedControls === 0;
  } catch {
    return false;
  }
}

export function validatePackedBinaryFile(
  path: string,
  content: Uint8Array,
  expectedLogoContent?: Uint8Array,
): ReleaseGateFailure[] {
  if (path !== "package/dashboard/dist/logo.jpg") {
    return [{ check: "pack-binary-allowlist", message: `packed binary file is not allowlisted: ${path}` }];
  }
  const jpeg = content.length >= 4 && content[0] === 0xff && content[1] === 0xd8 &&
    content[content.length - 2] === 0xff && content[content.length - 1] === 0xd9;
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, !jpeg, "pack-binary-signature", `${path} does not have a complete JPEG signature`);
  const sourceMatches = expectedLogoContent !== undefined && content.length === expectedLogoContent.length &&
    content.every((byte, index) => byte === expectedLogoContent[index]);
  addIf(failures, !sourceMatches, "pack-binary-source-match", `${path} must byte-match tracked dashboard/public/logo.jpg`);
  return failures;
}

export function resolveReleaseProvenanceTimestamp(
  sourceDateEpoch: string | undefined,
  commitEpoch: string,
): string {
  const selected = sourceDateEpoch ?? commitEpoch;
  if (!/^\d+$/.test(selected)) {
    throw new Error(sourceDateEpoch !== undefined ? "SOURCE_DATE_EPOCH must be whole epoch seconds" : "commit timestamp must be whole epoch seconds");
  }
  const milliseconds = Number(selected) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("release provenance epoch is out of range");
  return new Date(milliseconds).toISOString();
}

export function validateReproducibleArtifactIntegrity(
  first: string,
  second: string,
  firstManifest?: string,
  secondManifest?: string,
): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, first !== second, "tarball-reproducibility", "two clean builds produced different tarball bytes");
  addIf(
    failures,
    firstManifest !== undefined && secondManifest !== undefined && firstManifest !== secondManifest,
    "payload-reproducibility",
    "two clean builds produced different sorted payload manifests",
  );
  return failures;
}

export function validatePackLifecycleScripts(packageJson: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const name of ["prepack", "prepare", "postpack", "prepublish", "publish", "postpublish"]) {
    addIf(
      failures,
      Boolean(packageJson.scripts?.[name]),
      "pack-lifecycle-mutation",
      `package script ${name} is forbidden because the final npm publish pack must equal the verified pack`,
    );
  }
  addIf(
    failures,
    packageJson.scripts?.["verify:release"] !== "bun run scripts/verify-public-release.ts --mode=review",
    "release-review-script",
    "verify:release must invoke explicit non-authoritative review mode",
  );
  addIf(
    failures,
    packageJson.scripts?.prepublishOnly !== "bun run scripts/verify-public-release.ts --mode=publish",
    "release-publish-script",
    "prepublishOnly must invoke strict publish mode",
  );
  return failures;
}

export function getNpmPackArgs(destination: string): string[] {
  return ["pack", "--ignore-scripts", "--json", "--pack-destination", destination];
}

export function validateReleaseArtifactIntegrity(
  reportedIntegrity: string | undefined,
  computedIntegrity: string,
): ReleaseGateFailure[] {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(computedIntegrity)) {
    return [{ check: "tarball-integrity", message: "computed tarball integrity must be a valid sha512 SRI value" }];
  }
  if (reportedIntegrity === undefined) {
    return [{ check: "tarball-integrity-reported", message: "npm pack must report integrity for verification" }];
  }
  if (reportedIntegrity !== undefined && reportedIntegrity !== computedIntegrity) {
    return [{ check: "tarball-integrity", message: "packed tarball bytes do not match the packer's reported integrity" }];
  }
  return [];
}

export function validateNpmView(packageName: string, rawJson: string): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [{ check: "npm-view", message: "npm view did not return valid JSON" }];
  }

  if (!parsed || typeof parsed !== "object") {
    return [{ check: "npm-view", message: "npm view returned an empty response" }];
  }

  const record = parsed as Record<string, unknown>;
  addIf(failures, record.name !== packageName, "npm-view-name", `npm registry did not return ${packageName}`);
  addIf(failures, typeof record.version !== "string", "npm-view-version", "npm registry did not return a public version");
  return failures;
}

export function getInstallSmokeCommands(
  tarball = "<tarball>",
  port = "<port>",
  installRoot = "<install-root>",
): InstallSmokeCommand[] {
  return INSTALL_SMOKE_COMMANDS.map((step) => ({
    ...step,
    command: step.command.replace("<install-root>", installRoot),
    args: step.args.map((arg) => arg
      .replace("<tarball>", tarball)
      .replace("<port>", port)
      .replaceAll("<install-root>", installRoot)),
  }));
}

export function validateInstallSmokeCommands(commands: InstallSmokeCommand[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const rendered = commands.map((step) => [step.command, ...step.args].join(" "));

  addIf(
    failures,
    !rendered.some((line) => line.startsWith("bun add --cwd ") && line.includes(".tgz")),
    "install-smoke-bun-install",
    `install smoke must install ${PACKAGE_NAME} into an isolated --cwd with bun add`,
  );
  addIf(
    failures,
    rendered.some((line) => /^npm\s+(install|i|exec|x)\b/.test(line) || /^npx\b/.test(line)),
    "install-smoke-npm",
    "install smoke must not use npm or npx for installation/execution",
  );

  addIf(
    failures,
    rendered.some((line) => /\bbun\s+(install|add|remove)\s+-g\b/.test(line)),
    "install-smoke-global-install",
    "install smoke must never mutate the global Bun installation",
  );

  for (const expected of ["node_modules/.bin/todos --version", "node_modules/.bin/todos --help", "node_modules/.bin/todos-mcp --help"]) {
    addIf(failures, !rendered.some((line) => line.includes(expected)), "install-smoke-command", `install smoke must run ${expected}`);
  }

  const joined = rendered.join("\n");
  for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
    addIf(failures, pattern.test(joined), "install-smoke-boundary", `install smoke matches forbidden pattern ${pattern}`);
  }

  return failures;
}

function addIf(failures: ReleaseGateFailure[], condition: boolean, check: string, message: string): void {
  if (condition) failures.push({ check, message });
}

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function wordPattern(word: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
