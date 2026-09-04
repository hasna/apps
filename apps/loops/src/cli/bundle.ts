/**
 * `loops bundle …` - the on-disk half of a loop, and its immutable versions.
 *
 * ## Why a `bundle` noun instead of bare verbs
 *
 * `loops push` and `loops pull` already exist and mean "local SQLite <-> control
 * plane row backfill" (the cutover runbooks call them by name). Silently
 * repurposing them would break those runbooks the day this ships. So the
 * canonical spelling is `loops bundle <verb>`, and the bare verbs dispatch here
 * only when a POSITIONAL BUNDLE NAME is supplied - `loops push demo` is a
 * bundle push, `loops push --apply` is still the row backfill. `loops init`,
 * `loops versions`, `loops pin`, `loops sync` and `loops materialize` are new
 * names with no collision and are registered as plain aliases.
 *
 * ## Exit codes
 *
 *   0  success, or a `--dry-run` that produced a plan
 *   1  generic failure
 *   2  integrity refusal (digest mismatch, unsafe entry, credential in the tree,
 *      drift refused without `--allow-dirty`)
 *   3  conflict (local and remote both moved, version exists, name taken, pin)
 *   4  not found (loop, bundle, or version)
 *   5  scope/authorisation refusal
 *   78 credentials or configuration missing (EX_CONFIG)
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BundleCliError, createBundleApiClient, type BundleApiClient } from "./bundle-client.js";
import {
  assertBundleName,
  BundleIntegrityError,
  BUNDLE_NAME_PATTERN,
  isBundleName,
  LOOP_BUNDLE_SCHEMA,
  LOOP_JSON_FILE,
  MANIFEST_FILE,
  MODE_DATA,
  MODE_DIR,
  serializeBundleManifest,
  SCRIPTS_DIR,
  validateBundleManifest,
  type BundleManifest,
} from "../lib/bundle/manifest.js";
import {
  buildManifest,
  bundleDir,
  bundleRoot,
  definitionCarriesPrompt,
  ensureBundleRoot,
  inspectLocalBundle,
  installBundleTree,
  loopToDefinition,
  parseDefinition,
  readBundleMarker,
  serializeDefinition,
  writeBundleMarker,
  writeBundleSkeleton,
  type LoopBundleDefinition,
} from "../lib/bundle/local.js";
import { collectBundle, packBundleEntries } from "../lib/bundle/pack.js";
import { unpackBundle, verifyArchiveSha256, verifyBundleAgainstManifest } from "../lib/bundle/unpack.js";
import type { Loop } from "../types.js";

interface BundleCliContext {
  json: () => boolean;
  /** Injected by tests. Production resolves the client from the environment. */
  client?: BundleApiClient;
  env?: NodeJS.ProcessEnv;
}

function out(ctx: BundleCliContext, value: unknown, human: string): void {
  if (ctx.json()) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

function client(ctx: BundleCliContext): BundleApiClient {
  return ctx.client ?? createBundleApiClient(ctx.env ?? process.env);
}

/**
 * Wrap an action so every coded failure lands on its documented exit code.
 *
 * `process.exitCode` rather than `process.exit()`: an in-flight stdout write of
 * a large `--json` payload is still buffered when the action returns, and
 * exiting hard truncates it.
 */
function bundleAction<Args extends unknown[]>(ctx: BundleCliContext, fn: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await fn(...args);
    } catch (error) {
      const { code, message, exitCode } = classify(error);
      process.exitCode = exitCode;
      if (ctx.json()) console.log(JSON.stringify({ ok: false, error: { code, message } }, null, 2));
      console.error(`error: ${message}`);
    }
  };
}

function classify(error: unknown): { code: string; message: string; exitCode: number } {
  if (error instanceof BundleCliError) return { code: error.code, message: error.message, exitCode: error.exitCode };
  if (error instanceof BundleIntegrityError) {
    const conflict = error.code === "LOOP_VERSION_EXISTS" || error.code === "BUNDLE_NAME_TAKEN" || error.code === "BUNDLE_LOOP_MISMATCH";
    const notFound = error.code === "LOOP_VERSION_NOT_FOUND";
    return { code: error.code, message: error.message, exitCode: notFound ? 4 : conflict ? 3 : 2 };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "ERROR";
  return { code, message, exitCode: 1 };
}

// ── loop lookup ──────────────────────────────────────────────────────────────

interface RemoteLoop {
  id: string;
  name: string;
  bundleName?: string | null;
  bundlePinnedVersion?: number | null;
  [key: string]: unknown;
}

/**
 * Find the loop an argument names.
 *
 * Three lookups, in this order, because all three spellings are legitimate and
 * only the first is unambiguous by construction:
 *
 *   1. an existing BUNDLE name (the tenant-wide index; unique per tenant),
 *   2. a LOOP name (`GET /v1/loops?name=` - not unique, so an ambiguous name is
 *      a refusal rather than a coin flip),
 *   3. a loop ID (`GET /v1/loops/{id}`).
 *
 * The loop-name step is what makes `loops bundle push <loop-name>` work before
 * the loop has ever been bundled, which is every loop's first push.
 */
async function resolveLoop(api: BundleApiClient, nameOrId: string): Promise<RemoteLoop> {
  const index = (await api.listBundles({ limit: 500 })) as { bundles?: Array<{ bundleName: string; loopId: string; loopName: string; pinnedVersion?: number }> };
  const match = index.bundles?.find((entry) => entry.bundleName === nameOrId);
  if (match) {
    const loop = (await api.getLoop(match.loopId)) as { loop?: RemoteLoop };
    if (loop.loop) return loop.loop;
  }
  const byName = (await api.listLoops({ name: nameOrId, limit: 2 })) as { loops?: RemoteLoop[] };
  const named = (byName.loops ?? []).filter((loop) => loop.name === nameOrId);
  if (named.length > 1) {
    throw new BundleCliError("AMBIGUOUS_NAME", `'${nameOrId}' matches ${named.length} loops; pass a loop id or use --as <bundle-name>`, 3);
  }
  if (named.length === 1) {
    // Re-read by id: the list projection omits the bundle columns this needs.
    const loop = (await api.getLoop(named[0]!.id)) as { loop?: RemoteLoop };
    if (loop.loop) return loop.loop;
    return named[0]!;
  }
  try {
    const direct = (await api.getLoop(nameOrId)) as { loop?: RemoteLoop };
    if (direct.loop) return direct.loop;
  } catch (error) {
    if (!(error instanceof BundleCliError) || error.exitCode !== 4) throw error;
  }
  throw new BundleCliError("LOOP_NOT_FOUND", `no loop or bundle named '${nameOrId}'`, 4);
}

function bundleNameFor(loop: RemoteLoop, override?: string): string {
  const candidate = override ?? loop.bundleName ?? loop.name;
  if (!isBundleName(candidate)) {
    throw new BundleCliError(
      "BUNDLE_NAME_INVALID",
      `'${candidate}' is not a usable bundle name (must match ${BUNDLE_NAME_PATTERN.source}); rename the loop or pass --as <bundle-name>`,
      2,
    );
  }
  return candidate;
}

// ── local helpers ────────────────────────────────────────────────────────────

function templateDefinition(name: string, template: "command" | "agent"): LoopBundleDefinition {
  const target =
    template === "agent"
      ? { type: "agent", provider: "codewith", prompt: "Describe the work this loop should do." }
      : { type: "command", command: `${SCRIPTS_DIR}/run.sh`, args: [] };
  return {
    schema: LOOP_BUNDLE_SCHEMA,
    id: `lp_local_${name}`,
    name,
    description: `Loop bundle for ${name}`,
    labels: [],
    status: "paused",
    schedule: { type: "interval", everyMs: 300_000 },
    target,
    goal: null,
    machine: null,
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 3,
    retryDelayMs: 60_000,
    leaseMs: 900_000,
    expiresAt: null,
    expiresAfterRuns: null,
  };
}

const README_TEMPLATE = (name: string): string =>
  `# ${name}\n\n` +
  `This directory is a loops bundle. \`loop.json\` is the definition, \`manifest.json\`\n` +
  `records every file's sha-256 and the bundle digest, and \`scripts/\` holds the\n` +
  `executables the loop's command target refers to, relative to this directory.\n\n` +
  `    loops bundle push ${name}      # publish an immutable version\n` +
  `    loops bundle versions ${name}  # what has been published\n` +
  `    loops bundle pull ${name}      # install a version here\n`;

/** Read the local manifest, or explain what is missing. */
function requireLocalManifest(name: string, env?: NodeJS.ProcessEnv): { dir: string; manifest: BundleManifest } {
  const dir = bundleDir(name, env ?? process.env);
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) {
    throw new BundleCliError("BUNDLE_NOT_FOUND", `no bundle at ${dir}; run 'loops bundle init ${name}' or 'loops bundle pull ${name}'`, 4);
  }
  return { dir, manifest: validateBundleManifest(JSON.parse(readFileSync(file, "utf8"))) };
}

// ── commands ─────────────────────────────────────────────────────────────────

/**
 * Register every bundle command, and hand back the two actions the bare
 * `loops push` / `loops pull` verbs dispatch to when given a positional name.
 */
export function registerBundleCommands(
  program: Command,
  ctx: BundleCliContext,
): {
  push: (name: string, opts: { reason?: string; as?: string; adopt?: boolean; dryRun?: boolean }) => Promise<void>;
  pull: (name: string, opts: { version?: string; allowDirty?: boolean }) => Promise<void>;
} {
  const bundle = program.command("bundle").description("portable, versioned loop bundles (definition + scripts)");

  // init ─────────────────────────────────────────────────────────────────────
  const initAction = bundleAction(ctx, async (name: string, opts: { fromLoop?: string; template?: string; force?: boolean }) => {
    assertBundleName(name);
    const dir = bundleDir(name, ctx.env ?? process.env);
    if (existsSync(dir) && readdirSync(dir).length > 0 && !opts.force) {
      throw new BundleCliError("BUNDLE_EXISTS", `${dir} is not empty; pass --force to overwrite it`, 3);
    }
    let definition: LoopBundleDefinition;
    if (opts.fromLoop) {
      // `init --from-loop` is the only network call this verb makes, and it is
      // a read: everything else about `init` is local by design so a station
      // with no credentials can still scaffold.
      const loop = await resolveLoop(client(ctx), opts.fromLoop);
      definition = { ...(loopToDefinition(loop as unknown as Loop) as LoopBundleDefinition), name: loop.name };
    } else {
      const template = opts.template === "agent" ? "agent" : "command";
      definition = templateDefinition(name, template);
    }
    ensureBundleRoot(ctx.env ?? process.env);
    if (opts.force && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const manifest = writeBundleSkeleton(dir, name, definition, { readme: README_TEMPLATE(name) });
    out(ctx, { ok: true, bundle: name, dir, version: manifest.version, bundleDigest: manifest.bundleDigest },
      `initialised bundle ${name} at ${dir} (version 0, digest ${manifest.bundleDigest})`);
  });
  bundle
    .command("init <name>")
    .description("create a bundle directory with loop.json, manifest.json and scripts/")
    .option("--from-loop <idOrName>", "seed loop.json from an existing loop")
    .option("--template <kind>", "command | agent (default: command)")
    .option("--force", "overwrite a non-empty directory")
    .action(initAction);

  // push ─────────────────────────────────────────────────────────────────────
  const pushAction = bundleAction(ctx, async (name: string, opts: { reason?: string; as?: string; adopt?: boolean; dryRun?: boolean }) => {
    const { dir } = requireLocalManifest(name, ctx.env);
    const definition = parseDefinition(JSON.parse(readFileSync(join(dir, LOOP_JSON_FILE), "utf8")));
    const collected = collectBundle(dir);
    const packed = packBundleEntries(collected);

    if (opts.dryRun) {
      // Zero network calls: the plan is computed entirely from the tree, so a
      // --dry-run is safe with no credentials at all.
      out(
        ctx,
        {
          ok: true,
          dryRun: true,
          bundle: name,
          bundleDigest: packed.bundleDigest,
          archiveSha256: packed.archiveSha256,
          archiveBytes: packed.archive.byteLength,
          files: packed.files,
        },
        `would push ${name}: ${packed.files.length} file(s), digest ${packed.bundleDigest}, archive ${packed.archive.byteLength} bytes`,
      );
      return;
    }

    const api = client(ctx);
    const loop = await resolveLoop(api, opts.as ?? name);
    const bundleName = bundleNameFor(loop, opts.as ?? name);
    const manifest = buildManifest({
      name: bundleName,
      loopId: opts.adopt ? loop.id : definition.id,
      version: 0,
      files: packed.files,
      archiveSha256: packed.archiveSha256,
      carriesPrompt: definitionCarriesPrompt(definition),
      reason: opts.reason,
    });
    const response = await api.upload(loop.id, serializeBundleManifest(manifest), packed.archive, { adopt: opts.adopt });
    const version = Number(response.version ?? 0);

    // Rewrite the local manifest with the allocated version and drop the
    // marker, so the tree now knows which published version it IS.
    const stamped = buildManifest({
      name: bundleName,
      loopId: loop.id,
      version,
      files: packed.files,
      archiveSha256: packed.archiveSha256,
      carriesPrompt: definitionCarriesPrompt(definition),
      reason: opts.reason,
    });
    writeFileSync(join(dir, MANIFEST_FILE), serializeBundleManifest(stamped), { mode: MODE_DATA });
    writeBundleMarker(dir, {
      bundle: bundleName,
      loopId: loop.id,
      version,
      pinnedVersion: typeof loop.bundlePinnedVersion === "number" ? loop.bundlePinnedVersion : null,
      bundleDigest: packed.bundleDigest,
      source: "push",
      apiUrl: api.baseUrl,
      syncedAt: new Date().toISOString(),
    });
    out(
      ctx,
      { ok: true, bundle: bundleName, loopId: loop.id, version, created: response.created === true, bundleDigest: packed.bundleDigest },
      response.created === true
        ? `pushed ${bundleName}@${version} (${packed.files.length} files, ${packed.bundleDigest})`
        : `${bundleName} is already published as version ${version} (unchanged digest ${packed.bundleDigest})`,
    );
  });
  bundle
    .command("push <name>")
    .description("pack the local bundle and publish it as the next immutable version")
    .option("--reason <text>", "why this version exists; stored on the revision")
    .option("--as <bundle-name>", "publish under a different bundle name")
    .option("--adopt", "re-home a bundle whose loop.json names a different loop")
    .option("--dry-run", "print the manifest and digest; makes no request")
    .action(pushAction);

  // pull ─────────────────────────────────────────────────────────────────────
  const pullAction = bundleAction(ctx, async (name: string, opts: { version?: string; allowDirty?: boolean }) => {
    const api = client(ctx);
    const loop = await resolveLoop(api, name);
    const bundleName = bundleNameFor(loop);
    const local = inspectLocalBundle(bundleName, ctx.env ?? process.env);
    if (local.state === "dirty" && !opts.allowDirty) {
      throw new BundleCliError(
        "BUNDLE_DIRTY",
        `${local.dir} has local changes (${local.changedPaths.join(", ")}); pass --allow-dirty to overwrite them`,
        2,
      );
    }
    const pinned = typeof loop.bundlePinnedVersion === "number" ? loop.bundlePinnedVersion : undefined;
    const requested = opts.version === undefined || opts.version === "latest" ? undefined : Number(opts.version);
    if (pinned !== undefined && requested !== undefined && requested !== pinned) {
      throw new BundleCliError("BUNDLE_PINNED", `${bundleName} is pinned to version ${pinned}; refusing to install ${requested}`, 3);
    }
    const version = requested ?? pinned ?? ("latest" as const);
    const download = await api.download(loop.id, version);
    const detail = (await api.getVersion(loop.id, download.version)) as { manifest?: unknown };
    const manifest = validateBundleManifest(detail.manifest);
    verifyArchiveSha256(download.bytes, manifest.archiveSha256 ?? download.archiveSha256);
    const entries = unpackBundle(download.bytes);
    verifyBundleAgainstManifest(entries, manifest);

    const dir = bundleDir(bundleName, ctx.env ?? process.env);
    installBundleTree(dir, entries, manifest);
    writeBundleMarker(dir, {
      bundle: bundleName,
      loopId: loop.id,
      version: manifest.version,
      pinnedVersion: pinned ?? null,
      bundleDigest: manifest.bundleDigest,
      source: "pull",
      apiUrl: api.baseUrl,
      syncedAt: new Date().toISOString(),
    });
    out(
      ctx,
      { ok: true, bundle: bundleName, version: manifest.version, dir, bundleDigest: manifest.bundleDigest, files: manifest.files.length },
      `pulled ${bundleName}@${manifest.version} into ${dir} (${manifest.files.length} files, ${manifest.bundleDigest})`,
    );
  });
  bundle
    .command("pull <name>")
    .description("download a published version and install it atomically")
    .option("--version <n>", "version to install, or 'latest' (default: the pin, else latest)")
    .option("--allow-dirty", "overwrite a locally modified tree")
    .action(pullAction);

  // versions ─────────────────────────────────────────────────────────────────
  const versionsAction = bundleAction(ctx, async (name: string, opts: { limit?: string }) => {
    const api = client(ctx);
    const loop = await resolveLoop(api, name);
    const response = await api.listVersions(loop.id, opts.limit === undefined ? undefined : Number(opts.limit));
    const versions = (response.versions ?? []) as Array<Record<string, unknown>>;
    out(
      ctx,
      response,
      versions.length === 0
        ? `${name} has no published versions`
        : versions
            .map((entry) => `${entry.version}\t${entry.bundleDigest}\t${entry.state}\t${entry.createdAt}\t${entry.reason ?? ""}`)
            .join("\n"),
    );
  });
  bundle.command("versions <name>").description("list a bundle's published versions").option("--limit <n>", "max rows").action(versionsAction);

  // pin ──────────────────────────────────────────────────────────────────────
  const pinAction = bundleAction(ctx, async (name: string, version: string | undefined, opts: { none?: boolean }) => {
    const api = client(ctx);
    const loop = await resolveLoop(api, name);
    const target = opts.none || version === undefined ? null : Number(version);
    if (target !== null && (!Number.isSafeInteger(target) || target < 1)) {
      throw new BundleCliError("BUNDLE_VERSION_INVALID", "pin takes an integer version >= 1, or --none to unpin", 2);
    }
    const response = await api.pin(loop.id, target);
    out(ctx, response, target === null ? `${name} unpinned (follows latest)` : `${name} pinned to version ${target}`);
  });
  bundle
    .command("pin <name> [version]")
    .description("pin a loop to one bundle version, or --none to follow latest")
    .option("--none", "remove the pin")
    .action(pinAction);

  // status ───────────────────────────────────────────────────────────────────
  const statusAction = bundleAction(ctx, async (names: string[]) => {
    const root = bundleRoot(ctx.env ?? process.env);
    const candidates = names.length > 0 ? names : existsSync(root) ? readdirSync(root).filter((entry) => isBundleName(entry)) : [];
    const report = candidates.map((name) => {
      const local = inspectLocalBundle(name, ctx.env ?? process.env);
      return {
        bundle: name,
        state: local.state,
        version: local.manifest?.version ?? null,
        bundleDigest: local.digest ?? null,
        markerVersion: local.marker?.version ?? null,
        pinnedVersion: local.marker?.pinnedVersion ?? null,
        changedPaths: local.changedPaths,
      };
    });
    out(
      ctx,
      { ok: true, root, bundles: report },
      report.length === 0
        ? `no bundles under ${root}`
        : report.map((entry) => `${entry.bundle}\t${entry.state}\tv${entry.version ?? "-"}\t${entry.changedPaths.join(",")}`).join("\n"),
    );
  });
  bundle.command("status [names...]").description("local drift census; read-only, no network").action(statusAction);

  // diff ─────────────────────────────────────────────────────────────────────
  const diffAction = bundleAction(ctx, async (name: string, opts: { version?: string }) => {
    const local = inspectLocalBundle(name, ctx.env ?? process.env);
    if (local.state === "absent") throw new BundleCliError("BUNDLE_NOT_FOUND", `no bundle at ${local.dir}`, 4);
    const api = client(ctx);
    const loop = await resolveLoop(api, name);
    const detail = (await api.getVersion(loop.id, opts.version === undefined ? "latest" : Number(opts.version))) as { manifest?: unknown };
    const remote = validateBundleManifest(detail.manifest);
    const localPaths = new Map((local.manifest?.files ?? []).map((file) => [file.path, file.sha256]));
    const remotePaths = new Map(remote.files.map((file) => [file.path, file.sha256]));
    const added = [...localPaths.keys()].filter((path) => !remotePaths.has(path)).sort();
    const removed = [...remotePaths.keys()].filter((path) => !localPaths.has(path)).sort();
    const changed = [...localPaths.entries()].filter(([path, sha]) => remotePaths.has(path) && remotePaths.get(path) !== sha).map(([path]) => path).sort();
    out(
      ctx,
      { ok: true, bundle: name, localDigest: local.digest ?? null, remoteVersion: remote.version, remoteDigest: remote.bundleDigest, added, removed, changed },
      // Paths only. A content diff of a script is a credential-exfiltration
      // shape, and this output ends up in terminal scrollback and CI logs.
      [`local ${local.digest ?? "-"} vs ${remote.name}@${remote.version} ${remote.bundleDigest}`,
        added.length ? `added: ${added.join(", ")}` : "",
        removed.length ? `removed: ${removed.join(", ")}` : "",
        changed.length ? `changed: ${changed.join(", ")}` : ""].filter(Boolean).join("\n"),
    );
  });
  bundle.command("diff <name>").description("compare the local tree with a published version (paths only)").option("--version <n>", "version to compare against").action(diffAction);

  // materialize ──────────────────────────────────────────────────────────────
  const materializeAction = bundleAction(ctx, async (names: string[], opts: { all?: boolean; limit?: string; dryRun?: boolean }) => {
    const api = client(ctx);
    const limit = opts.limit === undefined ? 200 : Number(opts.limit);
    let loops: RemoteLoop[];
    if (opts.all) {
      const page = (await api.listLoops({ limit })) as { loops?: RemoteLoop[] };
      loops = page.loops ?? [];
    } else {
      loops = [];
      for (const name of names) loops.push(await resolveLoop(api, name));
    }
    const written: string[] = [];
    const skipped: Array<{ loop: string; reason: string }> = [];
    for (const loop of loops) {
      const candidate = loop.bundleName ?? loop.name;
      if (!isBundleName(candidate)) {
        skipped.push({ loop: loop.name, reason: `name is not bundle-safe; rename it: loops rename ${loop.name} <new-name>` });
        continue;
      }
      if (opts.dryRun) {
        written.push(candidate);
        continue;
      }
      const definition = loopToDefinition(loop as unknown as Loop) as LoopBundleDefinition;
      const dir = bundleDir(candidate, ctx.env ?? process.env);
      ensureBundleRoot(ctx.env ?? process.env);
      mkdirSync(dir, { recursive: true, mode: MODE_DIR });
      writeFileSync(join(dir, LOOP_JSON_FILE), serializeDefinition(definition), { mode: MODE_DATA });
      const manifest = writeBundleSkeleton(dir, candidate, definition, { readme: README_TEMPLATE(candidate) });
      writeBundleMarker(dir, {
        bundle: candidate,
        loopId: loop.id,
        version: 0,
        pinnedVersion: null,
        bundleDigest: manifest.bundleDigest,
        source: "materialize",
        apiUrl: api.baseUrl,
        syncedAt: new Date().toISOString(),
      });
      written.push(candidate);
    }
    out(
      ctx,
      { ok: true, dryRun: opts.dryRun === true, materialized: written, skipped },
      `${opts.dryRun ? "would materialize" : "materialized"} ${written.length} bundle(s)` +
        (skipped.length ? `; skipped ${skipped.length}: ${skipped.map((entry) => `${entry.loop} (${entry.reason})`).join("; ")}` : ""),
    );
  });
  bundle
    .command("materialize [names...]")
    .description("write bundle directories from control-plane rows; local only, never uploads")
    .option("--all", "every loop the key can see")
    .option("--limit <n>", "cap for --all")
    .option("--dry-run", "report what would be written")
    .action(materializeAction);

  // sync ─────────────────────────────────────────────────────────────────────
  const syncAction = bundleAction(ctx, async (names: string[], opts: { dryRun?: boolean; forMachine?: string | boolean; prefer?: string }) => {
    const api = client(ctx);
    const machine = opts.forMachine === true ? defaultMachineId(ctx.env ?? process.env) : typeof opts.forMachine === "string" ? opts.forMachine : undefined;
    const index = (await api.listBundles({ machine, limit: 500 })) as {
      bundles?: Array<{ bundleName: string; loopId: string; latestVersion: number; pinnedVersion?: number; bundleDigest?: string }>;
    };
    const wanted = (index.bundles ?? []).filter((entry) => names.length === 0 || names.includes(entry.bundleName));
    const plan: Array<Record<string, unknown>> = [];
    for (const entry of wanted) {
      const local = inspectLocalBundle(entry.bundleName, ctx.env ?? process.env);
      const target = entry.pinnedVersion ?? entry.latestVersion;
      const localVersion = local.manifest?.version ?? null;
      const dirty = local.state === "dirty";
      const behind = localVersion === null || localVersion < target;
      let action: string;
      if (local.state === "unmanaged") action = "skip-unmanaged";
      else if (dirty && behind) action = "conflict-diverged";
      else if (dirty) action = opts.prefer === "remote" ? "pull" : "skip-dirty";
      else if (behind) action = "pull";
      else action = "up-to-date";
      plan.push({ bundle: entry.bundleName, action, localVersion, targetVersion: target, changedPaths: local.changedPaths });
    }
    const diverged = plan.filter((entry) => entry.action === "conflict-diverged");

    if (opts.dryRun) {
      out(ctx, { ok: true, dryRun: true, machine: machine ?? null, plan },
        plan.map((entry) => `${entry.bundle}\t${entry.action}\tv${entry.localVersion ?? "-"} -> v${entry.targetVersion}`).join("\n") || "nothing to sync");
      return;
    }
    if (diverged.length > 0) {
      // Never auto-merged. A merged loop definition nobody reviewed is worse
      // than a refusal: resolve with `loops bundle diff`, then re-run with
      // --prefer remote (or push the local side).
      throw new BundleCliError(
        "BUNDLE_DIVERGED",
        `local and remote both moved for: ${diverged.map((entry) => entry.bundle).join(", ")}; resolve with 'loops bundle diff' then --prefer local|remote`,
        3,
      );
    }
    const pulled: string[] = [];
    for (const entry of plan) {
      if (entry.action !== "pull") continue;
      await pullAction(String(entry.bundle), { allowDirty: opts.prefer === "remote" });
      pulled.push(String(entry.bundle));
    }
    out(ctx, { ok: true, machine: machine ?? null, pulled, plan }, `synced ${pulled.length} bundle(s)`);
  });
  bundle
    .command("sync [names...]")
    .description("reconcile local bundles with the control plane (pull-only)")
    .option("--dry-run", "print the plan and change nothing")
    .option("--for-machine [id]", "restrict to loops assigned to this machine (runner bootstrap)")
    .option("--prefer <side>", "local | remote, for a dirty tree")
    .action(syncAction);

  // Top-level aliases with no collision.
  program.command("init <name>").description("alias for 'loops bundle init'")
    .option("--from-loop <idOrName>", "seed loop.json from an existing loop")
    .option("--template <kind>", "command | agent (default: command)")
    .option("--force", "overwrite a non-empty directory")
    .action(initAction);
  program.command("versions <name>").description("alias for 'loops bundle versions'").option("--limit <n>", "max rows").action(versionsAction);
  program.command("pin <name> [version]").description("alias for 'loops bundle pin'").option("--none", "remove the pin").action(pinAction);
  program
    .command("sync [names...]")
    .description("alias for 'loops bundle sync'")
    .option("--dry-run", "print the plan and change nothing")
    .option("--for-machine [id]", "restrict to loops assigned to this machine")
    .option("--prefer <side>", "local | remote")
    .action(syncAction);
  program
    .command("materialize [names...]")
    .description("alias for 'loops bundle materialize'")
    .option("--all", "every loop the key can see")
    .option("--limit <n>", "cap for --all")
    .option("--dry-run", "report what would be written")
    .action(materializeAction);

  return { push: pushAction, pull: pullAction };
}

function defaultMachineId(env: NodeJS.ProcessEnv): string | undefined {
  return env.LOOPS_MACHINE_ID?.trim() || env.HASNA_STATION_ID?.trim() || undefined;
}
