/**
 * Frozen-lockfile gate for hasna/apps.
 *
 * The version wave (hasna/apps#717) and subsequent release commits bumped
 * package manifests WITHOUT regenerating the per-app and root lockfiles.
 * Every Docker deploy lane installs the app's package.json together with the
 * app's OWN `bun.lock` (the lane copies both into the image and runs
 * `bun install --frozen-lockfile`), so the stale app lockfiles broke the lane
 * with `error: lockfile had changes, but lockfile is frozen` — measured for
 * 22 deploy services on 2026-08-21. The root bun.lock was stale in the same
 * wave (e.g. @hasna/hooks 0.6.11 recorded vs 0.7.0 in the manifest).
 *
 * bun's own frozen check does NOT flag this class: measured on bun 1.2 / 1.3.14
 * / 1.4.0, `bun install --frozen-lockfile` at the monorepo root PASSES while
 * the lockfile still records stale workspace-package versions and dependency
 * ranges (the resolution is unchanged — workspace members resolve to the
 * workspace regardless). So this gate compares the lockfiles against the
 * manifests structurally, which is the exact comparison the wave broke.
 *
 * RULE 1 — ROOT lockfile: every `workspaces["apps/<name>"]` entry in the root
 *   `bun.lock` must match its manifest (name, version, dependencies,
 *   devDependencies). A member directory with a manifest but no lockfile
 *   entry also fails.
 *
 * RULE 2 — APP lockfiles: every top-level app with its own
 *   `apps/<name>/bun.lock` must have the lockfile's root workspace entry
 *   `dependencies` and `optionalDependencies` match the manifest. This is the
 *   Docker deploy lane's exact firing surface: measured on bun 1.2 / 1.3.14 /
 *   1.4.0, the lane's `bun install --frozen-lockfile` fires on dependency-range
 *   drift (the wave class) while TOLERATING name drift (apps/ui's lockfile
 *   records `@hasnaxyz/ui-local` vs manifest `@hasna/ui` — lane passes) and
 *   missing devDependencies (apps/billing, apps/router, apps/skills and others
 *   carry manifest devDeps the lockfile root entry does not record — lane
 *   passes). optionalDependencies drift fires the lane too, measured on bun
 *   1.3.14 with the apps/loops 0.5.11 wave pin: manifest `@hasna/machines`
 *   0.2.35 (E404 on the registry) against lockfile 0.2.34 → rc=1
 *   "lockfile had changes, but lockfile is frozen". So RULE 2 compares
 *   dependencies plus optionalDependencies, exactly as strict as the lane.
 *
 * EXCEPTIONS — deliberate and attributable. Each names a manifest pin to a
 * version that is NOT on the npm registry (measured E404 2026-08-21); the
 * owning release lane must publish (or repin) before the app can leave this
 * registry, and the lockfile cannot be regenerated while the pin is
 * unresolvable. A member leaves this set in the change that publishes its pin.
 *
 *   automations — manifest pins @hasna/actions@0.2.1 (E404)
 *   browser     — manifest pins @hasna/connectors@1.4.2 (E404)
 *   economy     — manifest pins @hasna/projects@0.1.134 (E404)
 *   testers     — manifest pins @hasna/browser@0.5.18 (E404)
 *
 * Not covered, stated so the boundary is visible:
 *   - apps with a Dockerfile but NO own lockfile (hooks — no
 *     `apps/hooks/bun.lock` is tracked, so its Docker `COPY package.json
 *     bun.lock ./` fails independently of lockfile freshness; telephony — its
 *     Dockerfile runs non-frozen `bun install`).
 *   - Resolution-level drift that leaves the recorded workspace entry intact
 *     (bun's own frozen check covers that class where it applies).
 *
 * The gate carries its own two-sided self-test (prove-it-can-fail): a
 * known-good lockfile/manifest pair must PASS and a mutated pair must FAIL,
 * because a gate whose patterns cannot fire reports a clean tree, and a clean
 * tree is exactly what success looks like.
 *
 * Usage:
 *   bun tooling/ci/check-frozen-locks.ts
 *   bun tooling/ci/check-frozen-locks.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Apps whose manifest pins an unpublished registry version (see header). */
const UNRESOLVABLE_PINS = new Set<string>([
  "automations",
  "browser",
  "economy",
  "testers",
]);

/** Load a bun.lock v1 document (JSON with trailing commas tolerated). */
function parseLockfile(file: string): any {
  const src = fs.readFileSync(file, "utf8");
  const normalized = src.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(normalized);
}

function memberDirs(root: string): string[] {
  const apps = path.join(root, "apps");
  if (!fs.existsSync(apps)) return [];
  return fs
    .readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(apps, e.name, "package.json")))
    .map((e) => e.name);
}

function manifestOf(root: string, member: string): any {
  return JSON.parse(fs.readFileSync(path.join(root, "apps", member, "package.json"), "utf8"));
}

function compareEntry(label: string, entry: any, manifest: any, fields: readonly ("dependencies" | "devDependencies")[]): string[] {
  const problems: string[] = [];
  if (!entry) {
    problems.push(`${label}: no workspace entry in lockfile`);
    return problems;
  }
  for (const field of fields) {
    const a = entry[field] ?? {};
    const b = manifest[field] ?? {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (a[k] !== b[k]) {
        problems.push(`${label}: ${field}["${k}"] lockfile ${a[k] ?? "(absent)"} != manifest ${b[k] ?? "(absent)"}`);
      }
    }
  }
  return problems;
}

function checkRootLockfile(root: string): string[] {
  const lock = path.join(root, "bun.lock");
  if (!fs.existsSync(lock)) return [];
  const doc = parseLockfile(lock);
  const problems: string[] = [];
  for (const member of memberDirs(root)) {
    const entry = doc.workspaces?.[`apps/${member}`];
    const problemsFor = compareEntry(`root bun.lock apps/${member}`, entry, manifestOf(root, member), [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]);
    problems.push(...problemsFor);
    if (entry) {
      if (entry.name !== undefined && entry.name !== manifestOf(root, member).name) {
        problems.push(`root bun.lock apps/${member}: name ${entry.name} != manifest ${manifestOf(root, member).name}`);
      }
      if (entry.version !== undefined && entry.version !== manifestOf(root, member).version) {
        problems.push(`root bun.lock apps/${member}: version ${entry.version} != manifest ${manifestOf(root, member).version}`);
      }
    }
  }
  // Root package entry (devDependencies only — no version/deps in the root manifest).
  const rootEntry = doc.workspaces?.[""];
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (rootEntry) {
    for (const field of ["devDependencies"] as const) {
      const a = rootEntry[field] ?? {};
      const b = rootManifest[field] ?? {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (a[k] !== b[k]) {
          problems.push(`root bun.lock devDependencies["${k}"] lockfile ${a[k] ?? "(absent)"} != manifest ${b[k] ?? "(absent)"}`);
        }
      }
    }
  }
  return problems;
}

function checkAppLockfiles(root: string): string[] {
  const problems: string[] = [];
  for (const member of memberDirs(root)) {
    if (UNRESOLVABLE_PINS.has(member)) continue;
    const lock = path.join(root, "apps", member, "bun.lock");
    if (!fs.existsSync(lock)) continue;
    const doc = parseLockfile(lock);
    const entry = doc.workspaces?.[""];
    const problemsFor = compareEntry(`apps/${member}/bun.lock (root entry)`, entry, manifestOf(root, member), [
      "dependencies",
      "optionalDependencies",
    ]);
    problems.push(...problemsFor);
  }
  return problems;
}

export function runCheck(root: string): string[] {
  return [...checkRootLockfile(root), ...checkAppLockfiles(root)];
}

function selfTest(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-frozen-locks-"));
  try {
    // Fixture: two members, one with an own lockfile.
    fs.mkdirSync(path.join(dir, "apps", "alpha"), { recursive: true });
    fs.mkdirSync(path.join(dir, "apps", "beta"), { recursive: true });
    const alphaManifest = {
      name: "@hasna/alpha",
      version: "1.2.0",
      dependencies: { "@hasna/beta": "^0.9.0", lodash: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0" },
      optionalDependencies: { "@hasna/machines": "0.2.34" },
    };
    const betaManifest = {
      name: "@hasna/beta",
      version: "0.9.0",
      dependencies: {},
      devDependencies: {},
    };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@hasna/apps", devDependencies: { turbo: "2.0.0" } }));
    fs.writeFileSync(path.join(dir, "apps", "alpha", "package.json"), JSON.stringify(alphaManifest));
    fs.writeFileSync(path.join(dir, "apps", "beta", "package.json"), JSON.stringify(betaManifest));

    const goodLock = {
      lockfileVersion: 1,
      workspaces: {
        "": { name: "@hasna/apps", devDependencies: { turbo: "2.0.0" } },
        "apps/alpha": {
          name: "@hasna/alpha",
          version: "1.2.0",
          dependencies: { "@hasna/beta": "^0.9.0", lodash: "^4.0.0" },
          devDependencies: { typescript: "^5.0.0" },
          optionalDependencies: { "@hasna/machines": "0.2.34" },
        },
        "apps/beta": { name: "@hasna/beta", version: "0.9.0", dependencies: {}, devDependencies: {} },
      },
      packages: {},
    };
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(goodLock, null, 2));
    // Alpha's own lockfile matches its manifest.
    const alphaLock = {
      lockfileVersion: 1,
      workspaces: {
        "": {
          name: "@hasna/alpha",
          dependencies: { "@hasna/beta": "^0.9.0", lodash: "^4.0.0" },
          devDependencies: { typescript: "^5.0.0" },
          optionalDependencies: { "@hasna/machines": "0.2.34" },
        },
      },
      packages: {},
    };
    fs.writeFileSync(path.join(dir, "apps", "alpha", "bun.lock"), JSON.stringify(alphaLock, null, 2));

    const clean = runCheck(dir);
    if (clean.length !== 0) {
      throw new Error(`positive control failed — known-good fixture reported: ${clean.join("; ")}`);
    }

    // Mutations must be caught: stale version, stale dep range, stale app lockfile.
    const staleLock = JSON.parse(JSON.stringify(goodLock));
    staleLock.workspaces["apps/alpha"].version = "1.1.0";
    staleLock.workspaces["apps/alpha"].dependencies["@hasna/beta"] = "^0.8.0";
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(staleLock, null, 2));
    const rootHits = runCheck(dir);
    const rootFired =
      rootHits.some((p) => p.includes("version 1.1.0")) &&
      rootHits.some((p) => p.includes('dependencies["@hasna/beta"]'));
    if (!rootFired) {
      throw new Error(`negative control 1 failed — stale root entry not reported: ${rootHits.join("; ")}`);
    }

    // Restore root lockfile; stale app lockfile must be caught.
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(goodLock, null, 2));
    const staleAppLock = JSON.parse(JSON.stringify(alphaLock));
    staleAppLock.workspaces[""].dependencies["lodash"] = "^3.0.0";
    fs.writeFileSync(path.join(dir, "apps", "alpha", "bun.lock"), JSON.stringify(staleAppLock, null, 2));
    const appHits = runCheck(dir);
    const appFired = appHits.some((p) => p.includes("apps/alpha/bun.lock") && p.includes("lodash"));
    if (!appFired) {
      throw new Error(`negative control 2 failed — stale app lockfile not reported: ${appHits.join("; ")}`);
    }

    // Optional-dependency drift must also be caught: the apps/loops 0.5.11
    // wave pinned @hasna/machines 0.2.35 (E404) in optionalDependencies while
    // the app lockfile recorded 0.2.34, and the lane's frozen install fired.
    const optDepLock = JSON.parse(JSON.stringify(alphaLock));
    optDepLock.workspaces[""].optionalDependencies = { "@hasna/machines": "0.2.35" };
    fs.writeFileSync(path.join(dir, "apps", "alpha", "bun.lock"), JSON.stringify(optDepLock, null, 2));
    const optDepHits = runCheck(dir);
    const optDepFired = optDepHits.some((p) => p.includes("apps/alpha/bun.lock") && p.includes("@hasna/machines"));
    if (!optDepFired) {
      throw new Error(`negative control 3 failed — stale optionalDependencies not reported: ${optDepHits.join("; ")}`);
    }

    // A member in the exception registry with a stale app lockfile must NOT
    // fire (the root entry must be present — RULE 1 legitimately requires it).
    fs.mkdirSync(path.join(dir, "apps", "economy"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "apps", "economy", "package.json"),
      JSON.stringify({ name: "@hasna/economy", version: "0.1.0", dependencies: {} }),
    );
    const economyRootEntry = { name: "@hasna/economy", version: "0.1.0", dependencies: {}, devDependencies: {} };
    const withEconomy = JSON.parse(JSON.stringify(goodLock));
    withEconomy.workspaces["apps/economy"] = economyRootEntry;
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(withEconomy, null, 2));
    fs.writeFileSync(
      path.join(dir, "apps", "economy", "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "@hasna/economy", dependencies: { stale: "^1.0.0" } } },
        packages: {},
      }),
    );
    const exceptedHits = runCheck(dir);
    if (exceptedHits.some((p) => p.includes("apps/economy"))) {
      throw new Error(`exception control failed — economy should be exempt: ${exceptedHits.join("; ")}`);
    }

    console.log("self-test PASS — positive control clean, both negative controls fired, exception respected");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const root = process.cwd();
  const problems = runCheck(root);
  if (problems.length > 0) {
    console.error(`FROZEN-LOCK VIOLATIONS (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Regenerate the stale lockfile(s): per-app bun.lock files regenerate standalone");
    console.error("(`bun install --lockfile-only` in the app dir), the root one at the monorepo root.");
    process.exit(1);
  }
  console.log("frozen-locks: root bun.lock and app bun.lock files match their manifests");
}
