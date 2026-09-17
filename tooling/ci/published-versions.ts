export interface RegistryQueryResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Only a successful version response or repeated E404 establishes absence.
 * Other failures remain unknown after three bounded attempts. Never log npm's
 * raw output, which can include operator configuration or credentials. */
export async function readPublishedVersions(
  query: () => Promise<RegistryQueryResult>,
  pause: (milliseconds: number) => Promise<unknown> = Bun.sleep,
): Promise<string[] | null> {
  let missing = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await query();
      if (result.exitCode === 0) {
        const parsed: unknown = JSON.parse(result.stdout);
        const versions = typeof parsed === "string" ? [parsed] : parsed;
        if (Array.isArray(versions) && versions.length > 0
          && versions.every(value => typeof value === "string" && VERSION.test(value))) return versions;
      } else {
        let code: unknown;
        try { code = JSON.parse(result.stdout)?.error?.code; } catch { /* npm may only write stderr */ }
        if (code === "E404" || (code === undefined && /npm (?:ERR!|error) code E404\b/.test(result.stderr))) missing++;
      }
    } catch { /* Spawn, read and parse failures are unavailable, not unpublished. */ }
    if (attempt < 2) await pause(250 * (attempt + 1));
  }
  return missing === 3 ? [] : null;
}

/** Local offline checks may report a skip. CI must obtain registry evidence. */
export function requireRegistryEvidence(dependency: string, versions: string[] | null, ci: boolean): string[] | null {
  if (versions === null && ci) throw new Error(`Registry lookup unavailable for ${dependency} after 3 attempts; publication state is unverified`);
  return versions;
}
