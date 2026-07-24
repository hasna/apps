const NUMERIC_IDENTIFIER = "(?:0|[1-9][0-9]*)";
const NON_NUMERIC_PRERELEASE_IDENTIFIER = "[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_PRERELEASE_IDENTIFIER})`;
const BUILD_IDENTIFIER = "[0-9A-Za-z-]+";

export const STRICT_SEMVER_PATTERN = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}` +
    `(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?` +
    `(?:\\+${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*)?$`,
);

export function isStrictSemver(value: string): boolean {
  return STRICT_SEMVER_PATTERN.test(value);
}

if (import.meta.main) {
  const [version] = process.argv.slice(2);
  if (!version || !isStrictSemver(version)) {
    console.error("version must be a valid SemVer 2.0 version");
    process.exit(1);
  }
}
