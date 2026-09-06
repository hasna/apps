#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve package.json from both source (src/cli/) and built (bin/) locations
const pkgPath = existsSync(join(__dirname, "..", "package.json"))
  ? join(__dirname, "..", "package.json")
  : join(__dirname, "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
import { App } from "./components/App.js";
import {
  HOOKS,
  CATEGORIES,
  getHooksByCategory,
  searchHooks,
  getHook,
  type HookMeta,
} from "../lib/registry.js";
import {
  installHook,
  getInstalledHooks,
  getRegisteredHooks,
  getRegisteredHooksForTarget,
  removeHook,
  hookExists,
  getHookPath,
  getSettingsPath,
  type ConcreteTarget,
  type Scope,
  type Target,
} from "../lib/installer.js";
import { hookRegisteredInSettings, countSettingsWiring } from "../lib/registration.js";
import { projectEventRowForRead } from "../lib/redact.js";
import {
  createProfile,
  getProfile,
  listProfiles,
  touchProfile,
  exportProfiles,
  importProfiles,
  getProfilesDir,
} from "../lib/profiles.js";
import { readCustomManifest, listCustomHooks } from "../lib/manifest.js";
import { resolveHookMeta } from "../lib/resolve.js";
import { getPinnedHook } from "../lib/store.js";
import { SEMVER_PATTERN } from "../lib/semver.js";
import { getReportedDbPath } from "../lib/app-home.js";
import { getCustomHooksDir } from "../config.js";
import { hasHooksEnvAuthorityIntent, isHooksLocalOptIn } from "../lib/local-opt-in.js";
import { announceHooksLocalMode, resolveHooksTransport } from "../lib/transport.js";

const program = new Command();

function resolveScope(options: { global?: boolean; project?: boolean }): Scope {
  if (options.project) return "project";
  return "global";
}

function resolveTarget(options: { target?: string }): Target {
  if (options.target === "gemini") return "gemini";
  if (options.target === "codewith") return "codewith";
  if (options.target === "all") return "all";
  return "claude";
}

function resolveConcreteTarget(options: { target?: string }): ConcreteTarget {
  if (options.target === "gemini") return "gemini";
  if (options.target === "codewith") return "codewith";
  return "claude";
}

function formatSettingsPath(scope: Scope, target: Target): string {
  if (target === "all") return "target-specific settings";
  const actual = getSettingsPath(scope, target);
  if (scope === "project") {
    if (target === "codewith") return ".codewith/config.toml";
    if (target === "gemini") return ".gemini/settings.json";
    return ".claude/settings.json";
  }
  if (target === "codewith") {
    return process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH ? "$HASNA_HOOKS_CODEWITH_CONFIG_PATH" : "~/.codewith/config.toml";
  }
  if (target === "gemini") return "~/.gemini/settings.json";
  return actual === getSettingsPath("global", "claude") ? "~/.claude/settings.json" : actual;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function truncateText(value: string | undefined, max = 96): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

/**
 * P1-3 truncate-on-read projection for `hooks log` output: rows written by
 * older versions stored tool_input/error/metadata verbatim; every read path
 * projects them before display.
 */
function projectLogRows(rows: any[]): any[] {
  return rows.map((row) => projectEventRowForRead({ ...row }));
}

function readToken(tokenFile: string | undefined): string | undefined {
  if (tokenFile) {
    try {
      return readFileSync(tokenFile, "utf-8").trim();
    } catch {
      return undefined;
    }
  }
  return process.env.CF_API_TOKEN;
}

function readmePreview(readme: string, max = 280): string | undefined {
  const blocks = readme
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("#"))
    .filter((part) => !part.startsWith("```"))
    .filter((part) => !/^\[!\[/.test(part));
  const preview = blocks[0]
    ?? readme.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
  return preview ? truncateText(preview, max) : undefined;
}

function hookSummaryLine(hook: HookMeta, options: { verbose?: boolean } = {}): string {
  const matcher = hook.matcher ? ` ${hook.matcher}` : "";
  const description = options.verbose ? ` - ${truncateText(hook.description, 110)}` : "";
  return `  ${chalk.cyan(hook.name.padEnd(17))} ${chalk.dim(`[${hook.event}${matcher}]`)} ${chalk.dim(hook.category)}${description}`;
}

/**
 * Custom/registry hooks present in the store — bundled catalog + these is the
 * full list surface `hooks list` must show (QA-4 A1 / bug e8461f89).
 * Version comes from the lock pin when present (registry sync), else the
 * manifest's own version.
 */
function listStoreHooks(): Array<{ meta: HookMeta; source: "custom" | "registry" }> {
  const out: Array<{ meta: HookMeta; source: "custom" | "registry" }> = [];
  for (const parsed of listCustomHooks()) {
    const name = parsed.manifest.name;
    const pin = getPinnedHook(name);
    const source = pin?.source === "remote" || pin?.source === "registry" ? "registry" : "custom";
    const meta = resolveHookMeta(name);
    if (!meta) continue;
    out.push({
      meta: { ...meta, version: pin?.version ?? meta.version },
      source,
    });
  }
  return out.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

function printDisclosureHint(hidden: number, detailCommand: string, options: { includeAll?: boolean } = {}): void {
  const rowControls = options.includeAll ? "--limit, --all, --verbose" : "--limit, --verbose";
  if (hidden > 0) {
    console.log(chalk.dim(`\n  Showing a compact subset. ${hidden} more hidden; use ${rowControls}, or ${detailCommand}.`));
  } else {
    console.log(chalk.dim(`\n  Use --verbose or ${detailCommand} for details.`));
  }
}

/** Levenshtein distance for did-you-mean suggestions */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestHooks(name: string, max = 3): string[] {
  return HOOKS
    .map((h) => ({ name: h.name, dist: editDistance(name.toLowerCase(), h.name.toLowerCase()) }))
    .filter(({ dist }) => dist <= 4)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, max)
    .map(({ name: n }) => n);
}

program
  .name("hooks")
  .description("Install hooks for AI coding agents")
  .version(pkg.version);

// Interactive mode (default)
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive hook browser")
  .action(() => {
    render(<App />);
  });

// Init command — register a new agent profile
program
  .command("init")
  .description("Register a new agent profile with a unique ID")
  .option("-a, --agent <type>", "Agent type: claude, gemini, custom", "claude")
  .option("-n, --name <name>", "Optional display name for the agent")
  .option("-j, --json", "Output as JSON", false)
  .option("--cloudflare", "Configure a remote registry (Cloudflare worker)", false)
  .option("--api-url <url>", "Remote registry API URL (with --cloudflare)")
  .option("--api-key <ref>", "Vault key NAME for the registry API key (never the value; with --cloudflare)")
  .action(async (options: { agent: string; name?: string; json: boolean; cloudflare: boolean; apiUrl?: string; apiKey?: string }) => {
    if (options.cloudflare) {
      // Remote-registry configuration guidance. `~/.hasna/hooks/config.json`
      // (api_url / api_key_ref) is a retired key store (hasna/apps#1720): the
      // registry URL and key now resolve through @hasna/contracts — env,
      // Keychain items `hasna.credentials.hooks.api-url` / `.api-key`, or the
      // `~/.hasna/hooks/config/credentials` file — so this command prints the
      // exact configuration to apply instead of writing a file the resolver
      // no longer reads.
      if (!options.apiUrl) {
        const message = "--cloudflare requires --api-url <url>";
        if (options.json) console.log(JSON.stringify({ error: message }));
        else console.log(chalk.red(message));
        return;
      }
      // api_key_ref is the VAULT KEY NAME (never the value); it maps onto the
      // resolver's deliberate env pointer HASNA_HOOKS_API_KEY_REF, which
      // resolves through @hasna/secrets at request time.
      const apiKeyRef = options.apiKey ?? "hasna/hooks/live/api-key";
      const apiUrl = options.apiUrl.replace(/\/+$/, "");
      if (options.json) {
        console.log(JSON.stringify({
          ok: true,
          api_url: apiUrl,
          api_key_ref: apiKeyRef,
          env: {
            HASNA_HOOKS_API_URL: apiUrl,
            HASNA_HOOKS_API_KEY_REF: apiKeyRef,
          },
          note: "config.json is retired; no file was written",
        }));
        return;
      }
      console.log(chalk.green(`\n✓ Remote registry configuration for ${apiUrl}\n`));
      console.log(`  ${chalk.dim("API URL:")}    ${apiUrl}`);
      console.log(`  ${chalk.dim("API key ref:")} ${apiKeyRef}`);
      console.log();
      console.log(chalk.dim("  ~/.hasna/hooks/config.json is retired (hasna/apps#1720); the registry"));
      console.log(chalk.dim("  URL and key now resolve through @hasna/contracts, per call, in this order:"));
      console.log(chalk.dim("    HASNA_HOOKS_API_URL / HASNA_HOOKS_API_KEY (env)"));
      console.log(chalk.dim("    hasna.credentials.hooks.api-url / .api-key (macOS Keychain)"));
      console.log(chalk.dim("    ~/.hasna/hooks/config/credentials (disk, owner-only)"));
      console.log();
      console.log(chalk.dim("  Configure the machine for this registry:"));
      console.log(`    export HASNA_HOOKS_API_URL=${apiUrl}`);
      console.log(`    export HASNA_HOOKS_API_KEY_REF=${apiKeyRef}   # resolved through the vault, never a value`);
      console.log();
      console.log(chalk.dim("  Run the server with the key resolved from the vault, never the value:"));
      console.log(`    secrets exec ${apiKeyRef} --as HASNA_HOOKS_API_KEY -- hooks serve`);
      console.log(chalk.dim("  (or store the Keychain item hasna.credentials.hooks.api-key)"));
      console.log();
      return;
    }

    const agentType = options.agent as "claude" | "gemini" | "custom";
    if (!["claude", "gemini", "custom"].includes(agentType)) {
      if (options.json) {
        console.log(JSON.stringify({ error: `Invalid agent type: ${options.agent}`, valid: ["claude", "gemini", "custom"] }));
      } else {
        console.log(chalk.red(`Invalid agent type: ${options.agent}`));
        console.log(chalk.dim("Valid types: claude, gemini, custom"));
      }
      return;
    }

    const profile = createProfile({ agent_type: agentType, name: options.name });

    if (options.json) {
      console.log(JSON.stringify(profile));
      return;
    }

    console.log(chalk.green(`\n✓ Agent profile created\n`));
    console.log(`  ${chalk.dim("Agent ID:")}   ${chalk.bold(profile.agent_id)}`);
    console.log(`  ${chalk.dim("Type:")}       ${profile.agent_type}`);
    if (profile.name) {
      console.log(`  ${chalk.dim("Name:")}       ${profile.name}`);
    }
    console.log(`  ${chalk.dim("Profile:")}    ${join(getProfilesDir(), `${profile.agent_id}.json`)}`);
    console.log();
    console.log(chalk.dim("  Install hooks with this profile:"));
    console.log(`    hooks install gitguard --profile ${profile.agent_id}`);
    console.log();
  });

// Run command — executes a hook, called by AI coding agents via settings.json
program
  .command("run")
  .argument("<hook>", "Hook to run")
  .option("--profile <id>", "Agent profile ID")
  .description("Execute a hook (called by AI coding agents)")
  .action(async (hook: string, options: { profile?: string }) => {
    const { resolveHook, resolveScriptPath } = await import("../lib/resolve.js");
    const { sha256Of, checkScriptHash } = await import("../lib/store.js");
    const { recordHookRun, resolveEventType } = await import("../lib/db-writer.js");
    const resolved = resolveHook(hook);
    if (!resolved) {
      console.error(JSON.stringify({ error: `Hook '${hook}' not found` }));
      process.exit(1);
    }

    const hookScript = resolveScriptPath(hook);
    if (!hookScript || !existsSync(hookScript)) {
      console.error(JSON.stringify({ error: `Hook script not found: ${hookScript ?? hook}` }));
      process.exit(1);
    }

    // Read the bytes ONCE. The verified bytes are the executed bytes: the
    // path is never re-opened for execution after the trust check (TOCTOU).
    const content = readFileSync(hookScript);
    const sha = sha256Of(content);
    const check = checkScriptHash(hook, sha);
    if (!check.ok) {
      console.error(
        JSON.stringify({
          error: `Hook '${hook}' script changed since it was trusted (sha256 ${check.expected} != ${check.actual}). Run 'hooks trust ${hook}' to trust the new content.`,
          hook,
          expected_sha256: check.expected,
          actual_sha256: check.actual,
        }),
      );
      process.exit(1);
    }

    // Read stdin (agent passes hook context as JSON)
    const stdin = await new Response(Bun.stdin.stream()).text();

    // If profile specified, inject agent data into the hook input
    let hookStdin = stdin;
    if (options.profile) {
      const profile = getProfile(options.profile);
      if (profile) {
        touchProfile(options.profile);
        try {
          const input = JSON.parse(stdin);
          input.agent = {
            agent_id: profile.agent_id,
            agent_type: profile.agent_type,
            name: profile.name,
            preferences: profile.preferences,
          };
          hookStdin = JSON.stringify(input);
        } catch {
          // If stdin is not valid JSON, pass through unmodified
        }
      }
    }

    // Execute the verified bytes with bun, passing stdin through
    const { readCustomManifest } = await import("../lib/manifest.js");
    const { executeVerifiedScript, HookTimeoutError } = await import("../lib/run.js");
    const custom = readCustomManifest(hook);
    const args = custom?.manifest.args ?? [];
    const timeout = custom?.manifest.timeout_ms;
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      ({ stdout, stderr, exitCode } = await executeVerifiedScript({
        name: hook,
        scriptPath: hookScript,
        content,
        args,
        stdin: hookStdin,
        env: process.env,
        timeout,
      }));
    } catch (err) {
      if (err instanceof HookTimeoutError) {
        // The timeout is itself an execution attempt — record it so the
        // audit trail is never empty (general reviewer P1-3).
        try {
          const { recordHookRun, resolveEventType } = await import("../lib/db-writer.js");
          let inputJson: Record<string, any> = {};
          try { inputJson = JSON.parse(stdin); } catch {}
          recordHookRun({
            hookName: hook,
            eventType: resolveEventType(inputJson.hook_event_name, resolved.events[0] ?? "PostToolUse"),
            version: resolved.version,
            sha256: sha,
            sessionId: typeof inputJson.session_id === "string" ? inputJson.session_id : null,
            toolName: typeof inputJson.tool_name === "string" ? inputJson.tool_name : null,
            toolInput: inputJson.tool_input,
            error: err.message.slice(0, 500),
            exitCode: -1,
            durationMs: Date.now() - started,
            projectDir: process.cwd(),
          });
        } catch {
          // Observability must never mask the timeout.
        }
        console.error(JSON.stringify({ error: err.message, hook, timedOut: true, timeout_ms: timeout ?? null }));
        process.exit(1);
      }
      throw err;
    }
    const durationMs = Date.now() - started;

    // Every execution lands in hook_events so `hooks log` is never empty
    // after a real fire (bug ef58dcb7).
    let inputJson: Record<string, any> = {};
    try { inputJson = JSON.parse(stdin); } catch {}
    let outputJson: Record<string, any> = {};
    try { outputJson = JSON.parse(stdout); } catch {}
    const blocked = outputJson.decision === "block" || outputJson.continue === false;
    recordHookRun({
      hookName: hook,
      eventType: resolveEventType(inputJson.hook_event_name, resolved.events[0] ?? "PostToolUse"),
      version: resolved.version,
      sha256: sha,
      sessionId: typeof inputJson.session_id === "string" ? inputJson.session_id : null,
      toolName: typeof inputJson.tool_name === "string" ? inputJson.tool_name : null,
      toolInput: inputJson.tool_input,
      result: blocked ? "block" : "continue",
      error: exitCode !== 0 ? (stderr || `hook exited with code ${exitCode}`).slice(0, 500) : null,
      exitCode,
      durationMs,
      projectDir: process.cwd(),
    });

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(exitCode);
  });

// Install command
program
  .command("install")
  .alias("add")
  .argument("[hooks...]", "Hooks to install")
  .option("-o, --overwrite", "Overwrite existing hooks", false)
  .option("-a, --all", "Install all available hooks", false)
  .option("-c, --category <category>", "Install all hooks in a category")
  .option("-g, --global", "Install globally (~/.claude/settings.json)", false)
  .option("-p, --project", "Install for current project (.claude/settings.json)", false)
  .option("-t, --target <target>", "Agent target: claude, gemini, codewith, all (default: claude)", "claude")
  .option("--profile <id>", "Agent profile ID to scope hooks to")
  .option("--dry-run", "Preview what would be installed without writing to settings", false)
  .option("--apply-codewith", "Explicitly append Codewith TOML to a config file (prefer configs for managed configs)", false)
  .option("--codewith-config <path>", "Explicit Codewith config path required with --apply-codewith")
  .option("-j, --json", "Output as JSON", false)
  .description("Install one or more hooks (registry names, local paths, git URLs, manifest URLs, or <name>@<version> pinned installs)")
  .action(async (hooks: string[], options) => {
    const scope = resolveScope(options);
    const target = resolveTarget(options);
    let toInstall: string[] = hooks;

    if (options.all) {
      toInstall = HOOKS.map((h) => h.name);
    } else if (options.category) {
      const category = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!category) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Unknown category: ${options.category}`, available: [...CATEGORIES] }));
        } else {
          console.log(chalk.red(`Unknown category: ${options.category}`));
          console.log(chalk.dim(`Available: ${CATEGORIES.join(", ")}`));
        }
        // P2-13: a failed install is an error — nonzero exit.
        process.exitCode = 1;
        return;
      }
      toInstall = getHooksByCategory(category).map((h) => h.name);
    }

    if (toInstall.length === 0) {
      render(<App />);
      return;
    }

    if (options.applyCodewith && (target === "codewith" || target === "all") && !options.codewithConfig) {
      const message = "--apply-codewith requires --codewith-config <path>; refusing to write default ~/.codewith/config.toml.";
      if (options.json) {
        console.log(JSON.stringify({ error: message, scope, target, applied: false }));
      } else {
        console.log(chalk.red(message));
      }
      return;
    }

    const { isCustomSource, installCustomSource } = await import("../lib/custom-install.js");
    const { readCustomManifest, HOOK_NAME_RE } = await import("../lib/manifest.js");
    const { resolveHooksTransport } = await import("../lib/transport.js");
    const { sha256Of, pinInstalledHook } = await import("../lib/store.js");
    const { readFileSync: readFileSyncFs } = await import("fs");

    // <name>@<version> pinned installs fetch the exact version from the
    // remote registry and verify its sha against the remote lock (QA-2).
    // Only a BARE <name>@<version> is a pin: URLs (http://…, git@…:…,
    // ssh://, file://) and local paths are custom sources, never pinned
    // registry requests (general reviewer P2).
    function parseNameVersion(arg: string): { name: string; version: string } | null {
      if (isCustomSource(arg)) return null;
      const at = arg.lastIndexOf("@");
      if (at <= 0 || at === arg.length - 1) return null;
      const name = arg.slice(0, at);
      const version = arg.slice(at + 1);
      if (!HOOK_NAME_RE.test(name)) return null;
      // P2-8 (round 2): the SHARED semver pattern — the CLI previously
      // duplicated a divergent regex that rejected prerelease+build
      // combinations (1.2.3-beta.1+meta) the rest of the stack accepts.
      if (!SEMVER_PATTERN.test(version)) return null;
      return { name, version };
    }

    const pinnedRequests = toInstall
      .map((arg) => ({ arg, pinned: parseNameVersion(arg) }))
      .filter((x): x is { arg: string; pinned: { name: string; version: string } } => x.pinned !== null);

    const customSources = toInstall.filter((n) => !getHook(n) && isCustomSource(n));

    // Dry-run: preview what would be installed
    if (options.dryRun) {
      const known = toInstall.filter((n) => getHook(n));
      const unknown = toInstall.filter((n) => !getHook(n) && !isCustomSource(n) && !parseNameVersion(n) && !readCustomManifest(n));
      if (options.json) {
        console.log(JSON.stringify({
          dryRun: true,
          would_install: known,
          custom_sources: customSources,
          pinned: pinnedRequests.map((p) => `${p.pinned.name}@${p.pinned.version}`),
          unknown,
          scope,
          target,
          mode: target === "codewith" ? "fragment" : "write",
        }));
        return;
      }
      console.log(chalk.bold(`\nDry run — would install (${scope}, ${target}):\n`));
      for (const name of known) {
        const meta = getHook(name)!;
        console.log(chalk.cyan(`  ${name}`) + chalk.dim(` [${meta.event}${meta.matcher ? ` ${meta.matcher}` : ""}]`));
      }
      for (const source of customSources) {
        console.log(chalk.cyan(`  ${source}`) + chalk.dim(" [custom source: would fetch and install]"));
      }
      for (const p of pinnedRequests) {
        console.log(chalk.cyan(`  ${p.pinned.name}@${p.pinned.version}`) + chalk.dim(" [pinned registry install]"));
      }
      if (unknown.length > 0) {
        console.log();
        for (const name of unknown) {
          const suggestions = suggestHooks(name);
          console.log(chalk.red(`  ✗ unknown: ${name}`) + (suggestions.length ? chalk.dim(` — did you mean: ${suggestions.join(", ")}?`) : ""));
        }
      }
      return;
    }

    const results = [];
    const installedCustom: string[] = [];
    for (const source of customSources) {
      try {
        const custom = await installCustomSource(source);
        // Pin the ACTUAL installed version+sha at install time — the first
        // run is trusted with real provenance, never a 0.0.0 placeholder
        // (QA-1 P3). The name joins the registration set ONLY after the pin
        // transaction succeeds; on pin failure the copied store dir is rolled
        // back so the bytes never become runnable unrecorded (security
        // reviewer P1-3).
        try {
          const scriptBytes = readFileSyncFs(custom.scriptPath);
          pinInstalledHook(custom.name, custom.version, sha256Of(scriptBytes), "custom", source);
        } catch (pinError) {
          const { customHookDir } = await import("../lib/manifest.js");
          const { removeHookFromStore } = await import("../lib/store.js");
          try {
            rmSync(customHookDir(custom.name), { recursive: true, force: true });
          } catch {
            // Best-effort rollback.
          }
          removeHookFromStore(custom.name);
          throw pinError;
        }
        installedCustom.push(custom.name);
        if (options.json) {
          console.log(JSON.stringify({ custom: { source, name: custom.name, version: custom.version, pinned: true } }));
        } else {
          console.log(chalk.green(`✓ Installed custom hook '${custom.name}' v${custom.version} from ${source}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ hook: source, success: false, error: message });
        if (options.json) {
          console.log(JSON.stringify({ error: `Custom hook install failed for ${source}: ${message}` }));
        } else {
          console.log(chalk.red(`✗ ${message}`));
        }
      }
    }

    // Pinned registry installs: fetch the exact version, verify the sha
    // against the remote lock, then register in settings. The registry
    // authority and key resolve TOGETHER through the @hasna/contracts chain
    // (strict pair, fresh per call) — a URL without a key is a refusal.
    const installedPinned: string[] = [];
    for (const { arg, pinned } of pinnedRequests) {
      try {
        const transport = resolveHooksTransport();
        if (transport.mode !== "remote" || !transport.authority) {
          throw new Error(`Cannot install '${arg}': no remote registry configured (set HASNA_HOOKS_API_URL and HASNA_HOOKS_API_KEY, or opt into local mode with HASNA_HOOKS_LOCAL=1)`);
        }
        const { origin, apiKey } = transport.authority;
        const { fetchPinnedHook } = await import("../lib/sync.js");
        const pinnedInstall = await fetchPinnedHook(pinned.name, pinned.version, origin, apiKey);
        installedPinned.push(pinnedInstall.name);
        if (options.json) {
          console.log(JSON.stringify({ pinned: { request: arg, name: pinnedInstall.name, version: pinnedInstall.version, sha256: pinnedInstall.sha256, source: pinnedInstall.source } }));
        } else {
          console.log(chalk.green(`✓ Installed '${pinnedInstall.name}' v${pinnedInstall.version} from registry (sha256 ${pinnedInstall.sha256.slice(0, 12)}…)`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ hook: arg, success: false, error: message });
        if (options.json) {
          console.log(JSON.stringify({ error: `Pinned install failed for ${arg}: ${message}` }));
        } else {
          console.log(chalk.red(`✗ ${message}`));
        }
      }
    }

    const namesToRegister = [...new Set([
      ...toInstall.filter((n) => !isCustomSource(n) && !parseNameVersion(n)),
      ...installedCustom,
      ...installedPinned,
    ])];

    for (const name of namesToRegister) {
      // Did-you-mean for unknown hooks — a synced registry/custom hook that
      // already exists in the store resolves here too (QA-4 A1).
      if (!getHook(name) && !installedCustom.includes(name) && !installedPinned.includes(name) && !readCustomManifest(name)) {
        const suggestions = suggestHooks(name);
        const hint = suggestions.length ? ` — did you mean: ${suggestions.join(", ")}?` : "";
        results.push({ hook: name, success: false, error: `Hook '${name}' not found${hint}` });
        continue;
      }
      const result = installHook(name, {
        scope,
        overwrite: options.overwrite,
        target,
        profile: options.profile,
        codewithMode: options.applyCodewith ? "write" : "fragment",
        codewithConfigPath: options.codewithConfig,
      });
      results.push(result);
    }

    if (options.json) {
      console.log(JSON.stringify({
        installed: results.filter((r) => r.success).map((r) => r.hook),
        failed: results.filter((r) => !r.success).map((r) => ({ hook: r.hook, error: r.error })),
        fragments: results.filter((r) => r.success && r.fragment).map((r) => ({ hook: r.hook, fragment: r.fragment, applied: r.applied, configPath: r.configPath, note: r.note })),
        total: results.length,
        success: results.filter((r) => r.success).length,
        scope,
        target,
        applied: results.some((r) => r.applied),
      }));
      // P2-7 (round 2): ANY failed install is an error — exit nonzero even
      // when some hooks succeeded, with the counts in the payload.
      if (results.some((r) => !r.success)) {
        process.exitCode = 1;
      }
      return;
    }

    const successCount = results.filter((r) => r.success).length;
    const settingsFile = target === "codewith"
      ? (options.applyCodewith ? options.codewithConfig : "TOML fragment only (configs should apply)")
      : scope === "project" ? ".claude/settings.json" : "~/.claude/settings.json";
    console.log(chalk.bold(`\nInstalling hooks (${scope}, ${target})...\n`));
    for (const result of results) {
      if (result.success) {
        const meta = getHook(result.hook);
        console.log(chalk.green(`✓ ${result.hook}`));
        if (meta) {
          console.log(
            chalk.dim(`  ${meta.event}${meta.matcher ? ` [${meta.matcher}]` : ""} → hooks run ${result.hook}`)
          );
        }
        if (result.conflict) {
          console.log(chalk.yellow(`  ⚠ Warning: ${result.conflict}`));
        }
        if (result.fragment && target === "codewith") {
          console.log(chalk.dim("  Codewith TOML fragment:"));
          console.log(chalk.cyan(result.fragment.trimEnd().split("\n").map((line) => `    ${line}`).join("\n")));
          if (result.note) console.log(chalk.yellow(`  ⚠ ${result.note}`));
        }
      } else {
        console.log(chalk.red(`✗ ${result.hook}: ${result.error}`));
      }
    }
    // Fail-closed reporting: never claim "Registered" (and never exit 0)
    // when nothing was registered (QA-3 P2 / QA-1 BUG-C / QA-4 #5) or when
    // only some hooks registered (P2-7 round 2 — mixed installs must fail
    // loudly, not read as a full success).
    if (results.length > 0 && successCount === 0) {
      console.log(chalk.red(`\n✗ Nothing was registered — all ${results.length} hook(s) failed.`));
      process.exitCode = 1;
      return;
    }
    if (successCount < results.length) {
      console.log(chalk.red(`\n✗ ${results.length - successCount} of ${results.length} hook(s) failed to install.`));
      process.exitCode = 1;
    }
    console.log(chalk.dim(`\nRegistered in ${settingsFile}`));
  });

// List command
program
  .command("list")
  .alias("ls")
  .option("-c, --category <category>", "Filter by category")
  .option("-a, --all", "Show all available hooks", false)
  .option("-i, --installed", "Show only installed hooks", false)
  .option("-r, --registered", "Show registered hooks", false)
  .option("-g, --global", "Check global settings", false)
  .option("-p, --project", "Check project settings", false)
  .option("-t, --target <target>", "Agent target: claude, gemini, codewith (default: claude)", "claude")
  .option("-n, --limit <n>", "Max rows to show in compact output", "20")
  .option("--verbose", "Show descriptions and full detail columns", false)
  .option("-j, --json", "Output as JSON", false)
  .description("List available or installed hooks (bundled + custom/registry)")
  .action((options) => {
    const scope = resolveScope(options);
    const limit = options.all ? Number.MAX_SAFE_INTEGER : parseLimit(options.limit, 20, 200);
    const storeHooks = listStoreHooks();

    if (options.registered || options.installed) {
      const target = (options.target === "gemini" ? "gemini" : options.target === "codewith" ? "codewith" : "claude") as "claude" | "gemini" | "codewith";
      const registered = getRegisteredHooksForTarget(scope, target);
      const installed = [...new Set([...registered, ...storeHooks.map((s) => s.meta.name)])];
      const shown = options.registered ? registered : installed;
      if (options.json) {
        console.log(JSON.stringify(shown.map((name) => {
          const store = storeHooks.find((s) => s.meta.name === name);
          const meta = store?.meta ?? getHook(name);
          return {
            name,
            event: meta?.event,
            version: meta?.version,
            description: meta?.description,
            source: store?.source ?? (store ? "custom" : undefined),
            scope,
            target,
          };
        })));
        return;
      }
      if (shown.length === 0) {
        console.log(chalk.dim(`No hooks ${options.registered ? "registered" : "installed"} (${scope}, ${target})`));
        return;
      }
      const label = options.registered ? "Registered" : "Installed";
      const visible = shown.slice(0, limit);
      console.log(chalk.bold(`\n${label} hooks — ${scope}/${target} (${shown.length}, showing ${visible.length}):\n`));
      for (const name of visible) {
        const store = storeHooks.find((s) => s.meta.name === name);
        const meta = store?.meta ?? getHook(name);
        if (meta) {
          console.log(
            hookSummaryLine(meta, { verbose: options.verbose }) +
            (store ? chalk.dim(` (${store.source})`) : ""),
          );
        } else {
          console.log(`  ${chalk.cyan(name)} ${chalk.dim("[unknown]")}`);
        }
      }
      printDisclosureHint(shown.length - visible.length, "hooks info <name>", { includeAll: true });
      return;
    }

    if (options.category) {
      const category = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!category) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Unknown category: ${options.category}`, available: [...CATEGORIES] }));
        } else {
          console.log(chalk.red(`Unknown category: ${options.category}`));
          console.log(chalk.dim(`Available: ${CATEGORIES.join(", ")}`));
        }
        return;
      }
      const hooks = getHooksByCategory(category);
      if (options.json) {
        console.log(JSON.stringify(hooks));
        return;
      }
      const visible = hooks.slice(0, limit);
      console.log(chalk.bold(`\n${category} (${hooks.length}, showing ${visible.length}):\n`));
      for (const h of visible) console.log(hookSummaryLine(h, { verbose: options.verbose }));
      printDisclosureHint(hooks.length - visible.length, "hooks info <name>", { includeAll: true });
      return;
    }

    // Show all by category, plus custom/registry hooks from the store
    if (options.json) {
      const result: Record<string, any[]> = {};
      for (const category of CATEGORIES) {
        result[category] = getHooksByCategory(category);
      }
      result["Custom / Registry"] = storeHooks.map((s) => ({
        name: s.meta.name,
        displayName: s.meta.displayName,
        description: s.meta.description,
        version: s.meta.version,
        category: "Custom / Registry",
        event: s.meta.event,
        events: s.meta.events,
        matcher: s.meta.matcher,
        tags: [...new Set([...s.meta.tags, s.source])],
        source: s.source,
      }));
      console.log(JSON.stringify(result));
      return;
    }

    const visible = HOOKS.slice(0, limit);
    console.log(chalk.bold(`\nAvailable hooks (${HOOKS.length}, showing ${visible.length}):\n`));
    for (const h of visible) console.log(hookSummaryLine(h, { verbose: options.verbose }));
    printDisclosureHint(HOOKS.length - visible.length, "hooks info <name>", { includeAll: true });
    if (storeHooks.length > 0) {
      const storeVisible = storeHooks.slice(0, limit);
      console.log(chalk.bold(`\nCustom / Registry hooks (${storeHooks.length}, showing ${storeVisible.length}):\n`));
      for (const s of storeVisible) {
        console.log(
          hookSummaryLine(s.meta, { verbose: options.verbose }) +
          chalk.dim(` (${s.source})`),
        );
      }
      printDisclosureHint(storeHooks.length - storeVisible.length, "hooks info <name>", { includeAll: true });
    }
  });

// Search command
program
  .command("search")
  .argument("<query>", "Search term")
  .option("-n, --limit <n>", "Max rows to show in compact output", "10")
  .option("--verbose", "Show descriptions for search results", false)
  .option("-j, --json", "Output as JSON", false)
  .description("Search for hooks")
  .action((query: string, options: { limit: string; verbose: boolean; json: boolean }) => {
    const results = searchHooks(query);
    if (options.json) {
      console.log(JSON.stringify(results));
      return;
    }
    if (results.length === 0) {
      console.log(chalk.dim(`No hooks found for "${query}"`));
      return;
    }
    const limit = parseLimit(options.limit, 10, 100);
    const visible = results.slice(0, limit);
    console.log(chalk.bold(`\nFound ${results.length} hook(s), showing ${visible.length}:\n`));
    for (const h of visible) console.log(hookSummaryLine(h, { verbose: options.verbose }));
    printDisclosureHint(results.length - visible.length, "hooks info <name>");
  });

// Remove command
program
  .command("remove")
  .alias("rm")
  .argument("<hook>", "Hook to remove")
  .option("-g, --global", "Remove from global settings", false)
  .option("-p, --project", "Remove from project settings", false)
  .option("-t, --target <target>", "Agent target: claude, gemini, codewith, all (default: claude)", "claude")
  .option("-j, --json", "Output as JSON", false)
  .description("Remove an installed hook (settings registration + store + lock + DB)")
  .action(async (hook: string, options: { global?: boolean; project?: boolean; target?: string; json: boolean }) => {
    const scope = resolveScope(options);
    const target = resolveTarget(options);

    // Full uninstall — resolves custom, registry-synced and bundled hooks;
    // removes the settings registration, the store dir (custom hooks), the
    // lock pin and the DB record (QA-1 BUG-A / QA-4).
    const { uninstallHook } = await import("../lib/installer.js");
    const result = uninstallHook(hook, scope, target);
    if (!result.removed) {
      // Non-zero for BOTH output modes (JSON and plain) — the machine path
      // must fail closed too (general reviewer P1-2).
      process.exitCode = 1;
    }
    if (options.json) {
      console.log(JSON.stringify({
        hook: result.name,
        removed: result.removed,
        source: result.source,
        settings_scopes: result.settingsScopes,
        store_dir_removed: result.storeDirRemoved,
        pin_removed: result.pinRemoved,
        db_record_removed: result.dbRecordRemoved,
        registrations_remaining: result.registrationsRemaining,
        scope,
        target,
        ...(result.error ? { error: result.error } : {}),
      }));
    } else if (result.removed) {
      console.log(chalk.green(`✓ Removed ${result.name} (${scope}, ${target})`));
      if (result.source === "custom" && result.storeDirRemoved) {
        console.log(chalk.dim(`  store dir removed; lock pin ${result.pinRemoved ? "removed" : "absent"}; DB record ${result.dbRecordRemoved ? "removed" : "absent"}`));
      }
      if (result.registrationsRemaining && result.registrationsRemaining.length > 0) {
        console.log(chalk.yellow(`  ⚠ registrations remaining: ${result.registrationsRemaining.join(", ")} — remove them in that target's own config`));
      }
    } else {
      const suggestions = suggestHooks(hook);
      const hint = suggestions.length ? ` — did you mean: ${suggestions.join(", ")}?` : "";
      console.log(chalk.red(`✗ Hook '${hook}' not found${hint}`));
    }
  });

// Categories command
program
  .command("categories")
  .option("-j, --json", "Output as JSON", false)
  .description("List all categories")
  .action((options: { json: boolean }) => {
    if (options.json) {
      const result = CATEGORIES.map((cat) => ({
        name: cat,
        count: getHooksByCategory(cat).length,
      }));
      console.log(JSON.stringify(result));
      return;
    }
    console.log(chalk.bold("\nCategories:\n"));
    for (const category of CATEGORIES) {
      const count = getHooksByCategory(category).length;
      console.log(`  ${category} (${count})`);
    }
  });

// Info command
program
  .command("info")
  .argument("<hook>", "Hook name")
  .option("-j, --json", "Output as JSON", false)
  .description("Show detailed info about a hook")
  .action(async (hook: string, options: { json: boolean }) => {
    const { resolveHookMeta } = await import("../lib/resolve.js");
    const meta = resolveHookMeta(hook) ?? getHook(hook);
    if (!meta) {
      const suggestions = suggestHooks(hook);
      const hint = suggestions.length ? ` — did you mean: ${suggestions.join(", ")}?` : "";
      if (options.json) {
        console.log(JSON.stringify({ error: `Hook '${hook}' not found${hint}`, suggestions }));
      } else {
        console.log(chalk.red(`Hook '${hook}' not found${hint}`));
      }
      // P2-13: a not-found lookup is an error — nonzero exit.
      process.exitCode = 1;
      return;
    }

    const globalInstalled = getRegisteredHooks("global").includes(meta.name);
    const projectInstalled = getRegisteredHooks("project").includes(meta.name);
    const { readCustomManifest } = await import("../lib/manifest.js");
    const custom = readCustomManifest(meta.name);
    const source = custom ? "custom" : "bundled";
    const sourceNote = custom ? `custom (${getCustomHooksDir()}/) overrides the bundled registry` : "bundled registry";

    if (options.json) {
      console.log(JSON.stringify({ ...meta, source, source_note: sourceNote, global: globalInstalled, project: projectInstalled }));
      return;
    }

    console.log(chalk.bold(`\n${meta.displayName}\n`));
    console.log(`  ${meta.description}`);
    console.log();
    console.log(`  ${chalk.dim("Category:")}  ${meta.category}`);
    console.log(`  ${chalk.dim("Version:")}   ${meta.version}`);
    console.log(`  ${chalk.dim("Event:")}     ${meta.event}`);
    console.log(`  ${chalk.dim("Matcher:")}   ${meta.matcher || "(none)"}`);
    console.log(`  ${chalk.dim("Tags:")}      ${meta.tags.join(", ")}`);
    console.log(`  ${chalk.dim("Source:")}    ${source} (${sourceNote})`);
    console.log(`  ${chalk.dim("Command:")}   hooks run ${meta.name}`);
    console.log();

    if (globalInstalled) {
      console.log(chalk.green("  ● Installed globally"));
    } else {
      console.log(chalk.dim("  ○ Not installed globally"));
    }

    if (projectInstalled) {
      console.log(chalk.green("  ● Installed in project"));
    } else {
      console.log(chalk.dim("  ○ Not installed in project"));
    }
  });

// Doctor command
program
  .command("doctor")
  .option("-g, --global", "Check global settings", false)
  .option("-p, --project", "Check project settings", false)
  .option("-j, --json", "Output as JSON", false)
  .description("Check health of installed hooks")
  .action((options: { global?: boolean; project?: boolean; json: boolean }) => {
    const scope = resolveScope(options);
    const settingsPath = getSettingsPath(scope);
    const issues: { hook: string; issue: string; severity: "error" | "warning" }[] = [];
    const healthy: string[] = [];

    const settingsExist = existsSync(settingsPath);
    if (!settingsExist) {
      issues.push({ hook: "(settings)", issue: `${settingsPath} not found`, severity: "warning" });
    }

    const registered = getRegisteredHooks(scope);
    // P2-16b: the verdict is bounded — count the raw wiring entries too, so
    // "all healthy" never reads as coverage of entries doctor cannot see.
    let wiringCount = 0;
    if (settingsExist) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        wiringCount = countSettingsWiring(settings);
      } catch {}
    }

    for (const name of registered) {
      const custom = readCustomManifest(name);
      const meta = custom ? resolveHookMeta(name) : getHook(name);
      let hookHealthy = true;

      if (custom) {
        // Custom hook from the custom dir: healthy when its script exists.
        if (!existsSync(custom.scriptPath)) {
          issues.push({ hook: name, issue: `Custom hook script missing: ${custom.scriptPath}`, severity: "error" });
          hookHealthy = false;
        }
      } else {
        // Check hook exists in the package
        if (!hookExists(name)) {
          issues.push({ hook: name, issue: "Hook not found in @hasna/hooks package", severity: "error" });
          hookHealthy = false;
          continue;
        }

        // Check hook has source
        const hookDir = getHookPath(name);
        const hookScript = join(hookDir, "src", "hook.ts");
        if (!existsSync(hookScript)) {
          issues.push({ hook: name, issue: "Missing src/hook.ts in package", severity: "error" });
          hookHealthy = false;
        }
      }

      // Verify correct event registration
      if (meta && settingsExist) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
          if (!hookRegisteredInSettings(settings, name, meta.event, meta.matcher)) {
            const eventName = meta.event.split(":")[0];
            issues.push({ hook: name, issue: `Not registered under correct event (${eventName})`, severity: "error" });
            hookHealthy = false;
          }
        } catch {}
      }

      if (hookHealthy) {
        healthy.push(name);
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ healthy: issues.length === 0, healthy_hooks: healthy, issues, registered, wiring_count: wiringCount, scope }));
      return;
    }

    console.log(chalk.bold(`\nHook Health Check (${scope})\n`));

    if (registered.length === 0) {
      console.log(chalk.dim("  No hooks registered."));
      console.log(chalk.dim("  Run: hooks install gitguard"));
      // P3-10 (round 2): the verdict's bounds are printed in EVERY branch —
      // with zero `hooks run` entries the bound is exactly what makes
      // "checked 0 of N wiring entries" a meaningful statement instead of a
      // bare "No hooks registered".
      console.log(chalk.dim(`  (checked 0 registered \`hooks run\` entries of ${wiringCount} settings wiring entries; direct-path wiring outside the registered surface is not covered by this check)`));
      if (issues.length > 0) process.exitCode = 1;
      return;
    }

    if (healthy.length > 0) {
      console.log(chalk.green(`  ✓ ${healthy.length} hook(s) healthy:`));
      for (const name of healthy) {
        console.log(chalk.green(`    ${name}`));
      }
    }

    // P2-16b: the verdict names its bounds in BOTH cases — the count of
    // `hooks run` registrations checked against the count of raw wiring
    // entries in the settings file. Direct-path wiring outside the
    // registered surface is reported, never claimed as covered.
    if (registered.length > 0) {
      console.log(chalk.dim(`  (checked ${registered.length} registered \`hooks run\` entries of ${wiringCount} settings wiring entries; direct-path wiring outside the registered surface is not covered by this check)`));
    }

    if (issues.length > 0) {
      console.log();
      for (const issue of issues) {
        const icon = issue.severity === "error" ? chalk.red("✗") : chalk.yellow("!");
        console.log(`  ${icon} ${chalk.cyan(issue.hook)}: ${issue.issue}`);
      }
    }

    if (issues.length === 0 && registered.length > 0) {
      console.log(chalk.green(`\n  All ${healthy.length} registered hook(s) healthy`));
    } else if (issues.some((i) => i.severity === "error")) {
      process.exitCode = 1;
    }

    console.log();
  });

// Update command
program
  .command("update")
  .argument("[hooks...]", "Hooks to update (defaults to all installed)")
  .option("-g, --global", "Update global hooks", false)
  .option("-p, --project", "Update project hooks", false)
  .option("-j, --json", "Output as JSON", false)
  .description("Re-register hooks (picks up new package version), refresh lock pins, or install a pinned registry version (<name>@<version>)")
  .action(async (hooks: string[], options: { global?: boolean; project?: boolean; json: boolean }) => {
    const scope = resolveScope(options);
    const installed = getInstalledHooks(scope);
    const toUpdate = hooks.length > 0 ? hooks : installed;

    if (toUpdate.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ updated: [], error: "No hooks installed" }));
      } else {
        console.log(chalk.dim("No hooks installed to update."));
      }
      process.exitCode = 1;
      return;
    }

    const { resolveHook } = await import("../lib/resolve.js");
    const { sha256File, setPinnedHook, upsertHookRecord } = await import("../lib/store.js");
    const { getDb } = await import("../db/index.js");
    const { resolveHooksTransport } = await import("../lib/transport.js");
    const { isCustomSource } = await import("../lib/custom-install.js");
    const { HOOK_NAME_RE } = await import("../lib/manifest.js");

    // Only a BARE <name>@<version> is a pin; URLs and local paths are
    // custom sources, never pinned registry requests (general reviewer P2).
    function parseNameVersion(arg: string): { name: string; version: string } | null {
      if (isCustomSource(arg)) return null;
      const at = arg.lastIndexOf("@");
      if (at <= 0 || at === arg.length - 1) return null;
      const name = arg.slice(0, at);
      const version = arg.slice(at + 1);
      if (!HOOK_NAME_RE.test(name)) return null;
      // P2-8 (round 2): the SHARED semver pattern — the CLI previously
      // duplicated a divergent regex that rejected prerelease+build
      // combinations (1.2.3-beta.1+meta) the rest of the stack accepts.
      if (!SEMVER_PATTERN.test(version)) return null;
      return { name, version };
    }

    const results: any[] = [];
    for (const arg of toUpdate) {
      const pinned = parseNameVersion(arg);
      if (pinned) {
        // Pinned-version update: fetch the exact version from the remote
        // registry, verify sha, pin, then re-register in settings (QA-2).
        try {
          const transport = resolveHooksTransport();
          if (transport.mode !== "remote" || !transport.authority) {
            throw new Error(`Cannot update '${arg}': no remote registry configured (set HASNA_HOOKS_API_URL and HASNA_HOOKS_API_KEY, or opt into local mode with HASNA_HOOKS_LOCAL=1)`);
          }
          const { origin, apiKey } = transport.authority;
          const { fetchPinnedHook } = await import("../lib/sync.js");
          const pinnedInstall = await fetchPinnedHook(pinned.name, pinned.version, origin, apiKey);
          const registered = installHook(pinnedInstall.name, { scope, overwrite: true });
          if (!registered.success) {
            results.push({ hook: arg, success: false, error: registered.error ?? "registration failed" });
            continue;
          }
          results.push({
            hook: pinnedInstall.name,
            success: true,
            pinned: { version: pinnedInstall.version, sha256: pinnedInstall.sha256, source: pinnedInstall.source },
          });
        } catch (error) {
          results.push({ hook: arg, success: false, error: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }
      if (!installed.includes(arg)) {
        results.push({ hook: arg, success: false, error: "Not installed" });
        continue;
      }
      const result = installHook(arg, { scope, overwrite: true });
      const resolved = resolveHook(arg);
      if (result.success && resolved) {
        const hash = await sha256File(resolved.scriptPath);
        setPinnedHook(resolved.name, { version: resolved.version, sha256: hash, source: resolved.source });
        upsertHookRecord(getDb(), {
          name: resolved.name,
          version: resolved.version,
          sha256: hash,
          source_type: resolved.source,
          last_verified_at: new Date().toISOString(),
        });
        results.push({ ...result, pinned: { version: resolved.version, sha256: hash } });
        continue;
      }
      results.push(result);
    }

    if (options.json) {
      console.log(JSON.stringify({
        updated: results.filter((r) => r.success).map((r) => r.hook),
        failed: results.filter((r) => !r.success).map((r) => ({ hook: r.hook, error: r.error })),
      }));
      // Fail closed for automation: any requested update that failed is a
      // non-zero exit, in both output modes (general reviewer P2-6).
      if (results.some((r) => !r.success)) {
        process.exitCode = 1;
      }
      return;
    }

    console.log(chalk.bold("\nUpdating hooks...\n"));
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`✓ ${result.hook} updated`) + (result.pinned ? chalk.dim(` (pinned ${result.pinned.version})`) : ""));
      } else {
        console.log(chalk.red(`✗ ${result.hook}: ${result.error}`));
      }
    }
    if (results.some((r) => !r.success)) {
      process.exitCode = 1;
    }
  });

// Docs command
program
  .command("docs")
  .argument("[hook]", "Hook name (shows general docs if omitted)")
  .option("--verbose", "Print full hook README content", false)
  .option("-j, --json", "Output as JSON", false)
  .description("Show documentation for hooks")
  .action((hook: string | undefined, options: { verbose: boolean; json: boolean }) => {
    if (hook) {
      const meta = getHook(hook);
      if (!meta) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Hook '${hook}' not found` }));
        } else {
          console.log(chalk.red(`Hook '${hook}' not found`));
        }
        // P2-13: a not-found docs lookup is an error — nonzero exit.
        process.exitCode = 1;
        return;
      }

      const hookPath = getHookPath(hook);
      const readmePath = join(hookPath, "README.md");
      let readme = "";
      if (existsSync(readmePath)) {
        readme = readFileSync(readmePath, "utf-8");
      }

      if (options.json) {
        console.log(JSON.stringify({ ...meta, readme }));
        return;
      }

      console.log(chalk.bold(`\n${meta.displayName} v${meta.version}\n`));
      console.log(`  ${meta.description}\n`);
      console.log(chalk.bold("  Configuration:"));
      console.log(`    Event:    ${meta.event}`);
      console.log(`    Matcher:  ${meta.matcher || "(all tools)"}`);
      console.log(`    Command:  hooks run ${meta.name}`);
      console.log();
      console.log(chalk.bold("  Install:"));
      console.log(`    hooks install ${meta.name}            # global`);
      console.log(`    hooks install ${meta.name} --project   # project only`);
      console.log();

      if (readme && options.verbose) {
        console.log(chalk.bold("  README:\n"));
        for (const line of readme.split("\n")) {
          console.log(`    ${line}`);
        }
      } else if (readme) {
        const preview = readmePreview(readme);
        if (preview) {
          console.log(chalk.bold("  README Preview:\n"));
          console.log(`    ${preview}\n`);
        }
        console.log(chalk.dim(`  README has ${readme.split("\n").length} lines. Use hooks docs ${meta.name} --verbose for the full README, or --json for machine-readable output.`));
      }
      return;
    }

    // General docs
    const generalDocs = {
      overview: "Hooks are scripts that run at specific points in an AI coding agent session. Install @hasna/hooks globally, then register hooks — no files are copied to your project.",
      events: {
        SessionStart: "Fires when a session starts or resumes. Codewith can inject context via hookSpecificOutput.additionalContext.",
        UserPromptSubmit: "Codewith-native event when a user prompt is submitted; can block obvious injection attempts.",
        PreToolUse: "Fires before a tool executes. Can block the operation by returning { \"decision\": \"block\" }.",
        PostToolUse: "Fires after a tool executes. Runs asynchronously, cannot block.",
        Stop: "Fires at turn end in Codewith and when other agents finish responding. Useful for notifications and cleanup.",
        Notification: "Fires on notification events like context compaction.",
        SessionEnd: "Fires when a session terminates. Useful for cleanup and final announcements.",
      },
      installation: {
        global: "hooks install gitguard",
        project: "hooks install gitguard --project",
        codewith: "hooks install session-start --target codewith  # emits TOML for configs to apply",
        category: "hooks install --category \"Git Safety\"",
        all: "hooks install --all",
      },
      management: {
        list: "hooks list",
        listInstalled: "hooks list --installed",
        search: "hooks search <query>",
        info: "hooks info <name>",
        remove: "hooks remove <name>",
        update: "hooks update",
        doctor: "hooks doctor",
        docs: "hooks docs <name>",
      },
      howItWorks: {
        install: "bun install -g @hasna/hooks",
        register: "hooks install gitguard → writes to ~/.claude/settings.json; hooks install session-start --target codewith emits a TOML fragment",
        execution: "Agent runs 'hooks run gitguard' → executes hook from global package",
        noFileCopy: "No files are copied to your project. Hooks run from the global @hasna/hooks package.",
      },
    };

    if (options.json) {
      console.log(JSON.stringify(generalDocs));
      return;
    }

    console.log(chalk.bold("\n@hasna/hooks Documentation\n"));

    console.log(chalk.bold("  Overview\n"));
    console.log(`    ${generalDocs.overview}\n`);

    console.log(chalk.bold("  How It Works\n"));
    for (const [label, desc] of Object.entries(generalDocs.howItWorks)) {
      console.log(`    ${chalk.dim(label + ":")}  ${desc}`);
    }

    console.log(chalk.bold("\n  Hook Events\n"));
    for (const [event, desc] of Object.entries(generalDocs.events)) {
      console.log(`    ${chalk.cyan(event)}`);
      console.log(`      ${desc}\n`);
    }

    console.log(chalk.bold("  Installation\n"));
    for (const [label, cmd] of Object.entries(generalDocs.installation)) {
      console.log(`    ${chalk.dim(label + ":")}  ${cmd}`);
    }

    console.log(chalk.bold("\n  Management\n"));
    for (const [label, cmd] of Object.entries(generalDocs.management)) {
      console.log(`    ${chalk.dim(label + ":")}  ${cmd}`);
    }

    console.log(chalk.bold("\n  Hook-Specific Docs\n"));
    console.log(`    hooks docs <name>              Compact hook docs`);
    console.log(`    hooks docs <name> --verbose    Full hook README`);
    console.log(`    hooks docs --json              Machine-readable documentation`);
    console.log();
  });

// Upgrade command — self-update the @hasna/hooks package
program
  .command("upgrade")
  .option("-c, --check", "Check for updates without installing", false)
  .option("-j, --json", "Output as JSON", false)
  .description("Update the @hasna/hooks package to the latest version")
  .action(async (options: { check: boolean; json: boolean }) => {
    const current = pkg.version;

    // Detect package manager: prefer bun, fallback to npm
    let pm = "npm";
    try {
      const which = Bun.spawnSync(["which", "bun"]);
      if (which.exitCode === 0) pm = "bun";
    } catch {}

    if (options.check) {
      // Fetch latest version from npm registry
      const proc = Bun.spawnSync(["npm", "view", "@hasna/hooks", "version"]);
      const latest = new TextDecoder().decode(proc.stdout).trim();

      if (!latest) {
        if (options.json) {
          console.log(JSON.stringify({ error: "Failed to fetch latest version" }));
        } else {
          console.log(chalk.red("Failed to fetch latest version from npm registry."));
        }
        process.exit(1);
      }

      const upToDate = current === latest;
      if (options.json) {
        console.log(JSON.stringify({ current, latest, upToDate }));
      } else if (upToDate) {
        console.log(chalk.green(`✓ Already on latest version (${current})`));
      } else {
        console.log(chalk.yellow(`Update available: ${current} → ${latest}`));
        console.log(chalk.dim(`  Run: hooks upgrade`));
      }
      return;
    }

    // Perform the upgrade
    const installCmd = pm === "bun"
      ? ["bun", "install", "-g", "@hasna/hooks@latest"]
      : ["npm", "install", "-g", "@hasna/hooks@latest"];

    if (!options.json) {
      console.log(chalk.bold(`\nUpgrading @hasna/hooks (${pm})...\n`));
      console.log(chalk.dim(`  $ ${installCmd.join(" ")}\n`));
    }

    const proc = Bun.spawn(installCmd, {
      stdout: options.json ? "pipe" : "inherit",
      stderr: options.json ? "pipe" : "inherit",
      env: process.env,
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      if (options.json) {
        console.log(JSON.stringify({ current, updated: false, error: `${pm} exited with code ${exitCode}` }));
      } else {
        console.log(chalk.red(`\n✗ Upgrade failed (exit code ${exitCode})`));
      }
      process.exit(exitCode);
    }

    // Check new version
    const versionProc = Bun.spawnSync(["npm", "view", "@hasna/hooks", "version"]);
    const latest = new TextDecoder().decode(versionProc.stdout).trim() || "unknown";

    if (options.json) {
      console.log(JSON.stringify({ current, latest, updated: true }));
    } else {
      console.log(chalk.green(`\n✓ Upgraded: ${current} → ${latest}`));
    }
  });

// Profile export command
program
  .command("profile-export")
  .description("Export all agent profiles as JSON (for backup/cross-machine setup)")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .option("-j, --json", "Output as JSON (default: true)", false)
  .action(async (options: { output?: string; json: boolean }) => {
    const profiles = exportProfiles();
    const json = JSON.stringify(profiles, null, 2);
    if (options.output) {
      const { writeFileSync } = await import("fs");
      writeFileSync(options.output, json + "\n");
      console.log(chalk.green(`✓ Exported ${profiles.length} profile(s) to ${options.output}`));
    } else {
      console.log(json);
    }
  });

// Profile import command
program
  .command("profile-import")
  .argument("<file>", "JSON file to import profiles from (use - for stdin)")
  .description("Import agent profiles from a JSON export file")
  .option("-j, --json", "Output result as JSON", false)
  .action(async (file: string, options: { json: boolean }) => {
    let raw: string;
    if (file === "-") {
      raw = await new Response(Bun.stdin.stream()).text();
    } else {
      const { readFileSync } = await import("fs");
      try {
        raw = readFileSync(file, "utf-8");
      } catch {
        if (options.json) {
          console.log(JSON.stringify({ error: `Cannot read file: ${file}` }));
        } else {
          console.log(chalk.red(`✗ Cannot read file: ${file}`));
        }
        return;
      }
    }

    let profiles: any[];
    try {
      const parsed = JSON.parse(raw);
      profiles = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      if (options.json) {
        console.log(JSON.stringify({ error: "Invalid JSON" }));
      } else {
        console.log(chalk.red("✗ Invalid JSON"));
      }
      return;
    }

    const result = importProfiles(profiles);
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(chalk.green(`✓ Imported ${result.imported} profile(s)`));
      if (result.skipped > 0) console.log(chalk.dim(`  Skipped ${result.skipped} (already exist or invalid)`));
    }
  });

// Log command group — query hook events from SQLite
const logCmd = program
  .command("log")
  .description(`Query hook event logs from SQLite (${getReportedDbPath()})`);

logCmd
  .command("list")
  .description("List hook events")
  .option("--hook <name>", "Filter by hook name")
  .option("--session <id>", "Filter by session ID")
  .option("-n, --limit <n>", "Number of rows to show", "50")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { hook?: string; session?: string; limit: string; json: boolean }) => {
    const { getDb } = await import("../db/index.js");
    const db = getDb();
    const limit = parseInt(options.limit) || 50;

    let sql = "SELECT * FROM hook_events WHERE 1=1";
    const params: string[] = [];

    if (options.hook) { sql += " AND hook_name = ?"; params.push(options.hook); }
    if (options.session) { sql += " AND session_id LIKE ?"; params.push(`${options.session}%`); }
    sql += " ORDER BY timestamp DESC LIMIT ?";
    params.push(String(limit));

    const rows = db.query(sql).all(...params) as any[];
    const projected = projectLogRows(rows);

    if (options.json) { console.log(JSON.stringify(projected, null, 2)); return; }
    if (projected.length === 0) { console.log(chalk.dim("No events found.")); return; }

    console.log(chalk.bold(`\n  Hook Events (${projected.length})\n`));
    for (const row of projected) {
      const ts = row.timestamp.slice(0, 19).replace("T", " ");
      const err = row.error ? chalk.red(` ERR: ${truncateText(row.error, 60)}`) : "";
      const tool = row.tool_name ? chalk.dim(` [${row.tool_name}]`) : "";
      console.log(`  ${chalk.dim(ts)}  ${chalk.cyan(row.hook_name.padEnd(14))}${tool}${err}`);
    }
    console.log(chalk.dim("\n  Compact rows shown. Use --json for full event records or --limit <n> to change row count."));
  });

logCmd
  .command("search <text>")
  .description("Search hook events by tool_input or error text")
  .option("-n, --limit <n>", "Number of rows to show", "50")
  .option("-j, --json", "Output as JSON", false)
  .action(async (text: string, options: { limit: string; json: boolean }) => {
    const { getDb } = await import("../db/index.js");
    const db = getDb();
    const limit = parseInt(options.limit) || 50;
    const q = `%${text}%`;
    const rows = db.query(
      "SELECT * FROM hook_events WHERE tool_input LIKE ? OR error LIKE ? ORDER BY timestamp DESC LIMIT ?"
    ).all(q, q, limit) as any[];
    const projected = projectLogRows(rows);

    if (options.json) { console.log(JSON.stringify(projected, null, 2)); return; }
    if (projected.length === 0) { console.log(chalk.dim(`No events matching "${text}".`)); return; }

    console.log(chalk.bold(`\n  Search results for "${text}" (${projected.length})\n`));
    for (const row of projected) {
      const ts = row.timestamp.slice(0, 19).replace("T", " ");
      const snippet = truncateText(row.tool_input || row.error || "", 80);
      console.log(`  ${chalk.dim(ts)}  ${chalk.cyan(row.hook_name.padEnd(14))}  ${chalk.dim(snippet)}`);
    }
    console.log(chalk.dim("\n  Compact rows shown. Use --json for full event records or --limit <n> to change row count."));
  });

logCmd
  .command("tail")
  .description("Show most recent hook events")
  .option("-n <n>", "Number of rows", "20")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { n: string; json: boolean }) => {
    const { getDb } = await import("../db/index.js");
    const db = getDb();
    const limit = parseInt(options.n) || 20;
    const rows = db.query(
      "SELECT * FROM hook_events ORDER BY timestamp DESC LIMIT ?"
    ).all(limit) as any[];
    const projected = projectLogRows(rows);

    if (options.json) { console.log(JSON.stringify(projected, null, 2)); return; }
    if (projected.length === 0) { console.log(chalk.dim("No events yet.")); return; }

    console.log(chalk.bold(`\n  Last ${projected.length} events\n`));
    for (const row of projected) {
      const ts = row.timestamp.slice(0, 19).replace("T", " ");
      const err = row.error ? chalk.red(` ✗ ${truncateText(row.error, 60)}`) : "";
      const tool = row.tool_name ? chalk.dim(` [${row.tool_name}]`) : "";
      console.log(`  ${chalk.dim(ts)}  ${chalk.cyan(row.hook_name.padEnd(14))}${tool}${err}`);
    }
    console.log(chalk.dim("\n  Compact rows shown. Use --json for full event records or -n <n> to change row count."));
  });

logCmd
  .command("errors")
  .description("Show hook events that contain errors")
  .option("--since <duration>", "Only show errors since this duration (e.g. 1h, 30m, 7d)", "24h")
  .option("-n, --limit <n>", "Number of rows to show", "50")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { since: string; limit: string; json: boolean }) => {
    const { getDb } = await import("../db/index.js");
    const db = getDb();
    const limit = parseInt(options.limit) || 50;

    // Parse duration string to milliseconds
    function parseDuration(s: string): number {
      const m = s.match(/^(\d+)(s|m|h|d)$/);
      if (!m) return 24 * 60 * 60 * 1000;
      const n = parseInt(m[1]);
      switch (m[2]) {
        case "s": return n * 1000;
        case "m": return n * 60 * 1000;
        case "h": return n * 60 * 60 * 1000;
        case "d": return n * 24 * 60 * 60 * 1000;
        default: return 24 * 60 * 60 * 1000;
      }
    }

    const since = new Date(Date.now() - parseDuration(options.since)).toISOString();
    const rows = db.query(
      "SELECT * FROM hook_events WHERE error IS NOT NULL AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?"
    ).all(since, limit) as any[];
    const projected = projectLogRows(rows);

    if (options.json) { console.log(JSON.stringify(projected, null, 2)); return; }
    if (projected.length === 0) { console.log(chalk.dim(`No errors in the last ${options.since}.`)); return; }

    console.log(chalk.bold(`\n  Errors (last ${options.since}, ${projected.length} found)\n`));
    for (const row of projected) {
      const ts = row.timestamp.slice(0, 19).replace("T", " ");
      console.log(`  ${chalk.dim(ts)}  ${chalk.cyan(row.hook_name.padEnd(14))}  ${chalk.red(truncateText(row.error, 100))}`);
    }
    console.log(chalk.dim("\n  Compact rows shown. Use --json for full event records or --limit <n> to change row count."));
  });

logCmd
  .command("clear")
  .description("Delete hook event logs")
  .option("--hook <name>", "Only delete events for this hook")
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (options: { hook?: string; yes: boolean }) => {
    const { getDb } = await import("../db/index.js");
    const db = getDb();

    const countRow = options.hook
      ? db.query("SELECT COUNT(*) as n FROM hook_events WHERE hook_name = ?").get(options.hook) as any
      : db.query("SELECT COUNT(*) as n FROM hook_events").get() as any;
    const count = countRow?.n ?? 0;

    if (count === 0) { console.log(chalk.dim("Nothing to clear.")); return; }

    if (!options.yes) {
      const scope = options.hook ? `hook "${options.hook}"` : "all hooks";
      console.log(chalk.yellow(`About to delete ${count} event(s) for ${scope}.`));
      console.log(chalk.dim("Re-run with --yes to confirm."));
      return;
    }

    if (options.hook) {
      db.run("DELETE FROM hook_events WHERE hook_name = ?", [options.hook]);
    } else {
      db.run("DELETE FROM hook_events");
    }

    console.log(chalk.green(`✓ Cleared ${count} event(s).`));
  });

const storageCmd = program
  .command("storage")
  .description("Sync local hook data with storage PostgreSQL");

storageCmd
  .command("status")
  .description("Show storage sync status")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { json: boolean }) => {
    const { getStorageStatus } = await import("../storage.js");
    const status = getStorageStatus();
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(chalk.bold("\n  Storage Status\n"));
    console.log(`  Configured: ${status.configured ? chalk.green(`yes (${status.activeEnv})`) : chalk.red("no")}`);
    console.log(`  Backend:    ${status.backend}`);
    console.log(`  Tables:     ${status.tables.join(", ")}`);
    console.log(`  Sync rows:  ${status.sync.length}`);
  });

storageCmd
  .command("push")
  .description("Push local hook data to storage PostgreSQL")
  .option("-t, --tables <tables>", "Comma-separated table names")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { tables?: string; json: boolean }) => {
    try {
      const { parseStorageTables, storagePush } = await import("../storage.js");
      const results = await storagePush({ tables: parseStorageTables(options.tables) });
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      const written = results.reduce((sum, result) => sum + result.rowsWritten, 0);
      console.log(chalk.green(`✓ Pushed ${written} row(s)`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) console.log(JSON.stringify({ error: message }));
      else console.error(chalk.red(`✗ ${message}`));
      process.exitCode = 1;
    }
  });

storageCmd
  .command("pull")
  .description("Pull hook data from storage PostgreSQL to local SQLite")
  .option("-t, --tables <tables>", "Comma-separated table names")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { tables?: string; json: boolean }) => {
    try {
      const { parseStorageTables, storagePull } = await import("../storage.js");
      const results = await storagePull({ tables: parseStorageTables(options.tables) });
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      const written = results.reduce((sum, result) => sum + result.rowsWritten, 0);
      console.log(chalk.green(`✓ Pulled ${written} row(s)`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) console.log(JSON.stringify({ error: message }));
      else console.error(chalk.red(`✗ ${message}`));
      process.exitCode = 1;
    }
  });

storageCmd
  .command("sync")
  .description("Bidirectional storage sync: pull then push")
  .option("-t, --tables <tables>", "Comma-separated table names")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { tables?: string; json: boolean }) => {
    try {
      const { parseStorageTables, storageSync } = await import("../storage.js");
      const result = await storageSync({ tables: parseStorageTables(options.tables) });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const pulled = result.pull.reduce((sum, entry) => sum + entry.rowsWritten, 0);
      const pushed = result.push.reduce((sum, entry) => sum + entry.rowsWritten, 0);
      console.log(chalk.green(`✓ Synced ${pulled} pulled row(s), ${pushed} pushed row(s)`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) console.log(JSON.stringify({ error: message }));
      else console.error(chalk.red(`✗ ${message}`));
      process.exitCode = 1;
    }
  });

// Trust command — re-pin a hook's script hash after a mismatch refusal
program
  .command("trust")
  .argument("<hook>", "Hook to trust")
  .option("-j, --json", "Output as JSON", false)
  .description("Trust the current script content of a hook (re-pins its sha256)")
  .action(async (hook: string, options: { json: boolean }) => {
    const { resolveHook } = await import("../lib/resolve.js");
    const { retrustHook } = await import("../lib/store.js");
    const resolved = resolveHook(hook);
    if (!resolved) {
      if (options.json) console.log(JSON.stringify({ error: `Hook '${hook}' not found` }));
      else console.log(chalk.red(`Hook '${hook}' not found`));
      return;
    }
    const result = retrustHook(resolved.name, resolved.scriptPath, resolved.version, resolved.source);
    if (options.json) {
      console.log(JSON.stringify({ ok: true, hook: resolved.name, version: resolved.version, sha256: result.actual, source: resolved.source }));
      return;
    }
    console.log(chalk.green(`✓ Trusted '${resolved.name}' v${resolved.version} (${resolved.source})`));
    console.log(chalk.dim(`  sha256 ${result.actual}`));
  });

// Serve command — local registry HTTP API
program
  .command("serve")
  .option("-p, --port <port>", "Port (default 39428)")
  .option("--host <host>", "Host to bind (default 127.0.0.1)")
  .description("Serve the local hook registry over HTTP (catalog, artifacts, lock). The publish API key resolves from the @hasna/contracts chain per request (HASNA_HOOKS_API_KEY, the Keychain item hasna.credentials.hooks.api-key, or ~/.hasna/hooks/config/credentials) — there is deliberately no --api-key flag (P1-8).")
  .action(async (options: { port?: string; host?: string }) => {
    const { startServeServer } = await import("../serve.js");
    startServeServer({
      port: options.port ? parseInt(options.port, 10) : undefined,
      host: options.host,
    });
  });

// Sync command — reconcile the local store against the registry
program
  .command("sync")
  .option("--dry-run", "Print the plan without changing anything", false)
  .option("-j, --json", "Output as JSON", false)
  .description("Sync local hooks with the remote registry (or bundled registry when no registry credential resolves and local mode is opted into)")
  .action(async (options: { dryRun: boolean; json: boolean }) => {
    const { syncHooks, planSync } = await import("../lib/sync.js");
    try {
      // P2-16a: the dry-run path runs through syncHooks({dryRun:true}) so the
      // returned plan carries dryRun:true — planSync alone used to hardcode
      // false and the CLI then printed "✓ Synced" during a --dry-run.
      const plan = options.dryRun ? await syncHooks({ dryRun: true }) : await syncHooks();
      const diff = plan.diff;
      if (options.json) {
        console.log(JSON.stringify({ dry_run: plan.dryRun, api_url: plan.apiUrl ?? null, diff }));
        return;
      }
      const source = plan.apiUrl ? plan.apiUrl : "bundled registry";
      console.log(chalk.bold(`\nHook sync (${source})${plan.dryRun ? " — dry run" : ""}\n`));
      if (diff.added.length > 0) {
        console.log(chalk.green(`  + ${diff.added.length} to add:`));
        for (const name of diff.added) console.log(chalk.green(`    ${name}`));
      }
      if (diff.updated.length > 0) {
        console.log(chalk.yellow(`  ~ ${diff.updated.length} to update:`));
        for (const name of diff.updated) console.log(chalk.yellow(`    ${name}`));
      }
      if (diff.skipped.length > 0) {
        console.log(chalk.dim(`  - ${diff.skipped.length} not in remote lock (left untouched)`));
      }
      console.log(chalk.dim(`  = ${diff.unchanged.length} unchanged`));
      if (plan.dryRun) console.log(chalk.dim("\n  Dry run: nothing was written."));
      else console.log(chalk.green(`\n✓ Synced (${diff.added.length} added, ${diff.updated.length} updated, ${diff.unchanged.length} unchanged)`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ error: message, changed: false }));
      } else {
        console.error(chalk.red(`✗ ${message}`));
        console.error(chalk.dim("  Nothing was changed (fail-closed)."));
      }
      process.exitCode = 1;
    }
  });

// cf command — Cloudflare registry provisioning
program
  .command("cf")
  .description("Provision and deploy the hooks registry to Cloudflare")
  .option("--deploy", "Provision D1 + R2 via the Cloudflare API", true)
  .option("--dry-run", "Print the plan without calling the Cloudflare API", false)
  .option("--account-id <id>", "Cloudflare account id (defaults to CF_ACCOUNT_ID env)")
  .option("--database-name <name>", "D1 database name (default hooks-registry)")
  .option("--bucket-name <name>", "R2 bucket name (default hooks-registry-artifacts)")
  .option("--token-file <path>", "Read the API token from a file (defaults to CF_API_TOKEN env)")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { dryRun: boolean; accountId?: string; databaseName?: string; bucketName?: string; tokenFile?: string; json: boolean }) => {
    const token = readToken(options.tokenFile);
    const accountId = options.accountId ?? process.env.CF_ACCOUNT_ID;
    if (!options.dryRun) {
      if (!token) {
        console.error(chalk.red("CF_API_TOKEN is not set (or --token-file path is unreadable)."));
        console.error(chalk.dim("  Resolve it from the vault, never paste the value:"));
        console.error(chalk.dim("    secrets exec <vault-key> --as CF_API_TOKEN -- hooks cf deploy"));
        process.exit(1);
      }
      if (!accountId) {
        console.error(chalk.red("CF_ACCOUNT_ID is not set (or pass --account-id)."));
        process.exit(1);
      }
    }
    const { provisionCloudflareResources } = await import("../cf/provision.js");
    const result = await provisionCloudflareResources({
      token: token ?? "",
      accountId: accountId ?? "",
      databaseName: options.databaseName ?? "hooks-registry",
      bucketName: options.bucketName ?? "hooks-registry-artifacts",
      dryRun: options.dryRun,
    });
    if (options.json) {
      console.log(JSON.stringify({ dry_run: options.dryRun, ...result }));
      return;
    }
    if (options.dryRun) {
      console.log(chalk.bold("\ncf deploy dry run — would provision:\n"));
    } else {
      console.log(chalk.bold("\nCloudflare provisioning complete:\n"));
      console.log(`  ${chalk.dim("D1:")}    ${result.d1Created ? chalk.green(`created '${options.databaseName ?? "hooks-registry"}'`) : chalk.dim(`exists (${result.d1DatabaseId})`)}`);
      console.log(`  ${chalk.dim("R2:")}    ${result.r2Created ? chalk.green(`created '${options.bucketName ?? "hooks-registry-artifacts"}'`) : chalk.dim("exists")}`);
    }
    console.log(`\n  ${chalk.bold("Worker upload (run these with wrangler):")}`);
    for (const cmd of result.commands) {
      console.log(`    ${cmd}`);
    }
    console.log();
    console.log(chalk.dim("  Worker upload is not performed by this command — the worker needs the workerd"));
    console.log(chalk.dim("  target, which only wrangler can bundle. Copy src/cf/wrangler.toml.example to"));
    console.log(chalk.dim("  wrangler.toml, fill in the D1 database id, then run the commands above."));
    console.log();
  });

// Migrate command — apply PostgreSQL migrations to the storage database.
// The deploy lane runs this as the one-shot migration step (`hooks migrate`)
// against the shared RDS, the same shape as `logs db migrate` for @hasna/logs.
program
  .command("migrate")
  .description("Apply PostgreSQL migrations to the storage database (HASNA_HOOKS_DATABASE_URL)")
  .option("-j, --json", "Output as JSON", false)
  .action(async (options: { json: boolean }) => {
    try {
      const { getStoragePg, runStorageMigrations } = await import("../storage.js");
      const remote = await getStoragePg();
      try {
        await runStorageMigrations(remote);
      } finally {
        await remote.close();
      }
      if (options.json) {
        console.log(JSON.stringify({ ok: true }));
        return;
      }
      console.log(chalk.green("✓ PostgreSQL migrations applied"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) console.log(JSON.stringify({ error: message }));
      else console.error(chalk.red(`✗ ${message}`));
      process.exitCode = 1;
    }
  });

// MCP server command
program
  .command("mcp")
  .option("-s, --stdio", "Use stdio transport (one process per agent)", false)
  .option("--sse", "Use legacy SSE transport (port 39427)", false)
  .option("--http", "Use Streamable HTTP transport (explicit; this is also the default)", false)
  .option("-p, --port <port>", "Port for HTTP/SSE transport (defaults to 8847 for HTTP, 39427 for SSE)")
  .description("Start MCP server for AI agent integration (default: shared Streamable HTTP)")
  .action(async (options: { stdio: boolean; sse: boolean; http: boolean; port?: string }) => {
    if (options.stdio) {
      const { startStdioServer } = await import("../mcp/server.js");
      await startStdioServer();
    } else if (options.sse) {
      const { startSSEServer } = await import("../mcp/server.js");
      // P1-2: default bind is 127.0.0.1; non-loopback needs
      // HASNA_HOOKS_MCP_TOKEN/HOOKS_MCP_TOKEN and startSSEServer refuses
      // without one. No --host flag exists on purpose.
      await startSSEServer({ port: options.port ? parseInt(options.port) : 39427 });
    } else {
      // Default: shared Streamable HTTP server (one process per MCP, many agents).
      const { createHooksServer } = await import("../mcp/server.js");
      const { resolveMcpHttpPort, startMcpHttpServer } = await import("../mcp/http.js");
      const args = options.port ? ["--port", options.port] : [];
      startMcpHttpServer({ name: "hooks", port: resolveMcpHttpPort(args), buildServer: createHooksServer });
    }
  });
registerEventsCommands(program, { source: "hooks" });

// ── Fail-closed transport gate (fleet doctrine, 2026-09-04) ─────────────────
//
// The `hooks` CLI manages hook state for the hosted hooks registry API. A run
// WITHOUT a resolved registry credential must FAIL CLOSED — never silently
// serve the local SQLite store (~/.hasna/hooks/hooks.db) and exit 0 as a false
// green. Local mode (bundled registry + local store) remains available, but
// only as an explicit opt-in: HASNA_HOOKS_LOCAL=1 (alias HOOKS_LOCAL=1).
//
// The registry authority and its credential resolve through the ONE
// @hasna/contracts chain (hasna/apps#1720), as a STRICT pair: a URL without a
// key is a refusal, not half-open progress. The gate below is deliberately
// cheap for the run-hot surfaces — it answers the env dictionary and the
// opt-in without touching the Keychain, so `hooks run` (which agents invoke on
// every hook event), `hooks mcp` and `hooks serve` never pay a per-invocation
// `security` spawn. Commands that resolve the registry themselves (sync,
// pinned install/update) re-resolve the full chain per call.
//
// Commands that are local/operator/runtime surfaces BY DESIGN never stand in
// for the hosted API and may run without it:
//   - run            execute a pinned local hook script (agents call this)
//   - serve          serve the LOCAL registry over HTTP (self-hosted server)
//   - mcp            local MCP server for agent integration
//   - cf             provision a Cloudflare registry (operator tooling)
//   - migrate        apply PostgreSQL migrations to the storage database
//   - init           register a local agent profile / print registry config
//   - profile-export/import   local agent-profile JSON files
//   - channels, events        @hasna/events surfaces (own env contract)
// Help/version output is informational and stays available.
//
// Everything else fails closed WITHOUT a resolved credential or opt-in —
// including UNKNOWN tokens: `interactive` is registered with `isDefault: true`,
// so commander routes any token that matches no command to the interactive TUI,
// which browses the local catalog/store. An unknown token is therefore not a
// commander "unknown command" error here; it would silently open local mode,
// so it must fail closed like every other local-serving command.

const API_INDEPENDENT_COMMANDS = new Set([
  "run",
  "serve",
  "mcp",
  "cf",
  "migrate",
  "init",
  "profile-export",
  "profile-import",
  "channels",
  "events",
]);

function failClosedForMissingApiEnv(detail?: string): never {
  console.error(
    chalk.red(
      "hooks: no registry credential resolved and local mode is not explicitly enabled.\n"
        + "The remote registry requires a STRICT pair — set HASNA_HOOKS_API_URL and HASNA_HOOKS_API_KEY, or the\n"
        + "Keychain items hasna.credentials.hooks.api-url / .api-key, or ~/.hasna/hooks/config/credentials.\n"
        + "config.json (api_url / api_key_ref) is RETIRED and no longer read. Or set\n"
        + "HASNA_HOOKS_LOCAL=1 to explicitly opt into local mode (bundled registry + local store).\n"
        + (detail ? `${detail}\n` : "")
        + "Refusing to silently fall back to local storage.",
    ),
  );
  process.exit(1);
}

/** First non-option argv token: the command being run (or null for the bare CLI). */
function firstCommandToken(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
}

function enforceTransportGate(): void {
  const argv = process.argv.slice(2);
  // Help/version output is informational and never a false green. The "help"
  // token is commander's built-in help subcommand, handled before any default
  // command matching, so it also just prints help.
  if (argv.some((arg) => arg === "-h" || arg === "--help" || arg === "-V" || arg === "--version")) return;
  const token = firstCommandToken(argv);
  if (token === "help") return;
  if (token !== null && API_INDEPENDENT_COMMANDS.has(token)) return;

  // A configured environment outranks the opt-in: hosted intent proceeds and
  // the command's own resolution enforces the strict pair (a half-configured
  // URL-only run fails loudly at the command, not here).
  if (hasHooksEnvAuthorityIntent(process.env)) return;
  // Local mode is the deliberate unhosted opt-in, answered WITHOUT the
  // resolver so no Keychain item and no credential file is read for it. The
  // run says so on stderr, once per process.
  if (isHooksLocalOptIn(process.env)) {
    announceHooksLocalMode();
    return;
  }

  // Nothing in the env: the machine's ambient stores (Keychain / disk) may
  // still configure hosted mode — a station needs no inline env prefix. Only
  // registry commands pay for this consultation. A fully unconfigured
  // environment resolves nothing and fails closed. Bare `hooks` (interactive)
  // and unknown tokens fall through to `failClosedForMissingApiEnv` too.
  try {
    const transport = resolveHooksTransport(process.env);
    if (transport.mode !== "remote" || !transport.authority) {
      failClosedForMissingApiEnv();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failClosedForMissingApiEnv(message);
  }
}

enforceTransportGate();
program.parse();
