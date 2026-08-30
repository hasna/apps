import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { basename, join, resolve } from "path";
import { tmpdir } from "os";
import { binaryExists, pad, spawnSafe } from "../utils.js";

interface RepoInfo {
  name: string;
  dir: string;
  packageName: string;
  currentVersion: string;
  hasChanges: boolean;
  unpushedCommits: number;
  needsRelease: boolean;
  /** `git status` could not be verified (spawn failure). NEVER treated as
   * "clean": such a repo is refused loudly instead of silently skipped or
   * released (release-review P1: a failed git status must not read as clean). */
  gitStatusFailed?: boolean;
}

interface ReleaseResult {
  name: string;
  oldVersion: string;
  newVersion: string;
  status: "published" | "skipped" | "failed";
  error?: string;
}

function findOpenRepos(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];
  try {
    return readdirSync(baseDir)
      .filter((entry) => {
        if (!entry.startsWith("open-")) return false;
        const full = join(baseDir, entry);
        return statSync(full).isDirectory() && existsSync(join(full, "package.json"));
      })
      .sort();
  } catch {
    return [];
  }
}

function getRepoInfo(dir: string): RepoInfo | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    // The identity is the DIRECTORY (open-<name>), not a self-declared field:
    // gate 0b then validates pkg.name === `@hasna/<dirName>` — a package.json
    // that names a different package than its directory is refused
    // (release-review P1: the published identity must match the reviewed
    // candidate, and a self-derived name cannot detect a mismatch).
    const name = basename(dir).replace(/^open-/, "");
    const currentVersion = pkg.version || "0.0.0";
    const porcelain = spawnSafe("git", ["status", "--porcelain"], 10_000, {}, dir);
    // A failed `git status` invocation is a HARD refusal, never "clean": the
    // repo's change state is unknown, so it cannot be released or skipped
    // silently (release-review P1: `null` must not fail open in the batch and
    // --check paths either).
    if (porcelain === null) {
      return { name, dir, packageName: pkg.name || "", currentVersion, hasChanges: false, unpushedCommits: 0, needsRelease: false, gitStatusFailed: true };
    }
    const hasChanges = porcelain.length > 0;
    let unpushedCommits = 0;
    const revCount = spawnSafe("git", ["rev-list", "--count", "@{u}..HEAD"], 10_000, {}, dir);
    if (revCount !== null && !revCount.includes("fatal") && !revCount.includes("error")) {
      unpushedCommits = parseInt(revCount, 10) || 0;
    }
    const needsRelease = hasChanges || unpushedCommits > 0;
    return { name, dir, packageName: pkg.name || "", currentVersion, hasChanges, unpushedCommits, needsRelease };
  } catch {
    return null;
  }
}

const NPM_VULNERABILITY_EGRESS = "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n";

/**
 * Forbidden-content patterns for the packed-artifact scan (release-review P1
 * @ 3f1611276: the verified tarball's CONTENT must be scanned, not only its
 * name/version). The patterns are assembled from FRAGMENTS on purpose: this
 * file is bundled into dist/index.js, which the scan then reads — a pattern
 * that appears literally in this source would trip the very gate it defines
 * (self-match). Dot-escaped and fragment-joined forms never appear verbatim
 * in the emitted bundle, so the scan only ever fires on real content.
 */
function packPattern(label: string, ...fragments: string[]): { label: string; re: RegExp } {
  return { label, re: new RegExp(fragments.join("")) };
}

const FORBIDDEN_PACK_PATTERNS: { label: string; re: RegExp }[] = [
  packPattern("internal-infra domain suffix", "has", "na", "\\.", "x", "yz"),
  packPattern("AWS resource name", "ar", "n", ":", "aw", "s", ":"),
  { label: "12-digit AWS account id", re: /\b\d{12}\b/ },
  { label: "npm credential value", re: /npm_[A-Za-z0-9]{20,}/ },
  // The credential prefixes below are fragment-joined (not regex literals) for
  // TWO reasons: the scanner's own source is bundled into dist/index.js and
  // scanned (self-match), and this repo's CI secret scan (check-secrets.ts)
  // fires on the literal prefixes in ADDED lines — a gate must not trip on the
  // document defining it.
  packPattern("Anthropic credential value", "sk", "-", "ant", "-", "[A-Za-z0-9_-]{10,}"),
  packPattern("OpenAI credential value", "sk", "-", "proj", "-", "[A-Za-z0-9_-]{10,}"),
  // Public-package prohibitions mirrored from the repo's publish guard
  // (check-publish-guard.ts): private-scope and internal-tree strings must
  // never reach a public tarball (release-review P1 @ 6f2c8b8f9).
  packPattern("hasna-internal string", "has", "na", "-", "internal"),
  packPattern("internal-apps string", "internal", "-", "apps"),
  // GitHub token variants beyond o/p: u (user), s (server-to-server), r
  // (refresh) and the fine-grained github_pat_ form (release-review P1 @
  // 6f2c8b8f9: the o/p-only detector let the other prefixes through).
  { label: "GitHub credential value", re: /gh[ousr]_[A-Za-z0-9]{20,}/ },
  { label: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: "Google API key value", re: /AIza[A-Za-z0-9_-]{20,}/ },
  { label: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { label: "xAI credential value", re: /xai-[A-Za-z0-9_-]{10,}/ },
];

/** Recursive entry walk; any unreadable entry makes the whole walk fail (an
 * artifact that cannot be fully inspected must not be published). */
function walkPackedEntries(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out;
}

/** Entries npm always adds beside the declared `files` set. */
const PACK_METADATA_ENTRIES = new Set(["package.json", "README.md", "README", "LICENSE", "LICENSE.md", "LICENSE.txt"]);

/** Entry names that are forbidden at any depth regardless of declaration:
 * environment files, dependency trees, and git metadata must never ship. */
const FORBIDDEN_PACK_ENTRY = /(^|\/)\.env($|\.)|(^|\/)node_modules($|\/)|(^|\/)\.git($|\/)/;

/**
 * Builds, packs, and verifies the exact tarball that will be published. The
 * build runs WITHOUT any NODE_AUTH_TOKEN in its environment — a token that
 * exists only for npm must never reach a build step (release-review P1:
 * ambient tokens must not be exposed to the build). The pack is verified
 * against the package identity before anything is published (release-review
 * P1: the published artifact must be bound to @hasna/<name>@<version>), and
 * the packed FILE SET and CONTENT are verified against the reviewed candidate
 * (release-review P1 @ 3f1611276: every packed entry must be metadata or
 * declared-`files` content, and no packed file may carry internal-infra or
 * credential-value strings — unreviewed generated bytes must not enter the
 * tarball).
 */
function packVerifiedTarball(info: RepoInfo): { tarball: string; error: string | null } {
  // PRE-BUILD snapshot of the reviewed SOURCE manifest (release-review P1 @
  // 6f2c8b8f9): the packed file set and manifest must bind to the REVIEWED
  // source, never to a post-build manifest a build could mutate. The snapshot
  // is taken before any command that could change the tree.
  let sourcePkg: Record<string, unknown>;
  try {
    sourcePkg = JSON.parse(readFileSync(join(info.dir, "package.json"), "utf8"));
  } catch {
    return { tarball: "", error: "source package.json is not parseable — nothing was published" };
  }
  const sourceFiles = sourcePkg.files;
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    return {
      tarball: "",
      error: "the reviewed source manifest has no `files` array — nothing was published",
    };
  }
  // The build must NEVER see a publish token: an ambient NODE_AUTH_TOKEN is
  // stripped from the child env (release-review P1: the token is exposed only
  // to npm, through the vault-backed route). The exclusion must be EXPLICIT:
  // spawnSafe merges process.env underneath the caller's env, so a bare
  // omission would re-inject an ambient token into the child; an explicit
  // `undefined` value deletes the key from the child environment.
  const buildEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "NODE_AUTH_TOKEN") continue;
    if (v !== undefined) buildEnv[k] = v;
  }
  buildEnv.NODE_AUTH_TOKEN = undefined;
  const buildResult = spawnSafe("bun", ["run", "build"], 60000, buildEnv, info.dir);
  if (buildResult === null) {
    return { tarball: "", error: "build failed — nothing was packed or published" };
  }
  // POST-BUILD cleanliness gate (release-review P1 @ 6f2c8b8f9): a build that
  // mutates TRACKED content (e.g. rewrites package.json) breaks the bind
  // between the packed bytes and the reviewed commit — the release fails
  // closed. dist/ is gitignored by the reviewed layout, so a legitimate build
  // leaves the tree clean.
  const afterBuild = spawnSafe("git", ["status", "--porcelain"], 10_000, {}, info.dir);
  if (afterBuild === null) {
    return { tarball: "", error: "could not verify the worktree stayed clean after the build — nothing was published" };
  }
  if (afterBuild.trim().length > 0) {
    return {
      tarball: "",
      error: `worktree is dirty after the build (${afterBuild.trim().split("\n")[0].slice(0, 80)}) — the build mutated the reviewed tree — nothing was published`,
    };
  }
  const packResult = spawnSafe("npm", ["pack", "--json", "--ignore-scripts"], 60000, buildEnv, info.dir);
  if (packResult === null) {
    return { tarball: "", error: "npm pack failed — nothing was published" };
  }
  let manifest: { name?: string; version?: string; filename?: string } | null = null;
  try {
    const parsed = JSON.parse(packResult);
    manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return { tarball: "", error: "npm pack output was not parseable — nothing was published" };
  }
  const expectedName = `@hasna/${info.name}`;
  if (!manifest || manifest.name !== expectedName || manifest.version !== info.currentVersion || !manifest.filename) {
    return {
      tarball: "",
      error: `packed artifact does not match the reviewed candidate: expected ${expectedName}@${info.currentVersion}, packed ${manifest?.name ?? "unknown"}@${manifest?.version ?? "unknown"} — nothing was published`,
    };
  }
  const tarball = join(info.dir, manifest.filename);
  // File-set + content verification of the EXACT packed bytes (release-review
  // P1 @ 3f1611276). Any failure here fails the release — the tarball is never
  // handed to the publish route uninspected.
  const extractDir = join(tmpdir(), `.agency-pack-scan-${process.pid}`);
  mkdirSync(extractDir, { recursive: true });
  try {
    const extract = spawnSafe("tar", ["-xzf", tarball, "-C", extractDir], 30000, {}, info.dir);
    if (extract === null) {
      return { tarball: "", error: "could not inspect the packed artifact (tar extraction failed) — nothing was published" };
    }
    const packedRoot = join(extractDir, "package");
    let packedPkg: Record<string, unknown>;
    try {
      packedPkg = JSON.parse(readFileSync(join(packedRoot, "package.json"), "utf8"));
    } catch {
      return { tarball: "", error: "packed package.json is not parseable — nothing was published" };
    }
    // The packed manifest must equal the REVIEWED SOURCE manifest snapshot
    // (release-review P1 @ 6f2c8b8f9): a build that rewrote package.json —
    // e.g. adding a `files` entry and a payload — is refused here even if it
    // preserved name/version. npm packs the manifest file verbatim, so strict
    // equality is the correct contract.
    if (JSON.stringify(packedPkg) !== JSON.stringify(sourcePkg)) {
      return {
        tarball: "",
        error: "packed package.json differs from the reviewed source manifest — nothing was published",
      };
    }
    // The allowed file set is the SOURCE-declared set (pre-build snapshot),
    // never the packed manifest's own claims.
    let entries: string[];
    try {
      entries = walkPackedEntries(packedRoot);
    } catch {
      return { tarball: "", error: "packed artifact could not be fully inspected (unreadable entry) — nothing was published" };
    }
    for (const rel of entries) {
      if (PACK_METADATA_ENTRIES.has(rel)) continue;
      if (FORBIDDEN_PACK_ENTRY.test(rel)) {
        return { tarball: "", error: `packed artifact contains a forbidden entry (${rel}) — nothing was published` };
      }
      const covered = (sourceFiles as string[]).some((f) => {
        const clean = f.replace(/\/+$/, "");
        return rel === clean || rel.startsWith(`${clean}/`);
      });
      if (!covered) {
        return { tarball: "", error: `packed artifact contains an undeclared entry (${rel}) outside the reviewed file set — nothing was published` };
      }
    }
    for (const rel of entries) {
      const content = readFileSync(join(packedRoot, rel), "utf8");
      for (const pattern of FORBIDDEN_PACK_PATTERNS) {
        if (pattern.re.test(content)) {
          return { tarball: "", error: `packed artifact contains ${pattern.label} in ${rel} — nothing was published` };
        }
      }
    }
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
  return { tarball, error: null };
}

/**
 * Publishes the exact verified tarball through the fleet vault-backed route
 * ONLY — `secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm
 * publish <tarball>`. The temp npmrc holds only the ${NODE_AUTH_TOKEN}
 * placeholder and lives OUTSIDE the package tree (mode 0600). Ambient
 * credentials are never used; when the secrets CLI or the vault key is
 * unavailable the release fails closed (release-review P1: ambient-credential
 * publishes and package-tree npmrc files are refused).
 */
function publishViaVault(info: RepoInfo, tarball: string): string | null {
  if (!binaryExists("secrets")) {
    return "refusing to release: secrets CLI not found — publish requires the vault-backed route (secrets exec hasna/npm/live/publish-token)";
  }
  const npmrcPath = join(tmpdir(), `.agency-release-${process.pid}.npmrc`);
  try {
    writeFileSync(npmrcPath, NPM_VULNERABILITY_EGRESS, { mode: 0o600 });
    // The explicit `undefined` DELETES any ambient NODE_AUTH_TOKEN from the
    // child env: the token may only reach npm through the vault-backed route
    // (secrets exec sets it itself). An empty overlay would leave the ambient
    // token in the child, violating the vault-only publish-path contract
    // (release-review P1: ambient credentials must never reach the publish
    // path).
    const result = spawnSafe(
      "secrets",
      ["exec", "hasna/npm/live/publish-token", "--as", "NODE_AUTH_TOKEN", "--", "npm", "publish", tarball, "--userconfig", npmrcPath, "--access", "public", "--ignore-scripts"],
      60000,
      { NODE_AUTH_TOKEN: undefined },
      info.dir,
    );
    if (result === null) {
      return `npm publish failed for ${tarball} — nothing was published`;
    }
    return null;
  } finally {
    try {
      unlinkSync(npmrcPath);
    } catch {
      /* temp npmrc cleanup is best-effort */
    }
  }
}

function releaseRepo(info: RepoInfo, reviewedSha: string | undefined): ReleaseResult {
  const newVersion = info.currentVersion;

  // Gate 0 — a release must be bound to a reviewed SHA. The operator passes
  // --reviewed-sha <sha>; it must equal the current HEAD, so the published
  // candidate is byte-for-byte the reviewed commit (release-review P1: the
  // published candidate must equal the reviewed candidate). The command
  // performs NO post-review mutation: no version bump, no commit, no push.
  if (!reviewedSha) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: --reviewed-sha <sha> is required (must equal the current HEAD of the reviewed candidate)",
    };
  }
  // Gate 0b — the package identity must match the reviewed receipt: the dir's
  // package.json must declare exactly @hasna/<name> and a semver version
  // (release-review P1: name/version/scope/registry are bound to the release).
  if (info.packageName !== `@hasna/${info.name}`) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: package.json declares ${info.packageName || "(missing name)"}, expected @hasna/${info.name} — the published identity must match the reviewed candidate`,
    };
  }
  if (!/^\d+\.\d+\.\d+/.test(info.currentVersion)) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: package version ${info.currentVersion} is not semver — the reviewed candidate must carry a concrete version`,
    };
  }
  const head = spawnSafe("git", ["rev-parse", "HEAD"], 10_000, {}, info.dir);
  if (head === null || head.trim() !== reviewedSha) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: HEAD (${head ? head.trim().slice(0, 12) : "unknown"}) does not match --reviewed-sha ${reviewedSha.slice(0, 12)} — the release must be bound to the reviewed commit`,
    };
  }

  // Gate 1 — refuse ANY dirty state: the tree must be exactly the reviewed
  // commit. Versioning happens BEFORE the review (changeset/version PR), so
  // the reviewed sha already carries the final version. A failed `git status`
  // invocation is a HARD failure, never a clean tree (release-review P1:
  // `null` must not fail open).
  const porcelain = spawnSafe("git", ["status", "--porcelain"], 10_000, {}, info.dir);
  if (porcelain === null) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: could not verify the worktree is clean (git status failed) — the reviewed candidate must be exactly HEAD",
    };
  }
  if (porcelain.trim().length > 0) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: worktree is not clean (${porcelain.split("\n")[0]}) — the reviewed candidate must be exactly HEAD`,
    };
  }

  // Gate 2 — the vault-backed publish route must be AVAILABLE before anything
  // is built or packed: when the secrets CLI is missing the release can never
  // succeed, so it fails closed immediately (release-review P1: ambient
  // credentials are never a fallback; failing early also avoids building and
  // packing a candidate that cannot be published).
  if (!binaryExists("secrets")) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: secrets CLI not found — publish requires the vault-backed route (secrets exec hasna/npm/live/publish-token)",
    };
  }

  // Gate 3 — build and pack the EXACT reviewed tree; the verified tarball is
  // the only artifact ever published (no prepack rebuild at publish time).
  const packed = packVerifiedTarball(info);
  if (packed.error !== null || packed.tarball === "") {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: packed.error ?? "pack failed" };
  }

  // Gate 4 — publish the exact tarball via the vault-backed route only.
  const publishError = publishViaVault(info, packed.tarball);
  if (publishError !== null) {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: publishError };
  }
  return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "published" };
}

export function registerReleaseCommand(program: Command): void {
  program
    .command("release [repo]")
    .description("Bump patch version, build, commit, publish a SHA-bound reviewed @hasna/* repo")
    .option("--dry-run", "Show what would be published without doing it")
    .option("--check", "Just show repos with unpushed changes")
    .option("--reviewed-sha <sha>", "Exact reviewed commit SHA the release must be bound to (required for real publishes)")
    .option("-d, --dir <path>", "Base directory containing open-* repos", process.cwd())
    .action((repo: string | undefined, opts) => {
      const baseDir = resolve(opts.dir);
      console.log(chalk.bold("agency release") + chalk.dim(` — scanning ${baseDir}\n`));
      const repoDirs = findOpenRepos(baseDir);
      if (repoDirs.length === 0) {
        console.log(chalk.yellow("  No open-* repos found in this directory."));
        return;
      }
      let infos: RepoInfo[] = [];
      for (const repoDir of repoDirs) {
        const info = getRepoInfo(join(baseDir, repoDir));
        if (info) infos.push(info);
      }
      // A repo whose git status could not be verified is NEVER treated as
      // clean: it is refused loudly in every mode (release-review P1).
      for (const info of infos) {
        if (info.gitStatusFailed) {
          console.log(chalk.red(`  ${info.name}: could not verify git status — refusing (the release candidate must be exactly the reviewed HEAD)`));
        }
      }
      if (repo) {
        const normalizedRepo = repo.replace(/^open-/, "");
        infos = infos.filter((i) => i.name === normalizedRepo || i.name === repo);
        if (infos.length === 0) {
          console.error(chalk.red(`  Repo not found: ${repo}`));
          console.log(chalk.dim(`  Available: ${repoDirs.map((d) => d.replace("open-", "")).join(", ")}`));
          process.exit(1);
        }
      }
      // Any SELECTED repo whose git status could not be verified makes the
      // whole invocation exit nonzero in every mode (--check, dry-run,
      // release): automation must never accept an unverifiable candidate as a
      // successful run (release-review P1: failed git status must fail the
      // exit status, not just print a refusal).
      const unverifiableSelected = infos.filter((i) => i.gitStatusFailed).length;
      if (opts.check) {
        console.log(chalk.bold(pad("Package", 22) + pad("Version", 12) + pad("Changes", 10) + pad("Unpushed", 10) + pad("Status", 14)));
        console.log(chalk.dim("─".repeat(68)));
        for (const info of infos) {
          const status = info.gitStatusFailed ? chalk.red("status failed") : info.needsRelease ? chalk.yellow("needs release") : chalk.green("clean");
          console.log(
            pad(info.name, 22) +
              pad(info.currentVersion, 12) +
              pad(info.hasChanges ? chalk.yellow("yes") : chalk.dim("no"), 10) +
              pad(info.unpushedCommits > 0 ? chalk.yellow(String(info.unpushedCommits)) : chalk.dim("0"), 10) +
              status,
          );
        }
        const needsRelease = infos.filter((i) => i.needsRelease).length;
        console.log(chalk.dim(`\n  ${infos.length} repos scanned, ${needsRelease} need release.`));
        if (unverifiableSelected > 0) {
          // The refusals above are the record; the exit status must not read
          // as a clean scan (release-review P1).
          process.exitCode = 1;
        }
        return;
      }
      // Release/dry-run selection: EVERY verified repo is a candidate. A
      // clean, pushed, reviewed candidate must be releasable — the previous
      // dirty-or-unpushed-only selection made the documented no-argument
      // release path unreachable: dirty candidates were refused by the gates
      // while clean candidates were never selected (release-review P1 @
      // 3f1611276). The per-repo gates in releaseRepo (HEAD == --reviewed-sha,
      // clean worktree, identity, file-set-bound pack scan) decide each
      // candidate's outcome.
      const verified = infos.filter((i) => !i.gitStatusFailed);
      let candidates = verified;
      if (verified.length === 0) {
        const unverifiable = infos.filter((i) => i.gitStatusFailed).length;
        if (unverifiable > 0) {
          // The refusals above are the record; do not print "all clean" next
          // to them (release-review P1: a failed status is never "clean"),
          // and exit nonzero so automation does not read a successful no-op.
          console.log(chalk.yellow(`  ${unverifiable} repo(s) could not be verified (git status failed); nothing released.`));
          process.exitCode = 1;
        } else {
          console.log(chalk.green("  All repos are clean. Nothing to release."));
        }
        return;
      }
      // Batch binding: one --reviewed-sha binds to the repo(s) whose HEAD
      // equals it — every repository has its own HEAD, so a single sha cannot
      // apply to all of them. Repos at other heads are skipped with a note,
      // never failed (release-review P1 @ 3f1611276); an invocation whose sha
      // matches no repo fails closed.
      if (!repo && opts.reviewedSha) {
        const sha = opts.reviewedSha as string;
        const atSha: RepoInfo[] = [];
        const others: RepoInfo[] = [];
        for (const info of verified) {
          const head = spawnSafe("git", ["rev-parse", "HEAD"], 10_000, {}, info.dir);
          if (head !== null && head.trim() === sha) atSha.push(info);
          else others.push(info);
        }
        for (const info of others) {
          console.log(chalk.dim(`  ${info.name}: HEAD is not --reviewed-sha ${sha.slice(0, 12)} — skipped`));
        }
        if (atSha.length === 0) {
          console.log(chalk.yellow(`  No repo is at --reviewed-sha ${sha.slice(0, 12)}; nothing released.`));
          process.exitCode = 1;
          return;
        }
        candidates = atSha;
      }
      if (opts.dryRun) {
        console.log(chalk.bold(`  Dry run — the following repos would be released at their reviewed SHA:\n`));
        console.log(chalk.bold(pad("Package", 22) + pad("Version", 12) + pad("Changes", 10)));
        console.log(chalk.dim("─".repeat(44)));
        for (const info of candidates) {
          console.log(
            pad(info.name, 22) +
              pad(info.currentVersion, 12) +
              pad(
                [
                  info.hasChanges ? "uncommitted" : "",
                  info.unpushedCommits > 0 ? `${info.unpushedCommits} unpushed` : "",
                ].filter(Boolean).join(", ") || "clean",
                10,
              ),
          );
        }
        console.log(chalk.dim(`\n  ${candidates.length} repo(s) would be released.`));
        console.log(chalk.dim("  Run with --reviewed-sha <sha> to publish the exact reviewed commit."));
        if (unverifiableSelected > 0) {
          // The refusals above are the record; the dry run must not exit 0 as
          // if every candidate were verifiable (release-review P1).
          process.exitCode = 1;
        }
        return;
      }
      console.log(chalk.dim(`  Releasing ${candidates.length} repo(s)...\n`));
      const results: ReleaseResult[] = [];
      for (const info of candidates) {
        process.stdout.write(chalk.dim(`  ${info.name} ${info.currentVersion} ... `));
        const result = releaseRepo(info, opts.reviewedSha as string | undefined);
        results.push(result);
        if (result.status === "published") {
          console.log(chalk.green("published"));
        } else if (result.status === "skipped") {
          console.log(chalk.dim("skipped"));
        } else {
          console.log(chalk.red(`failed: ${result.error || "unknown"}`));
        }
      }
      console.log(chalk.bold(`\n  Release summary:\n`));
      console.log(chalk.bold(pad("Package", 22) + pad("Old", 12) + pad("New", 12) + pad("Status", 14)));
      console.log(chalk.dim("─".repeat(60)));
      for (const result of results) {
        const statusStr =
          result.status === "published"
            ? chalk.green("published")
            : result.status === "skipped"
              ? chalk.dim("skipped")
              : chalk.red("failed");
        console.log(pad(result.name, 22) + pad(result.oldVersion, 12) + pad(result.newVersion, 12) + statusStr);
      }
      const published = results.filter((r) => r.status === "published").length;
      const failed = results.filter((r) => r.status === "failed").length;
      console.log(chalk.dim(`\n  ${published} published, ${failed} failed, ${results.length - published - failed} skipped.`));
      if (failed > 0) {
        // Release failures must exit nonzero (release-review P1: release
        // failures exit successfully).
        process.exitCode = 1;
      }
      if (unverifiableSelected > 0) {
        // A selected repo whose git status could not be verified was refused;
        // the invocation must not exit 0 as if every candidate had been
        // verifiable (release-review P1: failed git status must fail the exit
        // status).
        process.exitCode = 1;
      }
    });
}
