import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

export const HARNESS_DISCOVERY_SCHEMA = "hasna.instructions.harness-discovery/v1" as const;
export const DISCOVERABLE_HARNESSES = ["claude", "codex", "opencode", "sumi"] as const;
export type DiscoverableHarness = typeof DISCOVERABLE_HARNESSES[number];

export interface HarnessPathObservation {
  /** Lexical path is retained: resolving a symlink is not permission to retarget it. */
  path: string;
  state: "present" | "missing" | "unreadable" | "dangling-symlink";
  realPath: string | null;
  symlink: boolean;
  viaSymlink: boolean;
  type: "file" | "directory" | "other" | null;
}

export interface HarnessDiscoveryOptions {
  /** Explicit owner home wins over HOME, USERPROFILE, and the OS home. */
  ownerHome?: string;
  env?: NodeJS.ProcessEnv;
  overrides?: Partial<Record<DiscoverableHarness, { executable?: string; configDir?: string }>>;
  /** Separately scoped repository; never becomes the global config directory. */
  projectRoot?: string;
}

export interface HarnessDiscoveryEntry {
  tool: DiscoverableHarness;
  status: "executable-found" | "absent";
  executable: HarnessPathObservation | null;
  executableSource: "override" | "PATH" | null;
  versionEvidence: "not-probed";
  config: (HarnessPathObservation & { source: string }) | null;
  globalPrompt: HarnessPathObservation | null;
  projectPrompt: HarnessPathObservation | null;
  /** Potential native override files; managed prompt paths above are candidates. */
  promptOverrides: HarnessPathObservation[];
  /** A global prompt symlink may actually carry project rules: preserve/review it. */
  scopeReviewRequired: boolean;
  diagnostics: string[];
}

export interface HarnessDiscoveryResult {
  schema: typeof HARNESS_DISCOVERY_SCHEMA;
  ownerHome: HarnessPathObservation;
  projectRoot: HarnessPathObservation | null;
  tools: HarnessDiscoveryEntry[];
  /** Declared inputs to existing template renderers, not ambient shell expansion. */
  templateVariables: Record<string, string>;
}

function pathInput(value: string, home?: string): string {
  if (!value || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Harness paths must be nonempty and contain no surrounding whitespace or control characters.");
  if (value.split("/").some((segment) => segment === "." || segment === "..")) throw new Error("Harness paths must not contain dot segments; normalizing them can change a symlink destination.");
  let path = value;
  if (home) {
    for (const prefix of ["~", "{{HOME}}", "{{HOME_DIR}}", "${HOME}"]) {
      if (path === prefix) path = home;
      else if (path.startsWith(`${prefix}/`)) path = join(home, path.slice(prefix.length + 1));
    }
  }
  if (!isAbsolute(path)) throw new Error("Harness paths must be absolute or explicitly relative to the owner home (~/ or {{HOME_DIR}}/).");
  return resolve(path);
}

function observe(path: string): HarnessPathObservation {
  let symlink = false;
  let viaSymlink = false;
  // Inspect parent links even when the leaf does not exist yet. A missing
  // prompt below a linked directory still needs the same scope review.
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    try { if (lstatSync(parent).isSymbolicLink()) { viaSymlink = true; break; } } catch { /* Leaf state below reports errors. */ }
  }
  try {
    symlink = lstatSync(path).isSymbolicLink();
    const stat = statSync(path);
    return { path, state: "present", realPath: realpathSync(path), symlink, viaSymlink: viaSymlink || symlink, type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other" };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { path, state: missing ? symlink ? "dangling-symlink" : "missing" : "unreadable", realPath: null, symlink, viaSymlink: viaSymlink || symlink, type: null };
  }
}

function executableAt(path: string): HarnessPathObservation | null {
  const observation = observe(path);
  if (observation.type !== "file") return null;
  try { accessSync(path, constants.X_OK); return observation; } catch { return null; }
}

function configSelection(tool: DiscoverableHarness, home: string, env: NodeJS.ProcessEnv, override?: string): { path: string; source: string } | null {
  if (override !== undefined) return { path: pathInput(override, home), source: "override" };
  const key = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", opencode: "OPENCODE_CONFIG_DIR", sumi: "SUMI_CONFIG_DIR" }[tool];
  // Native environment values are not shell/template expressions. Some runtimes
  // accept cwd-relative paths and others expand '~'; without running that exact
  // runtime only an absolute, unambiguous selector can be inventoried faithfully.
  const nativePath = (value: string, selector: string): string => {
    try { return pathInput(value); }
    catch { throw new Error(`${selector} is present but is not an unambiguous absolute native path; supply the reviewed runtime path explicitly.`); }
  };
  // Codex treats only the empty string as absent (whitespace is a real path).
  if (env[key] !== undefined && !(tool === "codex" && env[key] === "")) return { path: nativePath(env[key]!, key), source: key };
  if (tool === "claude" || tool === "codex") return { path: join(home, `.${tool}`), source: "native-default" };
  if (env.XDG_CONFIG_HOME !== undefined) return { path: join(nativePath(env.XDG_CONFIG_HOME, "XDG_CONFIG_HOME"), tool), source: "XDG_CONFIG_HOME" };
  if (tool === "sumi") {
    if (env.SUMI_HOME !== undefined) return { path: join(nativePath(env.SUMI_HOME, "SUMI_HOME"), "config"), source: "SUMI_HOME" };
    // Sumi launchers can adopt a previous home. Only the actual runtime can
    // resolve that choice; discovery must not trigger its migration or guess it.
    return null;
  }
  return { path: join(home, ".config", tool), source: "native-default" };
}

/** Read-only filesystem inventory. Does not run binaries, load credentials,
 * import application stores, read prompt bodies, or modify provider homes. */
export function discoverHarnesses(options: HarnessDiscoveryOptions = {}): HarnessDiscoveryResult {
  const env = options.env ?? process.env;
  const home = pathInput(options.ownerHome ?? env.HOME ?? env.USERPROFILE ?? homedir());
  const project = options.projectRoot === undefined ? null : observe(pathInput(options.projectRoot, home));
  const variables: Record<string, string> = { HOME_DIR: home };
  if (project) variables.PROJECT_ROOT = project.path;
  const tools = DISCOVERABLE_HARNESSES.map((tool): HarnessDiscoveryEntry => {
    const diagnostics: string[] = [];
    const override = options.overrides?.[tool];
    let executable: HarnessPathObservation | null = null;
    let executableSource: HarnessDiscoveryEntry["executableSource"] = null;
    if (override?.executable !== undefined) {
      executable = executableAt(pathInput(override.executable, home));
      executableSource = "override";
      if (!executable) diagnostics.push("Explicit executable is missing, unreadable, not a file, or not executable; PATH fallback is disabled.");
    } else {
      // Empty/relative PATH entries depend on cwd and are not portable fleet inputs.
      for (const directory of (env.PATH ?? "").split(delimiter)) {
        if (!isAbsolute(directory)) {
          const warning = "Relative or empty PATH entries were ignored; this is an absolute-path candidate inventory, not proof of the launcher's selected executable.";
          if (!diagnostics.includes(warning)) diagnostics.push(warning);
          continue;
        }
        let validated: string;
        try { validated = pathInput(directory); }
        catch { diagnostics.push("An ambiguous PATH directory was ignored; use an explicit executable override after reviewing its native path."); continue; }
        executable = executableAt(join(validated, tool));
        if (executable) { executableSource = "PATH"; break; }
      }
    }
    let selected: ReturnType<typeof configSelection> = null;
    let configError = false;
    try { selected = configSelection(tool, home, env, override?.configDir); }
    catch (error) {
      if (override?.configDir !== undefined) throw error;
      configError = true;
      diagnostics.push(`Config root unresolved: ${(error as Error).message}`);
    }
    const config = selected ? { ...observe(selected.path), source: selected.source } : null;
    const filename = tool === "claude" ? "CLAUDE.md" : "AGENTS.md";
    const globalPrompt = config ? observe(join(config.path, filename)) : null;
    const promptOverrides = tool === "codex"
      ? [...new Set([config?.path, project?.path].filter((path): path is string => !!path))].map((path) => observe(join(path, "AGENTS.override.md")))
      : [];
    if (!config && !configError) diagnostics.push("Config root unresolved: supply the actual `sumi debug paths config` result as a configDir override; no runtime or migration was invoked.");
    if (executable) {
      variables[`${tool.toUpperCase()}_EXECUTABLE`] = executable.path;
      if (config) variables[`${tool.toUpperCase()}_CONFIG_DIR`] = config.path;
    }
    const linkedGlobal = !!globalPrompt?.viaSymlink || !!config?.viaSymlink;
    const hasOverride = promptOverrides.some((path) => path.state !== "missing" || path.viaSymlink);
    const scopeReviewRequired = linkedGlobal || hasOverride;
    if (linkedGlobal) diagnostics.push("Global config or prompt resolves through a symlink; preserve its lexical path and review the destination scope before planning writes.");
    if (hasOverride) diagnostics.push("A Codex AGENTS.override.md candidate may take precedence; review its native loader behavior and scope before applying AGENTS.md.");
    return { tool, status: executable ? "executable-found" : "absent", executable, executableSource, versionEvidence: "not-probed", config, globalPrompt, projectPrompt: project ? observe(join(project.path, filename)) : null, promptOverrides, scopeReviewRequired, diagnostics };
  });
  return { schema: HARNESS_DISCOVERY_SCHEMA, ownerHome: observe(home), projectRoot: project, tools, templateVariables: variables };
}
