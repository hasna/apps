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
  generatedAt?: string;
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
  { command: "bun", args: ["remove", "-g", PACKAGE_NAME], required: false },
  { command: "bun", args: ["install", "-g", "<tarball>"] },
  { command: "bash", args: ["-lc", "command -v todos && command -v todos-mcp && command -v todos-serve"] },
  { command: "todos", args: ["--version"] },
  { command: "todos", args: ["--help"] },
  { command: "todos-mcp", args: ["--help"] },
  { command: "todos-serve", args: ["--port=<port>", "--host", "127.0.0.1", "--no-open"] },
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
  addIf(failures, !packageJson.workspaces?.includes("dashboard"), "workspace-dashboard", "workspaces must include dashboard");

  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    const lower = name.toLowerCase();
    const forbidden = FORBIDDEN_DEPENDENCY_PARTS.find((part) => lower.includes(part));
    addIf(failures, Boolean(forbidden), "dependency-boundary", `dependency ${name} looks cloud/private (${forbidden})`);
  }

  return failures;
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

export function validatePackedPackageFiles(paths: string[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const required of [
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
  ]) {
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

export function validatePackedProvenanceMetadata(packageJson: PackageJson): ReleaseGateFailure[] {
  return validateRootPackageMetadata(packageJson);
}

export function validateReleaseProvenanceMetadata(
  provenance: ReleaseProvenance,
  packageJson: PackageJson,
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
    !provenance.generatedAt || Number.isNaN(Date.parse(provenance.generatedAt)),
    "provenance-generated-at",
    "release provenance generatedAt must be an ISO timestamp",
  );
  return failures;
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

export function getInstallSmokeCommands(tarball = "<tarball>", port = "<port>"): InstallSmokeCommand[] {
  return INSTALL_SMOKE_COMMANDS.map((step) => ({
    ...step,
    args: step.args.map((arg) => arg.replace("<tarball>", tarball).replace("<port>", port)),
  }));
}

export function validateInstallSmokeCommands(commands: InstallSmokeCommand[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const rendered = commands.map((step) => [step.command, ...step.args].join(" "));

  addIf(
    failures,
    !rendered.some((line) => line.startsWith(`bun install -g ${PACKAGE_NAME}`) || line.startsWith("bun install -g /")),
    "install-smoke-bun-install",
    `install smoke must install ${PACKAGE_NAME} with bun install -g`,
  );
  addIf(
    failures,
    rendered.some((line) => /^npm\s+(install|i|exec|x)\b/.test(line) || /^npx\b/.test(line)),
    "install-smoke-npm",
    "install smoke must not use npm or npx for installation/execution",
  );

  for (const expected of ["command -v todos", "command -v todos-mcp", "command -v todos-serve", "todos --version", "todos --help", "todos-mcp --help"]) {
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
