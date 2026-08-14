export type NpmReleasePackagePath = "." | "ai";

export type NpmReleasePackageDefinition = {
  packagePath: NpmReleasePackagePath;
  manifestPath: "package.json" | "ai/package.json";
  packageName: "@hasna/todos" | "@hasna/todos-ai";
  tagPrefix: "npm/todos/v" | "npm/todos-ai/v";
};

export type ResolvedNpmReleasePackage = NpmReleasePackageDefinition & {
  version: string;
};

export type NpmReleasePackageBindingFailure = {
  check: "release-package-path" | "release-package-name" | "release-package-version" | "release-package-tag";
  message: string;
};

export const NPM_RELEASE_PACKAGES: readonly NpmReleasePackageDefinition[] = [
  {
    packagePath: ".",
    manifestPath: "package.json",
    packageName: "@hasna/todos",
    tagPrefix: "npm/todos/v",
  },
  {
    packagePath: "ai",
    manifestPath: "ai/package.json",
    packageName: "@hasna/todos-ai",
    tagPrefix: "npm/todos-ai/v",
  },
] as const;

export function resolveNpmReleasePackageByPath(
  packagePath: string | undefined,
): NpmReleasePackageDefinition {
  const requestedPath = packagePath === undefined ? "." : packagePath;
  const definition = NPM_RELEASE_PACKAGES.find((candidate) => candidate.packagePath === requestedPath);
  if (!definition) throw new Error("package path must be . or ai");
  return definition;
}

export function resolveNpmReleasePackageByTag(tag: string): ResolvedNpmReleasePackage {
  for (const definition of NPM_RELEASE_PACKAGES) {
    if (!tag.startsWith(definition.tagPrefix)) continue;
    const version = tag.slice(definition.tagPrefix.length);
    if (!version || /[\s/]/.test(version)) break;
    return { ...definition, version };
  }
  throw new Error("unrecognised npm release tag");
}

export function validateNpmReleasePackageBinding(input: {
  packagePath: string;
  packageName: string;
  packageVersion: string;
  tag: string;
}): NpmReleasePackageBindingFailure[] {
  const failures: NpmReleasePackageBindingFailure[] = [];
  let pathDefinition: NpmReleasePackageDefinition | undefined;
  let tagDefinition: ResolvedNpmReleasePackage | undefined;

  try {
    pathDefinition = resolveNpmReleasePackageByPath(input.packagePath);
  } catch {
    failures.push({ check: "release-package-path", message: "package path must be . or ai" });
  }
  try {
    tagDefinition = resolveNpmReleasePackageByTag(input.tag);
  } catch {
    failures.push({ check: "release-package-tag", message: "tag must use an allowed npm release prefix and contain one version segment" });
  }

  if (!pathDefinition || !tagDefinition) return failures;
  if (pathDefinition.packagePath !== tagDefinition.packagePath) {
    failures.push({ check: "release-package-path", message: "release tag and package path select different packages" });
  }
  if (input.packageName !== pathDefinition.packageName || input.packageName !== tagDefinition.packageName) {
    failures.push({ check: "release-package-name", message: "package name does not match the selected fixed release package" });
  }
  if (input.packageVersion !== tagDefinition.version) {
    failures.push({ check: "release-package-version", message: "release tag version does not match the selected package version" });
  }
  return failures;
}
