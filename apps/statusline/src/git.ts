/** Minimal git helpers — every call degrades to null outside a repo. */

function run(cwd: string, args: string[]): string | null {
  try {
    const proc = Bun.spawnSync(["git", "-c", "gc.auto=0", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (proc.exitCode !== 0) return null;
    const out = proc.stdout.toString().trim();
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function gitRoot(cwd: string): string | null {
  return run(cwd, ["rev-parse", "--show-toplevel"]);
}

export function gitBranch(cwd: string): string | null {
  return run(cwd, ["branch", "--show-current"]);
}

export function gitProjectName(cwd: string): string | null {
  const root = gitRoot(cwd);
  if (!root) return null;
  const remote = run(root, ["config", "--get", "remote.origin.url"]);
  if (remote) return remote.replace(/\.git$/, "").split("/").pop() || null;
  return root.split("/").pop() || null;
}

export function lastCommitEpoch(cwd: string): number | null {
  const out = run(cwd, ["log", "-1", "--format=%ct"]);
  if (!out) return null;
  const ts = Number(out);
  return Number.isFinite(ts) ? ts : null;
}

export function trackedLineCount(cwd: string): number | null {
  const root = gitRoot(cwd);
  if (!root) return null;
  try {
    const proc = Bun.spawnSync(
      ["bash", "-c", "git -c gc.auto=0 ls-files -z | xargs -0 wc -l 2>/dev/null | awk 'END {print $1+0}'"],
      { cwd: root, stdout: "pipe", stderr: "ignore" },
    );
    if (proc.exitCode !== 0) return null;
    const n = Number(proc.stdout.toString().trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
