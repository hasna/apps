/**
 * Quarantine admission, connector package SDK pins — standard-adherence suite.
 *
 * Why this exists (dep-connectors-aws-1): the aws connector manifest
 * (apps/connectors/connectors/aws/package.json) declared
 * "@aws-sdk/client-sesv2": "^3.0.0" and carried no tracked lockfile, so the
 * resolution floated. Measured 2026-08-27: the range admits 3.1119.0
 * (published 2026-08-26T19:21:52.163Z — inside the fleet 604800s
 * minimumReleaseAge window) and floats with every release; an install
 * without the fleet quarantine policy pulls a release younger than the
 * quarantine floor. AWS SDK v3 releases are synchronized, so a connector's
 * @aws-sdk/* set is pinned at one version coordinate.
 *
 * Remediation (root cause): an exact pre-window pin
 * (@aws-sdk/client-sesv2 3.1114.0, published 2026-08-19T19:30:06.825Z) plus
 * a tracked connector bun.lock. Ranges admit whatever publishes next; only
 * an exact pin keeps resolution inside the window forever, and the lockfile
 * freezes the standalone dev install the same way it freezes app installs.
 *
 * RULE 1 — exact pin. Every @aws-sdk/* specifier declared in a connector
 *   manifest must be exact (X.Y.Z). A range is the vulnerability at its
 *   moment of declaration, independent of the current registry state.
 * RULE 2 — lockfile. A connector declaring @aws-sdk/* must carry a tracked
 *   bun.lock, so the standalone install's resolution is frozen rather than
 *   re-resolved per run.
 * RULE 3 — admission (npm-backed, mirrors quarantine-admission.test.ts):
 *   the declared spec must admit NO version published within the last
 *   604800 seconds. Network failure → [SKIP connector-sdk-quarantine]
 *   marker; a version with no publish time stays silent (unverifiable is
 *   not provably fresh).
 *
 * SCOPE: connector manifests under apps/connectors/connectors/*. Connector
 *   packages are standalone (installed outside the workspace), so their
 *   manifests are the whole resolution contract for a consumer — the app
 *   lockfile rules of check-frozen-locks reach app entries only.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR } from "./census";

export const CONNECTOR_SDK_QUARANTINE_WINDOW_SECONDS = 604800; // fleet minimumReleaseAge, 7 days
const AWS_SDK_PREFIX = "@aws-sdk/";
const EXACT_SPEC = /^\d+\.\d+\.\d+$/;
const NETWORK_FAILURE = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i;

export interface AwsSdkDeclaration {
  connector: string;
  dependency: string;
  spec: string;
}

export interface QuarantineAdmission {
  connector: string;
  dependency: string;
  spec: string;
  freshVersions: string[];
}

export function connectorsDir(): string {
  return path.join(APPS_DIR, "connectors", "connectors");
}

export function isExactSpec(spec: string): boolean {
  return EXACT_SPEC.test(spec);
}

/** Collect @aws-sdk/* specifiers declared in the manifest's dependency sections. */
export function awsSdkDeclarations(connector: string, manifest: Record<string, unknown>): AwsSdkDeclaration[] {
  const out: AwsSdkDeclaration[] = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const deps = manifest[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const [dependency, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (!dependency.startsWith(AWS_SDK_PREFIX)) continue;
      if (typeof spec !== "string" || spec.length === 0) continue;
      out.push({ connector, dependency, spec });
    }
  }
  return out;
}

/** All connector manifests under apps/connectors/connectors/* that declare @aws-sdk/*, as {manifest, declarations}. */
export function awsSdkConnectors(): Array<{ name: string; manifest: Record<string, unknown>; declarations: AwsSdkDeclaration[] }> {
  const out: Array<{ name: string; manifest: Record<string, unknown>; declarations: AwsSdkDeclaration[] }> = [];
  for (const entry of fs.readdirSync(connectorsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(connectorsDir(), entry.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      const declarations = awsSdkDeclarations(entry.name, manifest);
      out.push({ name: entry.name, manifest, declarations });
    } catch {
      // unparseable manifest belongs to another check; skip
    }
  }
  return out;
}

/**
 * Does the specifier admit any version published inside the quarantine
 * window? Same contract as the quarantine-admission lane: a missing or
 * unparseable publish time is unverifiable and stays silent.
 */
export function findAdmissions(
  connector: string,
  dependency: string,
  spec: string,
  admittedVersions: string[],
  publishedTimes: Record<string, string | null>,
  nowMs: number,
  windowSeconds: number = CONNECTOR_SDK_QUARANTINE_WINDOW_SECONDS,
): QuarantineAdmission | null {
  const windowMs = windowSeconds * 1000;
  const fresh = admittedVersions.filter((v) => {
    const t = publishedTimes[v];
    if (!t) return false;
    const publishedMs = Date.parse(t);
    if (Number.isNaN(publishedMs)) return false;
    return nowMs - publishedMs < windowMs;
  });
  if (fresh.length === 0) return null;
  return { connector, dependency, spec, freshVersions: fresh };
}

/** Fetch a dep's publish times from the npm registry; null on network failure. */
export async function fetchPublishedTimes(dep: string): Promise<Record<string, string> | null> {
  const proc = Bun.spawn(["npm", "view", dep, "time", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
    cwd: APPS_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    if (NETWORK_FAILURE.test(stderr)) return null;
    return {};
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d+\.\d+\.\d+/.test(k)) continue;
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** Fetch the versions a specifier admits, per the registry; null on network failure. */
export async function fetchAdmittedVersions(dep: string, spec: string): Promise<string[] | null> {
  const proc = Bun.spawn(["npm", "view", `${dep}@${spec}`, "version", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
    cwd: APPS_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    if (NETWORK_FAILURE.test(stderr)) return null;
    return [];
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    if (typeof parsed === "string") return [parsed];
    return null;
  } catch {
    return null;
  }
}

describe("standard-adherence: connector package SDK quarantine admission (7-day minimumReleaseAge window)", () => {
  test("self-test: awsSdkDeclarations collects @aws-sdk specifiers in any dependency section", () => {
    const decls = awsSdkDeclarations("aws", {
      dependencies: { "@aws-sdk/client-sesv2": "^3.0.0", commander: "^12.1.0" },
      devDependencies: { "@aws-sdk/client-s3": "3.1114.0" },
    });
    expect(decls).toEqual([
      { connector: "aws", dependency: "@aws-sdk/client-sesv2", spec: "^3.0.0" },
      { connector: "aws", dependency: "@aws-sdk/client-s3", spec: "3.1114.0" },
    ]);
  });

  test("self-test: a range spec is flagged non-exact; an exact pin is exact", () => {
    expect(isExactSpec("^3.0.0")).toBe(false);
    expect(isExactSpec("~3.1114.0")).toBe(false);
    expect(isExactSpec("3.1114.0")).toBe(true);
  });

  test("self-test: a range admitting a window-fresh version fires", () => {
    const nowMs = Date.parse("2026-08-27T12:00:00Z");
    const result = findAdmissions(
      "aws",
      "@aws-sdk/client-sesv2",
      "^3.0.0",
      ["3.1114.0", "3.1119.0"],
      { "3.1114.0": "2026-08-19T19:30:06.825Z", "3.1119.0": "2026-08-26T19:21:52.163Z" },
      nowMs,
    );
    expect(result).toEqual({
      connector: "aws",
      dependency: "@aws-sdk/client-sesv2",
      spec: "^3.0.0",
      freshVersions: ["3.1119.0"],
    });
  });

  test("self-test: an exact pre-window pin stays silent", () => {
    const nowMs = Date.parse("2026-08-27T12:00:00Z");
    const result = findAdmissions(
      "aws",
      "@aws-sdk/client-sesv2",
      "3.1114.0",
      ["3.1114.0"],
      { "3.1114.0": "2026-08-19T19:30:06.825Z" },
      nowMs,
    );
    expect(result).toBeNull();
  });

  test("no connector manifest declares an @aws-sdk/* range (HARD)", () => {
    const ranges = awsSdkConnectors()
      .flatMap((c) => c.declarations)
      .filter((d) => !isExactSpec(d.spec));
    expect(ranges).toEqual([]);
  });

  test("every connector declaring @aws-sdk/* carries a tracked bun.lock (HARD)", () => {
    const withSdk = [...new Set(awsSdkConnectors().flatMap((c) => c.declarations.map((d) => c.name)))];
    const without = withSdk.filter((name) => !fs.existsSync(path.join(connectorsDir(), name, "bun.lock")));
    expect(without).toEqual([]);
  });

  test("no connector's declared @aws-sdk specifier admits a version younger than the 7-day quarantine window (HARD)", async () => {
    const connectors = awsSdkConnectors();
    const declarations = connectors.flatMap((c) => c.declarations);
    if (declarations.length === 0) {
      console.info("[SKIP connector-sdk-quarantine] no connector declares @aws-sdk/*; nothing to assert");
      return;
    }

    const timesByDep: Record<string, Record<string, string | null>> = {};
    for (const dep of [...new Set(declarations.map((d) => d.dependency))]) {
      const times = await fetchPublishedTimes(dep);
      if (times === null) {
        console.info("[SKIP connector-sdk-quarantine] registry unreadable (network failure); assertion skipped");
        return;
      }
      timesByDep[dep] = times;
    }

    const findings: QuarantineAdmission[] = [];
    for (const d of declarations) {
      const admittedVersions = await fetchAdmittedVersions(d.dependency, d.spec);
      if (admittedVersions === null) {
        console.info("[SKIP connector-sdk-quarantine] registry unreadable (network failure); assertion skipped");
        return;
      }
      const finding = findAdmissions(
        d.connector,
        d.dependency,
        d.spec,
        admittedVersions,
        timesByDep[d.dependency],
        Date.now(),
      );
      if (finding) findings.push(finding);
    }
    expect(findings).toEqual([]);
  });
});
