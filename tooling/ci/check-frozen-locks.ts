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
 *   `dependencies` match the manifest. This is the Docker deploy lane's exact
 *   firing surface: measured on bun 1.2 / 1.3.14 / 1.4.0, the lane's
 *   `bun install --frozen-lockfile` fires on dependency-range drift (the wave
 *   class) while TOLERATING name drift (apps/ui's lockfile records
 *   `@hasnaxyz/ui-local` vs manifest `@hasna/ui` — lane passes) and missing
 *   devDependencies (apps/billing, apps/router, apps/skills and others carry
 *   manifest devDeps the lockfile root entry does not record — lane passes).
 *   So RULE 2 compares dependencies only, exactly as strict as the lane.
 *
 * RULE 3 — REGISTRY @hasna/* EDGES BEHIND THE PUBLISHED VERSION (see the
 *   implementation comment). A dependency edge — including a hoisted top-level
 *   entry, judged by the declaring workspace member manifests — resolving a
 *   @hasna/* package from the registry below its npm-published max, while the
 *   recorded range admits the max, is a stale pin — the class the fleet
 *   version-skew audit files as "local X behind Y" (@hasna/events 0.1.15
 *   behind 0.1.16, T-00100). The comparison is npm-backed, deliberately: an
 *   offline comparison against the workspace version would fire on every
 *   version wave from manifest bump to publish and deadlock the release
 *   cadence. npm unavailability is a REFUSAL — the runner exits 2 and never
 *   prints the clean line when any probe was skipped.
 *
 * EXCEPTIONS — deliberate and attributable. Each names a manifest pin to a
 * version that is NOT on the npm registry; the owning release lane must publish
 * (or repin) before the app can leave this registry, and the lockfile cannot be
 * regenerated while the pin is unresolvable. A member leaves this set in the
 * change that publishes its pin.
 *
 * Re-measured 2026-08-23 against the live registry with `npm view <spec>
 * version`, two-sided so the probe is known to discriminate — positive:
 * @hasna/contracts@0.13.4 and @hasna/conversations@0.7.4 both rc=0; negative:
 * @hasna/conversations@99.99.99 and a nonexistent package name both rc=1.
 *
 *   automations — @hasna/actions@^0.2.1 unresolvable (0.2.1 rc=1). The pin is a
 *                 peer dependency, not a `dependencies` entry: a probe that
 *                 reads only `dependencies` reports this member clean.
 *   economy     — @hasna/projects@0.1.144 rc=1, so its install still fails.
 *                 That pin is now the WHOLE of its blocker: the three versions
 *                 this entry previously cited (@hasna/conversations@0.7.5,
 *                 @hasna/mementos@0.14.86, @hasna/todos@0.15.46) are all
 *                 published as of this measurement.
 *   domains     — @hasna/contracts@0.14.1 rc=1 until the contracts release lane
 *                 publishes it (added 2026-08-25 by the publish-all-contracts
 *                 lane, PR #1176). The domains manifest pin was bumped by
 *                 Version Packages #1168 while the lockfile could not follow:
 *                 measured standalone regen (`bun install --lockfile-only` in a
 *                 dir with no workspace parent) rc=1 "No version matching
 *                 '0.14.1' found for specifier '@hasna/contracts'". The lockfile
 *                 regenerates in the change that follows the 0.14.1 publish —
 *                 the economy O15-00629 pattern. The vendored storage-kit is
 *                 already regenerated at 0.14.1 in the same PR; only the
 *                 registry-resolved lockfile entry is pending.
 *   testers     — @hasna/browser@0.5.28 rc=1. Inert for RULE 2 as well: no
 *                 `apps/testers/bun.lock` is tracked (only its dashboard's).
 *   browser     — NOT justified by an unresolvable pin any more, and this entry
 *                 must not be read as a justification. Every direct pin in its
 *                 manifest resolves rc=0 as of this measurement
 *                 (@hasna/connectors@1.4.2, @hasna/conversations@0.7.5,
 *                 @hasna/events@0.1.3, @hasna/mementos@0.14.86,
 *                 @hasna/secrets@0.3.4, @hasna/sessions@0.12.19,
 *                 @hasna/skills@0.1.41, @hasna/todos@0.15.46), so its 6 RULE 2
 *                 hits ARE regenerable and the gate is vacuous for this member
 *                 while the entry stands. It is held only because regenerating
 *                 apps/browser/bun.lock moves six dependency majors into that
 *                 member's Docker deploy lane — a materially larger change than
 *                 this one, owed its own reviewed lane. Drop this entry in that
 *                 change, not by publishing anything.
 *
 * `projects` LEFT this set on 2026-08-23, and the reason is the shape to copy.
 * All five of its pins resolve rc=0 (@hasna/contracts@0.13.4,
 * @hasna/conversations@0.7.5, @hasna/events@0.1.3, @hasna/mementos@0.14.86,
 * @hasna/todos@0.15.46), so the premise of its exception — an unpublished pin
 * making the lockfile unregenerable — was false. `apps/projects/bun.lock` was
 * regenerated by the standalone procedure the failure text at the foot of this
 * file documents (member manifest + lockfile copied into a directory with no
 * workspace parent, `bun install --lockfile-only`, rc=0, "Saved bun.lock (230
 * packages)"), taking its RULE 2 hits from 4 to 0. That also repaired the
 * transitive resolution the stale lock carried: it resolved
 * @hasna/contracts@0.5.2 and @hasna/contracts@0.8.5 alongside 0.13.3, against a
 * manifest asking for 0.13.4; the regenerated lock resolves
 * @hasna/todos@0.15.46 -> @hasna/contracts@0.13.4 and @hasna/mementos@0.14.86
 * -> @hasna/contracts@0.10.6.
 *
 * RULE 4 — DOCKERFILE LOCKFILE PRESENCE (see the implementation comment): a
 *   member whose Dockerfile COPYs an UNGLOBED `bun.lock` must ship its own
 *   `apps/<name>/bun.lock` — the exact `COPY package.json bun.lock ./` class
 *   that failed every hooks deploy with "/bun.lock: not found" (O15-00667,
 *   measured 2026-08-25 on the deps stage). The globbed `bun.lock*` form is
 *   the sanctioned non-frozen-install escape (telephony; testers under
 *   I38-00566) and stays exempt — a globbed COPY with no lockfile resolves
 *   from the manifest and is a deliberate sibling pattern, not a defect.
 *
 * RULE 5 — MEMBER MANIFEST VERSION BEHIND THE PUBLISHED LATEST (O15-00772).
 *   A member whose OWN manifest version is BELOW the npm-published latest is
 *   a src-vs-registry drift: something published a newer version without
 *   landing the bump on main — a ship lane publishing from a branch, a wave
 *   PR closed-unmerged after publishing. Deploying src then DOWNGRADES
 *   production. Measured 2026-08-24 (deploy pass 43): mementos-prod ran
 *   @hasna/mementos@0.14.87 (npm latest, published 2026-08-24T15:08Z from
 *   ship/I24-00018-mementos-0.14.87) while origin/main's manifest was still
 *   0.14.86 — the bump never reached main, blocking every later mementos
 *   deploy. RULE 3 covers registry EDGES behind the published max; this
 *   covers the member's own manifest.
 *
 *   The comparison is against the npm `latest` dist-tag, deliberately: the
 *   version wave bumps manifests BEFORE publish-all runs, so an offline
 *   comparison against the workspace would fire on every wave from bump to
 *   publish and deadlock the release cadence — the same reason RULE 3 is
 *   npm-backed. Only manifest < published fires; the wave direction
 *   (manifest > published) stays silent. npm unreachability is a REFUSAL
 *   exactly as RULE 3: a skipped probe increments `skipped` and the runner
 *   exits 2. A member that has never been published (no `latest` to compare)
 *   surfaces the same way — publish it first, or the gate cannot run.
 *
 * Not covered, stated so the boundary is visible:
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
import { execSync } from "node:child_process";

/** Apps skipped by RULE 2 — see the EXCEPTIONS block in the header for each. */
const UNRESOLVABLE_PINS = new Set<string>([
  "automations",
  "browser",
  "economy",
  "testers",
]);

/** npm published-max probe, injectable so the self-test stays offline. */
type PublishedProbe = (pkg: string) => string | null;

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

/** Minimal semver — enough for the @hasna/* pin shapes recorded in bun.lock. */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function versionCmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Does `range` admit `version`? Supports the shapes recorded for @hasna/*
 * dependencies in this repo's lockfiles: exact ("0.1.8"), caret ("^0.1.7"),
 * tilde ("~0.1.7"), star ("*"), and explicit two-bound ranges
 * (">=0.1.7 <0.2.0"). Unknown shapes return false — RULE 3 fails open, so it
 * can only flag skew it can prove.
 */
function satisfiesRange(range: string, version: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const spec = range.trim();
  if (spec === "*" || spec === "x" || spec === "X") return true;
  const exact = /^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (exact) return versionCmp(v, [Number(exact[1]), Number(exact[2]), Number(exact[3])]) === 0;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (caret) {
    const maj = Number(caret[1]);
    const min = Number(caret[2]);
    const pat = Number(caret[3]);
    const floor: [number, number, number] = [maj, min, pat];
    const ceil: [number, number, number] = maj > 0 ? [maj + 1, 0, 0] : min > 0 ? [maj, min + 1, 0] : [maj, min, pat + 1];
    return versionCmp(v, floor) >= 0 && versionCmp(v, ceil) < 0;
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (tilde) {
    const maj = Number(tilde[1]);
    const min = Number(tilde[2]);
    const pat = Number(tilde[3]);
    const floor: [number, number, number] = [maj, min, pat];
    const ceil: [number, number, number] = [maj, min + 1, 0];
    return versionCmp(v, floor) >= 0 && versionCmp(v, ceil) < 0;
  }
  const bounded = /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/.exec(spec);
  if (bounded) {
    const lo = parseVersion(bounded[1])!;
    const hi = parseVersion(bounded[2])!;
    return versionCmp(v, lo) >= 0 && versionCmp(v, hi) < 0;
  }
  return false;
}

/** Resolve the max published version of a package; null when npm is unreachable. */
function defaultPublishedProbe(pkg: string): string | null {
  try {
    const out = execSync(`npm view ${pkg} version`, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseVersion(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * RULE 3 — REGISTRY @hasna/* EDGES BEHIND THE PUBLISHED VERSION.
 *
 * A dependency edge that resolves a @hasna/* package FROM THE REGISTRY to a
 * version BELOW the max published on npm, while the edge's recorded declared
 * range (read from the consumer's metadata block in the same lockfile, or —
 * for hoisted entries, whose consumer edges are deduped away — from the
 * workspace member manifests) ADMITS the published max, is a stale pin: a
 * fresh resolution would pick the published max and the frozen install lags
 * the registry. This is the class the fleet version-skew audit files as
 * "local X behind Y" — measured 2026-08-23: @hasna/events resolves 0.1.15
 * for the @hasna/accounts, @hasna/sandboxes and
 * @hasna/files/@hasna/connectors edges while 0.1.16 is published and all
 * three consumers declare "^0.1.7" (todos T-00100). Deliberate exact pins
 * ("0.1.8", "0.1.14") do not admit the published max and stay silent.
 *
 * The comparison is against npm, deliberately: an offline comparison against
 * the workspace member's own version would fire on every version wave from
 * the manifest bump to the publish (the wave regenerates the lock while the
 * bumped version is still unpublished, so registry edges legitimately resolve
 * below it), deadlocking the release cadence.
 *
 * npm unreachability is a REFUSAL, not a pass: the runner exits 2 (could-not-
 * run) with an explicit message whenever any probe was skipped, and never
 * prints the clean line. A gate that could not run has cleared nothing.
 * `npm view <pkg> version` reads the `latest` dist-tag, which is the
 * fleet-published max on this repo's changesets cadence; a release that
 * publishes without moving `latest` is outside this gate's stated boundary.
 *
 * bun's own frozen check does NOT cover this class: the stale 0.1.15
 * satisfies every recorded range, so `bun install --frozen-lockfile` passes
 * while the local resolution lags the published 0.1.16 by one patch.
 */
interface RegistryCheckResult {
  problems: string[];
  skipped: number;
  failedProbes: number;
}

function checkRegistryEdges(root: string, published: PublishedProbe = defaultPublishedProbe): RegistryCheckResult {
  const lock = path.join(root, "bun.lock");
  const empty: RegistryCheckResult = { problems: [], skipped: 0, failedProbes: 0 };
  if (!fs.existsSync(lock)) return empty;
  const doc = parseLockfile(lock);
  const problems: string[] = [];
  let skipped = 0;
  let failedProbes = 0;
  const entries = doc.packages ?? {};
  const probeCache = new Map<string, string | null>();
  const probe = (pkg: string): string | null => {
    if (!probeCache.has(pkg)) {
      const result = published(pkg);
      probeCache.set(pkg, result);
      if (result === null) failedProbes++;
    }
    return probeCache.get(pkg)!;
  };
  const skipNotified = new Set<string>();

  // One consideration per (label, dep-spec, resolved-spec, declared-range).
  const consider = (label: string, depSpec: string, resolvedSpec: string, declared: string | undefined): void => {
    if (typeof declared !== "string") return;
    const rm = /^@hasna\/[^/@]+@(\d+\.\d+\.\d+)$/.exec(resolvedSpec);
    if (!rm) return; // workspace: resolution — the workspace entry's own domain
    const maxPublished = probe(depSpec);
    if (maxPublished === null) {
      skipped++;
      if (!skipNotified.has(depSpec)) {
        skipNotified.add(depSpec);
        console.error(`check-frozen-locks: npm unreachable — skipped published-version check for ${depSpec}`);
      }
      return;
    }
    if (!satisfiesRange(declared, maxPublished)) return; // deliberate pin or unknown shape — not provable skew
    const resolvedV = parseVersion(rm[1])!;
    const maxV = parseVersion(maxPublished)!;
    if (versionCmp(resolvedV, maxV) < 0) {
      problems.push(
        `${label}: resolves ${resolvedSpec} — behind published ${depSpec}@${maxPublished} while declared "${declared}" admits it`,
      );
    }
  };

  // (a) Edge keys are "<consumer>/<dep-spec>"; the dep spec itself contains a
  // "/" for scoped names ("@hasna/accounts/@hasna/events"), so the consumer
  // boundary is the LAST "/@" — the slash before the scoped dep spec. The
  // declared range is read from the consumer's recorded metadata.
  for (const [key, tuple] of Object.entries(entries)) {
    if (!Array.isArray(tuple) || tuple.length < 2) continue;
    const slash = key.lastIndexOf("/@");
    if (slash < 0) continue; // hoisted top-level entry — handled in (b)
    const depSpec = key.slice(slash + 1);
    if (!depSpec.startsWith("@hasna/")) continue;
    const consumer = entries[key.slice(0, slash)];
    if (!Array.isArray(consumer) || consumer.length < 3 || typeof consumer[2] !== "object" || consumer[2] === null) {
      continue;
    }
    const declared = consumer[2].dependencies?.[depSpec] ?? consumer[2].optionalDependencies?.[depSpec];
    consider(`root bun.lock ${key}`, depSpec, String(tuple[0]), declared);
  }

  // (b) Hoisted top-level entries: bun dedupes consumer edges away when the
  // resolution matches the hoisted entry, so the declaring range lives in the
  // workspace member manifests instead. Any member whose declared range
  // admits the published max while the hoisted resolution sits below it is a
  // stale pin — a fresh resolution would mint the newer version for that
  // member.
  const memberDeclared = new Map<string, Array<{ member: string; range: string }>>();
  for (const member of memberDirs(root)) {
    const manifest = manifestOf(root, member);
    for (const field of ["dependencies", "optionalDependencies", "devDependencies"] as const) {
      const deps = manifest[field];
      if (typeof deps !== "object" || deps === null) continue;
      for (const [name, range] of Object.entries(deps)) {
        if (name.startsWith("@hasna/")) {
          if (!memberDeclared.has(name)) memberDeclared.set(name, []);
          memberDeclared.get(name)!.push({ member, range: String(range) });
        }
      }
    }
  }
  for (const [key, tuple] of Object.entries(entries)) {
    if (!Array.isArray(tuple) || tuple.length < 2) continue;
    if (!key.startsWith("@hasna/") || key.includes("/@")) continue;
    const decls = memberDeclared.get(key);
    if (!decls) continue;
    for (const decl of decls) {
      consider(`root bun.lock ${key} (hoisted via ${decl.member})`, key, String(tuple[0]), decl.range);
    }
  }

  return { problems, skipped, failedProbes };
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
    ]);
    problems.push(...problemsFor);
  }
  return problems;
}

/**
 * RULE 4 — DOCKERFILE LOCKFILE PRESENCE.
 *
 * A member Dockerfile that COPYs an UNGLOBED `bun.lock` (`COPY package.json
 * bun.lock ./` — the deploy-lane frozen-install shape) cannot build when the
 * member ships no lockfile: measured 2026-08-25 on apps/hooks, `docker build
 * --platform linux/arm64 --target deps` fails at the COPY with "/bun.lock":
 * not found (O15-00667). The globbed `bun.lock*` form is the deliberate
 * non-frozen-install escape (telephony; testers under I38-00566) and must
 * stay silent — the negative lookahead on the `*` is what keeps those
 * members exempt.
 */
function checkDockerfileLockfiles(root: string): string[] {
  const problems: string[] = [];
  for (const member of memberDirs(root)) {
    const dockerfile = path.join(root, "apps", member, "Dockerfile");
    if (!fs.existsSync(dockerfile)) continue;
    const content = fs.readFileSync(dockerfile, "utf8");
    const copiesUnglobbed = /^COPY\b[^\n]*\bbun\.lock\b(?!\*)/m.test(content);
    if (!copiesUnglobbed) continue;
    const lock = path.join(root, "apps", member, "bun.lock");
    if (!fs.existsSync(lock)) {
      problems.push(
        `apps/${member}/Dockerfile COPYs an unglobbed bun.lock but apps/${member}/bun.lock does not exist — the Docker deploy lane fails at COPY with "/bun.lock: not found"`,
      );
    }
  }
  return problems;
}

/**
 * RULE 5 — member manifest version behind the published latest. See the
 * header for the class and the wave-direction boundary.
 */
function checkMemberVersions(root: string, published: PublishedProbe): { problems: string[]; skipped: number } {
  const problems: string[] = [];
  let skipped = 0;
  for (const member of memberDirs(root)) {
    const manifest = manifestOf(root, member);
    const name = manifest?.name;
    const version = manifest?.version;
    if (typeof name !== "string" || !name.startsWith("@hasna/")) continue;
    const mv = typeof version === "string" ? parseVersion(version) : null;
    if (!mv) continue; // no comparable manifest version
    const latest = published(name);
    if (latest === null) {
      skipped++;
      console.error(`check-frozen-locks: npm unreachable — skipped published-version check for ${name}`);
      continue;
    }
    const lv = parseVersion(latest);
    if (!lv) continue;
    if (versionCmp(mv, lv) < 0) {
      problems.push(
        `${name} (apps/${member}): manifest ${version} — behind published ${name}@${latest}; land the bump on main before deploying`,
      );
    }
  }
  return { problems, skipped };
}

export function runCheck(root: string, published: PublishedProbe = defaultPublishedProbe): RegistryCheckResult {
  const registry = checkRegistryEdges(root, published);
  const memberVersions = checkMemberVersions(root, published);
  return {
    problems: [
      ...checkRootLockfile(root),
      ...checkAppLockfiles(root),
      ...checkDockerfileLockfiles(root),
      ...registry.problems,
      ...memberVersions.problems,
    ],
    skipped: registry.skipped + memberVersions.skipped,
    failedProbes: registry.failedProbes,
  };
}

function selfTest(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-frozen-locks-"));
  // Offline probe: fixture @hasna/* packages are not real on npm, so RULE 3
  // stays silent unless a discriminating stub is supplied below.
  const offlineProbe: PublishedProbe = () => null;
  try {
    // Fixture: two members, one with an own lockfile.
    fs.mkdirSync(path.join(dir, "apps", "alpha"), { recursive: true });
    fs.mkdirSync(path.join(dir, "apps", "beta"), { recursive: true });
    const alphaManifest = {
      name: "@hasna/alpha",
      version: "1.2.0",
      dependencies: { "@hasna/beta": "^0.9.0", lodash: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0" },
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
        },
      },
      packages: {},
    };
    fs.writeFileSync(path.join(dir, "apps", "alpha", "bun.lock"), JSON.stringify(alphaLock, null, 2));

    const clean = runCheck(dir, offlineProbe).problems;
    if (clean.length !== 0) {
      throw new Error(`positive control failed — known-good fixture reported: ${clean.join("; ")}`);
    }

    // RULE 4 controls — a Dockerfile COPYing an UNGLOBED bun.lock with no
    // member lockfile must fire; the globbed form (telephony/testers escape)
    // and a present lockfile must stay silent.
    fs.writeFileSync(path.join(dir, "apps", "beta", "Dockerfile"), "COPY package.json bun.lock ./\n");
    const r4Hits = runCheck(dir, offlineProbe).problems;
    if (!r4Hits.some((p) => p.includes("apps/beta/Dockerfile") && p.includes("bun.lock"))) {
      throw new Error(`negative control 6 failed — Dockerfile COPY without member lockfile not reported: ${r4Hits.join("; ")}`);
    }
    fs.writeFileSync(path.join(dir, "apps", "beta", "Dockerfile"), "COPY package.json bun.lock* ./\n");
    const r4Glob = runCheck(dir, offlineProbe).problems;
    if (r4Glob.some((p) => p.includes("apps/beta/Dockerfile"))) {
      throw new Error(`glob escape control failed — globbed bun.lock* COPY reported: ${r4Glob.join("; ")}`);
    }
    fs.rmSync(path.join(dir, "apps", "beta", "Dockerfile"), { force: true });
    fs.writeFileSync(path.join(dir, "apps", "alpha", "Dockerfile"), "COPY package.json bun.lock ./\n");
    const r4Present = runCheck(dir, offlineProbe).problems;
    if (r4Present.some((p) => p.includes("apps/alpha/Dockerfile"))) {
      throw new Error(`present-lockfile control failed — Dockerfile COPY with lockfile present reported: ${r4Present.join("; ")}`);
    }
    fs.rmSync(path.join(dir, "apps", "alpha", "Dockerfile"), { force: true });

    // Mutations must be caught: stale version, stale dep range, stale app lockfile.
    const staleLock = JSON.parse(JSON.stringify(goodLock));
    staleLock.workspaces["apps/alpha"].version = "1.1.0";
    staleLock.workspaces["apps/alpha"].dependencies["@hasna/beta"] = "^0.8.0";
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(staleLock, null, 2));
    const rootHits = runCheck(dir, offlineProbe).problems;
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
    const appHits = runCheck(dir, offlineProbe).problems;
    const appFired = appHits.some((p) => p.includes("apps/alpha/bun.lock") && p.includes("lodash"));
    if (!appFired) {
      throw new Error(`negative control 2 failed — stale app lockfile not reported: ${appHits.join("; ")}`);
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
    const exceptedHits = runCheck(dir, offlineProbe).problems;
    if (exceptedHits.some((p) => p.includes("apps/economy"))) {
      throw new Error(`exception control failed — economy should be exempt: ${exceptedHits.join("; ")}`);
    }

    // RULE 3 controls — registry @hasna/* edge behind the published max must
    // fire; an edge AT the published max and a deliberate exact pin must not.
    // Stub probe: @hasna/beta's published max is 0.1.16 (mirrors the measured
    // @hasna/events 0.1.15-behind-0.1.16 case, todos T-00100).
    const r3Published: PublishedProbe = (pkg) => (pkg === "@hasna/beta" ? "0.1.16" : null);
    // Clear fixture leftovers from the earlier controls so RULE 1/2 stay quiet.
    fs.rmSync(path.join(dir, "apps", "economy"), { recursive: true, force: true });
    fs.rmSync(path.join(dir, "apps", "alpha", "bun.lock"), { force: true });
    const r3Lock = JSON.parse(JSON.stringify(goodLock));
    r3Lock.packages = {
      "@hasna/alpha": ["@hasna/alpha@1.2.0", "", { "dependencies": { "@hasna/beta": "^0.1.7", lodash: "^4.0.0" } }, "sha-alpha"],
      "@hasna/alpha/@hasna/beta": ["@hasna/beta@0.1.15", "", { "dependencies": {} }, "sha-stale"],
    };
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(r3Lock, null, 2));
    const r3Hits = runCheck(dir, r3Published).problems;
    if (!r3Hits.some((p) => p.includes("@hasna/alpha/@hasna/beta") && p.includes("0.1.16"))) {
      throw new Error(`negative control 3 failed — stale registry edge not reported: ${r3Hits.join("; ")}`);
    }

    // Edge at the published max must stay silent.
    const r3Current = JSON.parse(JSON.stringify(r3Lock));
    r3Current.packages["@hasna/alpha/@hasna/beta"][0] = "@hasna/beta@0.1.16";
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(r3Current, null, 2));
    const r3CurrentHits = runCheck(dir, r3Published).problems;
    if (r3CurrentHits.some((p) => p.includes("@hasna/alpha/@hasna/beta"))) {
      throw new Error(`positive control 2 failed — edge at published max reported: ${r3CurrentHits.join("; ")}`);
    }

    // Deliberate exact pin below the published max must stay silent.
    const r3Exact = JSON.parse(JSON.stringify(r3Lock));
    r3Exact.packages["@hasna/alpha/@hasna/beta"][0] = "@hasna/beta@0.1.15";
    r3Exact.packages["@hasna/alpha"][2].dependencies["@hasna/beta"] = "0.1.15";
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(r3Exact, null, 2));
    const r3ExactHits = runCheck(dir, r3Published).problems;
    if (r3ExactHits.some((p) => p.includes("@hasna/alpha/@hasna/beta"))) {
      throw new Error(`exact-pin control failed — deliberate old pin reported: ${r3ExactHits.join("; ")}`);
    }

    // Negative control 4 — a skipped npm probe must SURFACE as a skip, never
    // vanish into a silent pass: with the offline probe the stale edge must
    // not fire, but skipped must be > 0 (the runner exits 2 on skips).
    const r3Skip = runCheck(dir, offlineProbe);
    if (r3Skip.problems.some((p) => p.includes("@hasna/alpha/@hasna/beta"))) {
      throw new Error(`skip control failed — offline probe fired: ${r3Skip.problems.join("; ")}`);
    }
    if (r3Skip.skipped < 1) {
      throw new Error(`skip control failed — npm-unreachable edge did not surface as a skip`);
    }

    // Hoisted controls — a top-level registry entry (consumer edges deduped
    // away) must be judged by the workspace member manifests. Member "gamma"
    // declares @hasna/delta ^0.1.7; stub published max 0.1.16.
    fs.mkdirSync(path.join(dir, "apps", "gamma"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "apps", "gamma", "package.json"),
      JSON.stringify({
        name: "@hasna/gamma",
        version: "0.2.0",
        dependencies: { "@hasna/delta": "^0.1.7" },
        devDependencies: {},
      }),
    );
    const gammaEntry = { name: "@hasna/gamma", version: "0.2.0", dependencies: { "@hasna/delta": "^0.1.7" }, devDependencies: {} };
    const r3Published2: PublishedProbe = (pkg) => (pkg === "@hasna/delta" ? "0.1.16" : null);
    const hoistedLock = JSON.parse(JSON.stringify(r3Lock));
    hoistedLock.workspaces["apps/gamma"] = gammaEntry;
    hoistedLock.packages = {
      "@hasna/delta": ["@hasna/delta@0.1.15", "", { "dependencies": {} }, "sha-delta-stale"],
      "@hasna/alpha": ["@hasna/alpha@1.2.0", "", { "dependencies": { "@hasna/beta": "^0.1.7", lodash: "^4.0.0" } }, "sha-alpha"],
    };
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(hoistedLock, null, 2));
    const hoistedHits = runCheck(dir, r3Published2).problems;
    if (!hoistedHits.some((p) => p.includes("hoisted via gamma") && p.includes("0.1.16"))) {
      throw new Error(`negative control 5 failed — hoisted stale edge not reported: ${hoistedHits.join("; ")}`);
    }

    // Hoisted entry at the published max must stay silent.
    const hoistedCurrent = JSON.parse(JSON.stringify(hoistedLock));
    hoistedCurrent.packages["@hasna/delta"][0] = "@hasna/delta@0.1.16";
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(hoistedCurrent, null, 2));
    const hoistedCurrentHits = runCheck(dir, r3Published2).problems;
    if (hoistedCurrentHits.some((p) => p.includes("hoisted via gamma"))) {
      throw new Error(`positive control 3 failed — hoisted edge at published max reported: ${hoistedCurrentHits.join("; ")}`);
    }

    // Hoisted exact pin below the published max must stay silent.
    const hoistedExact = JSON.parse(JSON.stringify(hoistedLock));
    hoistedExact.packages["@hasna/delta"][0] = "@hasna/delta@0.1.15";
    hoistedExact.workspaces["apps/gamma"].dependencies["@hasna/delta"] = "0.1.15";
    fs.writeFileSync(
      path.join(dir, "apps", "gamma", "package.json"),
      JSON.stringify({
        name: "@hasna/gamma",
        version: "0.2.0",
        dependencies: { "@hasna/delta": "0.1.15" },
        devDependencies: {},
      }),
    );
    fs.writeFileSync(path.join(dir, "bun.lock"), JSON.stringify(hoistedExact, null, 2));
    const hoistedExactHits = runCheck(dir, r3Published2).problems;
    if (hoistedExactHits.some((p) => p.includes("hoisted via gamma"))) {
      throw new Error(`hoisted exact-pin control failed — deliberate old pin reported: ${hoistedExactHits.join("; ")}`);
    }

    // RULE 5 controls — member manifest version BEHIND the published latest
    // must fire (the O15-00772 drift class); AT the published latest (steady
    // state) and AHEAD of it (version wave: bump merged, publish-all not run
    // yet — the direction that must never deadlock the cadence) must stay
    // silent. An unreachable member probe must surface as a skip, never as a
    // silent pass.
    const r5Stale: PublishedProbe = (pkg) => (pkg === "@hasna/alpha" ? "1.2.1" : null);
    const r5StaleHits = runCheck(dir, r5Stale).problems;
    if (!r5StaleHits.some((p) => p.includes("@hasna/alpha") && p.includes("1.2.1"))) {
      throw new Error(`RULE 5 control failed — manifest behind published latest not reported: ${r5StaleHits.join("; ")}`);
    }
    const r5Current: PublishedProbe = (pkg) => (pkg === "@hasna/alpha" ? "1.2.0" : null);
    const r5CurrentHits = runCheck(dir, r5Current).problems;
    if (r5CurrentHits.some((p) => p.includes("@hasna/alpha"))) {
      throw new Error(`RULE 5 control failed — manifest at published latest reported: ${r5CurrentHits.join("; ")}`);
    }
    const r5Ahead: PublishedProbe = (pkg) => (pkg === "@hasna/alpha" ? "1.1.0" : null);
    const r5AheadHits = runCheck(dir, r5Ahead).problems;
    if (r5AheadHits.some((p) => p.includes("@hasna/alpha"))) {
      throw new Error(`RULE 5 control failed — wave-in-flight manifest ahead of published reported: ${r5AheadHits.join("; ")}`);
    }
    const r5Skip = runCheck(dir, offlineProbe).skipped;
    if (r5Skip < 1) {
      throw new Error(`RULE 5 skip control failed — unreachable member probe did not surface as a skip`);
    }

    console.log(
      "self-test PASS — positive controls clean; negative controls 1-6 + skip + exact-pin (edge and hoisted) + RULE 4 glob/present + RULE 5 stale/current/ahead/skip controls fired/silent as required; exception respected",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const root = process.cwd();
  const { problems, skipped, failedProbes } = runCheck(root);
  if (skipped > 0) {
    console.error(
      `FROZEN-LOCK RULE 3 COULD NOT RUN — ${skipped} check(s) skipped (${failedProbes} npm probe(s) failed, registry unreachable).`,
    );
    console.error("A gate that could not run has cleared nothing: this run is NOT a pass. Fix the network and re-run.");
    process.exit(2);
  }
  if (problems.length > 0) {
    console.error(`FROZEN-LOCK VIOLATIONS (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Regenerate the stale lockfile(s). The root one: `bun install --lockfile-only` at");
    console.error("the monorepo root. A per-app one: NOT in apps/<name>/ — measured on bun 1.3.13,");
    console.error("`bun install --lockfile-only` there walks up to the workspace root (root");
    console.error("package.json declares workspaces [\"apps/*\", ...]) and rewrites the ROOT bun.lock");
    console.error("at rc=0 while apps/<name>/bun.lock is left untouched. Copy the member's");
    console.error("package.json + bun.lock (plus any manifest its own `workspaces` names) into a");
    console.error("directory with no workspace parent, run `bun install --lockfile-only` there, and");
    console.error("copy the result back — that standalone shape is exactly what the Docker deploy");
    console.error("lane installs, so it is the shape the lockfile must be generated in.");
    process.exit(1);
  }
  console.log("frozen-locks: root bun.lock and app bun.lock files match their manifests");
}
