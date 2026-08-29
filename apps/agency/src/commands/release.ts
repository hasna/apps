import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { execSafe, pad } from "../utils.js";

interface RepoInfo {
  name: string;
  dir: string;
  packageName: string;
  currentVersion: string;
  hasChanges: boolean;
  unpushedCommits: number;
  needsRelease: boolean;
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
    const name = pkg.name?.replace("@hasna/", "") || "";
    const currentVersion = pkg.version || "0.0.0";
    const porcelain = execSafe(`cd "${dir}" && git status --porcelain 2>&1`, 10_000);
    const hasChanges = !!porcelain && porcelain.length > 0;
    let unpushedCommits = 0;
    const revCount = execSafe(`cd "${dir}" && git rev-list --count @{u}..HEAD 2>&1`, 10_000);
    if (revCount !== null && !revCount.includes("fatal") && !revCount.includes("error")) {
      unpushedCommits = parseInt(revCount, 10) || 0;
    }
    const needsRelease = hasChanges || unpushedCommits > 0;
    return { name, dir, packageName: pkg.name || "", currentVersion, hasChanges, unpushedCommits, needsRelease };
  } catch {
    return null;
  }
}

/** True only when a vault-backed publish token is present in the environment. */
export function publishTokenAvailable(): boolean {
  return typeof process.env.NODE_AUTH_TOKEN === "string" && process.env.NODE_AUTH_TOKEN.length > 0;
}

function bumpPatch(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return `${version}.1`;
  const major = parts[0] || "0";
  const minor = parts[1] || "0";
  const patch = parseInt(parts[2] || "0", 10);
  return `${major}.${minor}.${patch + 1}`;
}

function releaseRepo(info: RepoInfo): ReleaseResult {
  const newVersion = bumpPatch(info.currentVersion);

  // Gate 1 — refuse a dirty worktree. The release command only ever stages its
  // own version bump (package.json); anything else present must be reviewed and
  // landed separately, or it would be shipped unreviewed under this release.
  const porcelain = execSafe(`cd "${info.dir}" && git status --porcelain 2>&1`, 10_000);
  if (porcelain !== null && porcelain.trim().length > 0) {
    const other = porcelain
      .split("\n")
      .map((l) => l.slice(3))
      .filter((f) => f !== "package.json");
    if (other.length > 0) {
      return {
        name: info.name,
        oldVersion: info.currentVersion,
        newVersion,
        status: "failed",
        error: `refusing to release: uncommitted changes outside package.json: ${other.slice(0, 5).join(", ")}`,
      };
    }
  }

  // Gate 2 — publishing requires a vault-backed token in the environment
  // (NODE_AUTH_TOKEN, per the hasna/apps publish law) paired with a temp npmrc
  // holding only the placeholder. Ambient ~/.npmrc credentials are refused.
  // Checked BEFORE any mutation: no version bump, commit, or push without a
  // publish token present.
  if (!publishTokenAvailable()) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: NODE_AUTH_TOKEN is not set — publish with a vault-backed token (secrets exec ... --as NODE_AUTH_TOKEN -- npm publish --userconfig <tmp npmrc>)",
    };
  }

  const pkgPath = join(info.dir, "package.json");
  const originalPkg = readFileSync(pkgPath, "utf8");
  try {
    const pkg = JSON.parse(originalPkg);
    pkg.version = newVersion;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch (e) {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: `Failed to bump version: ${e}` };
  }

  // Gate 3 — a failed build must abort before anything is committed or pushed.
  // Publishable code must be exactly the reviewed, committed source. The
  // version bump is reverted so a failed release leaves the repo untouched.
  const buildResult = execSafe(`cd "${info.dir}" && bun run build 2>&1`, 60000);
  if (buildResult === null) {
    writeFileSync(pkgPath, originalPkg);
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: "build failed — nothing was committed or published" };
  }

  // Gate 4 — stage ONLY the bumped package.json; never `git add -A`.
  const commitResult = execSafe(`cd "${info.dir}" && git add package.json && git commit -m "chore: release v${newVersion}" 2>&1`, 15000);
  if (commitResult === null) {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: "git commit failed" };
  }
  const pushResult = execSafe(`cd "${info.dir}" && git push 2>&1`, 30000);
  if (pushResult === null) {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: "git push failed" };
  }

  // Gate 5 — publish through a temp npmrc holding only the ${NODE_AUTH_TOKEN}
  // placeholder (the vault token is present, verified in Gate 2).
  const npmrcPath = join(info.dir, ".agency-release-npmrc");
  try {
    writeFileSync(npmrcPath, "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n", { mode: 0o600 });
    const publishResult = execSafe(`cd "${info.dir}" && npm publish --userconfig "${npmrcPath}" --access public 2>&1`, 30000);
    if (publishResult === null) {
      return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: "npm publish failed" };
    }
  } finally {
    try {
      unlinkSync(npmrcPath);
    } catch {
      /* temp npmrc cleanup is best-effort */
    }
  }
  return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "published" };
}

export function registerReleaseCommand(program: Command): void {
  program
    .command("release [repo]")
    .description("Bump patch version, build, commit, push, and publish @hasna/* repos")
    .option("--dry-run", "Show what would be published without doing it")
    .option("--check", "Just show repos with unpushed changes")
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
      if (repo) {
        const normalizedRepo = repo.replace(/^open-/, "");
        infos = infos.filter((i) => i.name === normalizedRepo || i.name === repo);
        if (infos.length === 0) {
          console.error(chalk.red(`  Repo not found: ${repo}`));
          console.log(chalk.dim(`  Available: ${repoDirs.map((d) => d.replace("open-", "")).join(", ")}`));
          process.exit(1);
        }
      }
      if (opts.check) {
        console.log(chalk.bold(pad("Package", 22) + pad("Version", 12) + pad("Changes", 10) + pad("Unpushed", 10) + pad("Status", 14)));
        console.log(chalk.dim("─".repeat(68)));
        for (const info of infos) {
          const status = info.needsRelease ? chalk.yellow("needs release") : chalk.green("clean");
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
        return;
      }
      const releasable = repo ? infos : infos.filter((i) => i.needsRelease);
      if (releasable.length === 0) {
        console.log(chalk.green("  All repos are clean. Nothing to release."));
        return;
      }
      if (opts.dryRun) {
        console.log(chalk.bold(`  Dry run — the following repos would be released:\n`));
        console.log(chalk.bold(pad("Package", 22) + pad("Current", 12) + pad("New", 12) + pad("Changes", 10)));
        console.log(chalk.dim("─".repeat(56)));
        for (const info of releasable) {
          console.log(
            pad(info.name, 22) +
              pad(info.currentVersion, 12) +
              pad(bumpPatch(info.currentVersion), 12) +
              pad(
                [
                  info.hasChanges ? "uncommitted" : "",
                  info.unpushedCommits > 0 ? `${info.unpushedCommits} unpushed` : "",
                ].filter(Boolean).join(", ") || "force",
                10,
              ),
          );
        }
        console.log(chalk.dim(`\n  ${releasable.length} repo(s) would be released.`));
        console.log(chalk.dim("  Run without --dry-run to execute."));
        return;
      }
      console.log(chalk.dim(`  Releasing ${releasable.length} repo(s)...\n`));
      const results: ReleaseResult[] = [];
      for (const info of releasable) {
        process.stdout.write(chalk.dim(`  ${info.name} ${info.currentVersion} → ${bumpPatch(info.currentVersion)} ... `));
        const result = releaseRepo(info);
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
    });
}
