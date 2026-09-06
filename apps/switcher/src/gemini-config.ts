import { readFile, writeFile, lstat, readdir, symlink, realpath } from "node:fs/promises";
import { join, dirname, resolve, isAbsolute, relative, sep } from "node:path";
import { homedir } from "node:os";
import { parseTree, getNodeValue, type ParseError, type Node } from "jsonc-parser";
import { privateDirectory } from "./runtime";
import { geminiPolicyArguments } from "./harness-arguments";
import type { HarnessLaunchInput, PreparedLaunch } from "./harness-types";

type Settings = Record<string, any>;
// DEFAULT_MODEL_CONFIGS.modelDefinitions in the pinned official 0.58.0 bundle.
// Empty objects would retain visible native defaults through recursive merge.
const nativeModels = ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools", "gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemma-4-31b-it", "gemma-4-26b-a4b-it", "auto", "pro", "flash", "flash-lite", "auto-gemini-3", "auto-gemini-2.5"];
const object = (value: unknown): value is Settings => !!value && typeof value === "object" && !Array.isArray(value);
async function regular(path: string, limit = 2 * 1024 * 1024): Promise<boolean> {
  try { const stat = await lstat(path); if (!stat.isFile() || stat.size > limit) throw new Error("unsupported"); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw new Error(`Gemini configuration must be a readable regular file smaller than ${limit} bytes: ${path}`); }
}
async function settings(path: string): Promise<Settings> {
  if (!await regular(path)) return {};
  const errors: ParseError[] = [], tree = parseTree(await readFile(path, "utf8"), errors, {allowTrailingComma: true});
  const unique = (node: Node): boolean => {
    if (node.type === "object") { const keys = node.children!.map(property => property.children![0].value); if (new Set(keys).size !== keys.length) return false; }
    return (node.children ?? []).every(unique);
  };
  if (!tree || errors.length || tree.type !== "object" || !unique(tree)) throw new Error(`Gemini settings must be an unambiguous JSONC object: ${path}`);
  return getNodeValue(tree);
}
function check(value: Settings, path: string): void {
  if (value.modelConfigs !== undefined && (!object(value.modelConfigs) || Object.keys(value.modelConfigs).length))
    throw new Error(`Gemini modelConfigs in ${path} can override the selected model or endpoint. Remove these native model overrides for a Switcher launch.`);
  const inspect = (node: unknown): void => {
    if (!object(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (["modelConfig", "modelConfigKey", "httpOptions"].includes(key)) throw new Error(`Gemini custom agent/model transport settings conflict with the launch profile: ${path}`);
      inspect(child);
    }
  };
  inspect(value.agents);
  const enforced = value.security?.auth?.enforcedType;
  if (enforced !== undefined && enforced !== "gemini-api-key") throw new Error("Gemini native authentication policy does not permit the selected API-key provider.");
  const names = value.context?.fileName;
  if (names !== undefined && (typeof names !== "string" && !Array.isArray(names) || [names].flat().some(name => typeof name !== "string" || !name.toLowerCase().endsWith(".md") || name.includes("/") || name.includes("\\")))) throw new Error("Gemini context filenames must be ordinary Markdown filenames for an isolated launch.");
}
function originalPaths(value: Settings, home: string): Settings {
  const result = structuredClone(value);
  // Native resolvePath uses GEMINI_CLI_HOME for these policy locations. Keep
  // administrative/user policy paths anchored to their original native home.
  for (const key of ["policyPaths", "adminPolicyPaths"]) if (Array.isArray(result[key])) result[key] = result[key].map((path: unknown) => typeof path === "string" && (path === "~" || path.startsWith("~/")) ? home + path.slice(1) : path);
  return result;
}
export async function validateGeminiConfiguration(cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const home = env.GEMINI_CLI_HOME ?? env.HOME ?? homedir();
  if (!isAbsolute(home)) throw new Error("Gemini requires an absolute native home.");
  const systemPath = env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? (process.platform === "darwin" ? "/Library/Application Support/GeminiCli/settings.json" : process.platform === "win32" ? "C:\\ProgramData\\gemini-cli\\settings.json" : "/etc/gemini-cli/settings.json");
  const defaultsPath = env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ?? join(dirname(systemPath), "system-defaults.json");
  const paths = [defaultsPath, join(home, ".gemini", "settings.json"), join(resolve(cwd), ".gemini", "settings.json"), systemPath];
  const values = [];
  for (const path of paths) { const value = await settings(path); check(value, path); values.push(value); }
  for (const key of ["policyPaths", "adminPolicyPaths"]) if (values[2][key]?.some?.((path: unknown) => typeof path === "string" && (path === "~" || path.startsWith("~/")))) throw new Error("Gemini project policy paths using ~ must use an absolute path so workspace trust remains authoritative under an isolated native home.");
  const contextNames = [...new Set(["GEMINI.md", ...values.flatMap(value => [value.context?.fileName ?? []].flat())])] as string[];
  return {home, defaults: originalPaths(values[0], home), user: originalPaths(values[1], home), system: originalPaths(values[3], home), contextNames, trustPath: env.GEMINI_CLI_TRUSTED_FOLDERS_PATH ?? join(home, ".gemini", "trustedFolders.json")};
}
async function snapshotFile(source: string, destination: string): Promise<void> {
  if (await regular(source)) await writeFile(destination, await readFile(source), {mode: 0o600, flag: "wx"});
}
async function snapshotPolicies(source: string, destination: string): Promise<void> {
  let entries;
  try { const stat = await lstat(source); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsupported Gemini policy directory"); entries = await readdir(source, {withFileTypes: true}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  await privateDirectory(destination);
  if (entries.length > 200) throw new Error("Gemini user policy directory exceeds the snapshot limit.");
  for (const entry of entries) {
    // Native readPolicyFiles loads immediate regular .toml files only.
    if (entry.name.endsWith(".toml")) await snapshotFile(join(source, entry.name), join(destination, entry.name));
  }
}
async function snapshotContext(sourceDir: string, destinationDir: string, names: string[]): Promise<void> {
  // Match pinned native findImports/findCodeRegions syntax. Preserve its own
  // depth, cycle and import-format handling by rewriting paths, not flattening.
  const root = await realpath(sourceDir), files = new Map<string, string>();
  const importsDir = join(destinationDir, ".switcher-context");
  let bytes = 0;
  const copy = async (source: string, destination: string): Promise<void> => {
    if (files.has(source)) return;
    if (files.size >= 200) throw new Error("Gemini global context exceeds 200 imported files.");
    files.set(source, destination);
    if (!await regular(source)) throw new Error(`Gemini global context import is missing: ${source}`);
    const text = await readFile(source, "utf8"); bytes += Buffer.byteLength(text);
    if (bytes > 8 * 1024 * 1024) throw new Error("Gemini global context exceeds 8 MiB.");
    const code = [...text.matchAll(/(`+)([\s\S]*?)\1/g)].map(match => [match.index!, match.index! + match[0].length]);
    let output = "", last = 0;
    for (const match of text.matchAll(/(^|[ \t\r\n])@([.\/A-Za-z][^ \t\r\n]*)/g)) {
      const start = match.index! + match[1].length, end = start + match[2].length + 1;
      if (code.some(([a, b]) => start >= a && start < b)) continue;
      const imported = resolve(dirname(source), match[2]), actual = await realpath(imported).catch(() => imported), within = relative(root, actual);
      if (within === ".." || within.startsWith(".." + sep) || isAbsolute(within)) throw new Error("Gemini global context imports outside the original context directory require a supported explicit context location.");
      const target = files.get(imported) ?? join(importsDir, `${files.size}.md`);
      await privateDirectory(importsDir); await copy(imported, target);
      output += text.slice(last, start) + "@./" + relative(dirname(destination), target).split(sep).join("/"); last = end;
    }
    await writeFile(destination, output + text.slice(last), {mode: 0o600, flag: "wx"});
  };
  for (const name of names) if (await regular(join(sourceDir, name))) await copy(join(sourceDir, name), join(destinationDir, name));
}
export async function prepareGemini(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  const original = await validateGeminiConfiguration(input.cwd);
  const home = join(input.stateDir, "gemini-home"), dir = join(home, ".gemini");
  await privateDirectory(home); await privateDirectory(dir);
  const durable = join(input.sessionDir ?? join(input.stateDir, "sessions"), "gemini-home", ".gemini");
  await privateDirectory(durable);
  // Native ProjectRegistry rebuilds its private index from these directories'
  // .project_root ownership markers. Settings and lock files remain per-launch.
  for (const name of ["tmp", "history"]) { const target = join(durable, name); await privateDirectory(target); await symlink(target, join(dir, name), "dir"); }
  await snapshotFile(original.trustPath, join(dir, "trustedFolders.json"));
  await snapshotPolicies(join(original.home, ".gemini", "policies"), join(dir, "policies"));
  try { await snapshotContext(join(original.home, ".gemini"), dir, original.contextNames); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const defaults = join(input.stateDir, "gemini-system-defaults.json"), system = join(input.stateDir, "gemini-system.json"), user = join(dir, "settings.json");
  const modelDefinitions = {...Object.fromEntries(nativeModels.map(id => [id, {isVisible: false}])), ...Object.fromEntries(input.models.map(model => [model.id, {displayName: model.name, tier: "custom", family: "switcher", isPreview: false, isVisible: true, features: {thinking: false, multimodalToolUse: model.inputModalities?.includes("image") ?? false}}]))};
  const modelIdResolutions = Object.fromEntries(input.models.map(model => [model.id, {default: model.id, contexts: []}]));
  // Empty maps do not clear Gemini's recursive settings merge. Preflight above
  // rejects inherited modelConfigs; these generated definitions add the catalog.
  const enforced = {...original.system, security: {...original.system.security, auth: {...original.system.security?.auth, selectedType: "gemini-api-key"}}, model: {...original.system.model, name: input.model}, modelConfigs: {modelDefinitions, modelIdResolutions}, experimental: {...original.system.experimental, dynamicModelConfiguration: true}};
  for (const [path, value] of [[defaults, original.defaults], [user, original.user], [system, enforced]] as const) {
    const text = JSON.stringify(value, null, 2) + "\n";
    if (input.credential && text.includes(input.credential)) throw new Error("Gemini native settings must not contain the runtime credential.");
    await writeFile(path, text, {mode: 0o600, flag: "wx"});
  }
  const env: Record<string, string> = {
    GEMINI_CLI_HOME: home, GEMINI_CLI_SYSTEM_SETTINGS_PATH: system, GEMINI_CLI_SYSTEM_DEFAULTS_PATH: defaults,
    GEMINI_CLI_TRUSTED_FOLDERS_PATH: join(dir, "trustedFolders.json"),
    GEMINI_API_KEY: input.credential!, GOOGLE_API_KEY: "", GOOGLE_GEMINI_BASE_URL: input.baseUrl.replace(/\/v1beta\/?$/i, ""),
    GOOGLE_GENAI_API_VERSION: "v1beta", GEMINI_API_KEY_AUTH_MECHANISM: "x-goog-api-key", GEMINI_CLI_CUSTOM_HEADERS: "",
    GEMINI_CLI_NO_RELAUNCH: "1", HTTPS_PROXY: "", https_proxy: "", HTTP_PROXY: "", http_proxy: "", ALL_PROXY: "", all_proxy: "",
  };
  if (process.env.GEMINI_CLI_TRUST_WORKSPACE !== undefined) env.GEMINI_CLI_TRUST_WORKSPACE = process.env.GEMINI_CLI_TRUST_WORKSPACE;
  const args = geminiPolicyArguments(input.args ?? [], original.home);
  return {executable: input.executable ?? "gemini", args: ["--model", input.model, ...args], env, configPaths: [system, user, defaults], warnings: [
    "Gemini keeps the provider credential in an authenticated loopback bridge and uses per-launch settings with durable profile sessions.",
    "Native workspace trust, project instructions and permissions remain active. User settings, trust and policy changes in the private native home are temporary; project changes remain native.",
    "Inherited modelConfigs and custom agent model transport overrides fail preflight. Do not concurrently change native routing settings during launch. ACP is unsupported because its client can replace provider authentication.",
    "Global context and its imports are snapshotted within the original context directory; external imports and project policy paths using ~ require explicit supported paths. Global extensions, custom agents, skills and keybindings are not copied into the private home.",
  ]};
}
