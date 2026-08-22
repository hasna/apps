// Fail-closed registry version lookup for the release verifier.
//
// A registry/network failure must never be treated as "no published versions":
// the publishability gate depends on proving the candidate version is absent
// and semver-greater than the published set, so an empty list produced by a
// failure would silently pass a version that may already be published.
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Runner = (cmd: string[]) => Promise<RunResult>;

export async function maybeNpmVersions(pkg: string, run: Runner): Promise<string[]> {
  const result = await run(["npm", "view", pkg, "versions", "--json"]);
  if (result.exitCode !== 0) {
    // The one legitimate empty case: the package has never been published (npm E404).
    if (/code E404/i.test(result.stderr)) return [];
    throw new Error(
      `npm view ${pkg} versions failed (exit ${result.exitCode}): ${(result.stderr || "(no stderr)").trim().slice(0, 300)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm view ${pkg} versions returned malformed JSON: ${result.stdout.slice(0, 80)}`);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error(`npm view ${pkg} versions returned an empty array — publishability unverifiable`);
    }
    return parsed;
  }
  if (typeof parsed === "string") return [parsed];
  throw new Error(`npm view ${pkg} versions returned unexpected JSON — publishability unverifiable`);
}
