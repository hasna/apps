/** Local execution reads a verified immutable object; it never resolves the mutable authoring corpus. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import type { SkillBundleEntry } from "./skill-bundle.js";
import { exactProfileSelection, readSelectedEntries, resolveSelectionContext, type SelectionResolverOptions } from "./selection-resolver.js";
import { readCachedSelection, selectionCacheRoot, SkillSelectionError } from "./selection-cache.js";
import { parseSkillFrontmatter } from "./skill-validation.js";
import { SkillEntryPaths } from "./skill-entry-path.js";

export interface ResolvedSelectedRun {
  selection: ResolvedSkillSelection;
  kind: "instruction" | "executable";
  entries: SkillBundleEntry[];
  manifest: Record<string, any>;
  packageJson: Record<string, any>;
  cacheDir: string;
}
function jsonEntry(entries: SkillBundleEntry[], path: string): Record<string, any> {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) return {};
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new SkillSelectionError("INVALID_SKILL_MANIFEST", "The selected skill has an invalid execution manifest."); }
}
function describeEntries(entries: SkillBundleEntry[]) {
  const manifest = jsonEntry(entries, "skill.json"), packageJson = jsonEntry(entries, "package.json");
  const docs = entries.find((entry) => entry.path === "SKILL.md");
  const frontmatter = docs ? parseSkillFrontmatter(new TextDecoder().decode(docs.bytes)) : null;
  const kind = frontmatter?.kind === "instruction" || manifest.kind === "instruction" || packageJson.skills?.kind === "instruction" ? "instruction" as const : "executable" as const;
  return { kind, manifest, packageJson };
}
export async function resolveSelectedRun(spec: string, profileId: string, options: SelectionResolverOptions = {}): Promise<ResolvedSelectedRun> {
  const context = await resolveSelectionContext(profileId, options);
  const selection = exactProfileSelection(spec, context.receipt.profile);
  const entries = await readSelectedEntries(selection, context, options);
  return { selection, entries, ...describeEntries(entries), cacheDir: selectionCacheRoot(options) };
}
export interface SelectedLocalRunOptions {
  args?: string[];
  input?: unknown;
  cwd?: string;
  timeoutMs?: number;
  /** Only explicitly supplied environment values are available to declared secret references. */
  env?: Record<string, string>;
}
export async function executeSelectedLocal(selected: ResolvedSelectedRun, options: SelectedLocalRunOptions = {}) {
  // Re-read and verify so a caller cannot mutate returned entries between resolution and execution.
  const entries = await readCachedSelection(selected.selection, { cacheDir: selected.cacheDir });
  if (!entries) throw new SkillSelectionError("CACHED_BUNDLE_MISSING", "The selected local execution bundle is not cached.");
  const { kind, manifest, packageJson } = describeEntries(entries);
  if (kind === "instruction") throw new SkillSelectionError("INSTRUCTION_SKILL", "This selected skill contains instructions. Use skills load instead of skills run.");
  const runtime = manifest.runtime ?? {};
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) throw new SkillSelectionError("INVALID_SKILL_MANIFEST", "The selected runtime declaration is invalid.");
  if ((runtime.sandbox !== undefined && runtime.sandbox !== "full") || runtime.needs_network === false) {
    throw new SkillSelectionError("LOCAL_SANDBOX_REQUIRED", "This selected version requires filesystem or network isolation. Use a cloud execution target that enforces its runtime policy.");
  }
  if (["hosted", "remote"].includes(packageJson.skills?.runtime) || ["private-hosted", "remote"].includes(packageJson.skills?.source)) {
    throw new SkillSelectionError("CLOUD_TARGET_REQUIRED", "This selected skill is server-owned and requires the cloud target.");
  }
  if ([packageJson.dependencies, packageJson.optionalDependencies, packageJson.peerDependencies].some((deps) => deps && Object.keys(deps).length)) {
    throw new SkillSelectionError("LOCAL_DEPENDENCY_BUILD_REQUIRED", "This selected version needs dependency preparation. Publish a self-contained executable bundle or use the cloud target; local runs do not install packages or run lifecycle scripts.");
  }
  const runtimeName = runtime.runtime ?? "bun";
  if (!["bun", "node", "python3"].includes(runtimeName)) throw new SkillSelectionError("LOCAL_RUNTIME_UNAVAILABLE", "The selected local runtime is unsupported.");
  const executable = runtimeName === "bun" ? process.execPath : Bun.which(runtimeName);
  if (!executable) throw new SkillSelectionError("LOCAL_RUNTIME_UNAVAILABLE", "The selected runtime is not installed on this station.");
  const declaredEntry = runtime.entrypoint ?? (typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin && typeof packageJson.bin === "object" ? Object.values(packageJson.bin)[0] : undefined);
  if (typeof declaredEntry !== "string" || !entries.some((entry) => entry.path === declaredEntry)) throw new SkillSelectionError("LOCAL_ENTRYPOINT_MISSING", "The selected bundle must declare a regular-file entrypoint in its runtime manifest or package bin.");
  const args = options.args ?? [];
  if (args.length > 128 || args.some((arg) => typeof arg !== "string" || arg.length > 16_384 || arg.includes("\0"))) throw new SkillSelectionError("INVALID_RUN_INPUT", "Local skill arguments exceed their limits.");
  const input = JSON.stringify(options.input ?? {});
  if (Buffer.byteLength(input) > 1024 * 1024) throw new SkillSelectionError("INVALID_RUN_INPUT", "Local skill JSON input exceeds one MiB.");
  const declaredTimeout = runtime.timeout === undefined ? 60_000 : runtime.timeout * 1000;
  const timeoutMs = options.timeoutMs ?? declaredTimeout;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 || !Number.isFinite(declaredTimeout) || declaredTimeout <= 0 || timeoutMs > declaredTimeout) throw new SkillSelectionError("INVALID_RUN_TIMEOUT", "Local skill timeout must be positive, at most five minutes and no longer than the selected runtime allows.");
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"]) if (process.env[key]) env[key] = process.env[key]!;
  if (runtime.env !== undefined && (!Array.isArray(runtime.env) || runtime.env.some((name: unknown) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)))) throw new SkillSelectionError("INVALID_SKILL_MANIFEST", "Runtime environment references are invalid.");
  for (const name of runtime.env ?? []) {
    const value = options.env?.[name];
    if (value === undefined) throw new SkillSelectionError("LOCAL_ENV_REQUIRED", `The selected runtime requires an explicit value for ${name}; ambient credentials are not inherited.`);
    env[name] = value;
  }
  // Explicit caller environment is not a way to override runtime internals or inject undeclared credentials.
  const runDirectory = mkdtempSync(join(tmpdir(), "skills-execution-"));
  const paths = new SkillEntryPaths();
  for (const entry of entries) {
    paths.add(entry.path, 100, () => { throw new SkillSelectionError("INVALID_BUNDLE_PATH", "The execution bundle contains an unsafe path."); }, () => { throw new SkillSelectionError("INVALID_BUNDLE_PATH", "The execution bundle path exceeds its limit."); });
    const destination = join(runDirectory, entry.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, entry.bytes, { flag: "wx", mode: entry.mode & 0o777 });
  }
  env.SKILLS_INPUT_JSON = input;
  env.SKILLS_WORKSPACE_DIR = resolve(options.cwd ?? process.cwd());
  env.SKILLS_RUN_DIR = runDirectory;
  if (runtime.version) {
    const version = await subprocess([executable, "--version"], runDirectory, env, "", Math.min(timeoutMs, 5000));
    const actual = version.stdout.trim().replace(/^v/, "").replace(/^Python /, "");
    if (version.exitCode !== 0 || actual !== runtime.version) throw new SkillSelectionError("LOCAL_RUNTIME_VERSION_MISMATCH", "The installed runtime version differs from the version selected by the skill.");
  }
  const result = await subprocess([executable, join(runDirectory, declaredEntry), ...args], runDirectory, env, input, timeoutMs);
  const receipt = { selection: selected.selection, target: "local" as const, runtime: runtimeName, inputDigest: `sha256:${createHash("sha256").update(input).digest("hex")}`, runDirectory, ...result };
  writeFileSync(join(runDirectory, ".execution-receipt.json"), JSON.stringify({ ...receipt, stdout: undefined, stderr: undefined }), { mode: 0o600 });
  return receipt;
}
async function subprocess(command: string[], cwd: string, env: Record<string, string>, input: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let outputBytes = 0, error: string | undefined, ended = false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const kill = () => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const timer = setTimeout(() => { error = "LOCAL_RUN_TIMEOUT"; kill(); }, timeoutMs);
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) { error = "LOCAL_RUN_OUTPUT_LIMIT"; kill(); return; }
      target.push(chunk);
    };
    child.stdout.on("data", capture(stdout)); child.stderr.on("data", capture(stderr));
    const finish = (code: number) => {
      if (ended) return; ended = true; clearTimeout(timer);
      resolveResult({ exitCode: error === "LOCAL_RUN_TIMEOUT" ? 124 : error ? 1 : code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), ...(error ? { error } : {}) });
    };
    child.on("error", () => { error = "LOCAL_RUNTIME_START_FAILED"; finish(127); });
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
