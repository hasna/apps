#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  CONFIG_PATH,
  clearClientConfig,
  createClient,
  loadClientConfig,
  resolveClientConfig,
  saveClientConfig,
} from '../sync/client.mjs';
import { summaryLine } from '../sync/engine.mjs';
import {
  installService,
  readSyncStatus,
  runSyncGuarded,
  serviceDefinition,
  uninstallService,
  watchSync,
} from '../sync/daemon.mjs';
import { checkInstallApiUrl, lnpWarningLines } from '../sync/lnp.mjs';
import { dataRoot } from '../tools/notes-lib.mjs';

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq > 0 ? eq : undefined);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
    opts[key] = value;
  }
  return opts;
}

function jsonOut(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function line(value) {
  process.stdout.write(String(value) + '\n');
}

function usage() {
  return `PersonalNotes CLI

Usage:
  personalnotes auth login --email you@example.com [--json]
  personalnotes auth verify --email you@example.com --code 123456 [--json]
  personalnotes auth device [--json]
  personalnotes auth device-token --device-code dc_... [--json]
  personalnotes auth device-exchange --exchange-token dt_... [--json]
  personalnotes auth device-approve --user-code XXXX-XXXX [--json]
  personalnotes auth whoami [--json]
  personalnotes auth logout
  personalnotes sync [--dry-run] [--json] [--api-url https://...]
  personalnotes sync --watch [--interval 5m] [--log-file path]
  personalnotes sync status [--json]
  personalnotes sync --install-service [--dry-run] [--json]     (launchd on macOS, systemd --user on Linux)
  personalnotes sync --uninstall-service [--json]
  personalnotes cloud status [--json]
  personalnotes cloud list [--limit 10] [--json]
  personalnotes cloud create --title title --body markdown [--json]
  personalnotes cloud sync [--dry-run] [--json]   (alias of: personalnotes sync)
  personalnotes billing status [--json]
  personalnotes billing checkout [--json]

Sync pushes local markdown notes to the configured server and applies pulled
changes back to disk (state file: <data-root>/sync-state.json). The server is
https://personalnotes.ai by default; point PERSONALNOTES_API_URL (or config
apiUrl) at a self-hosted server to use the same protocol there.

--watch runs the sync daemon: interval polling (config syncIntervalMinutes,
default 5, floor 1, jittered) plus a debounced watch on the notes folder, one
instance per data root, honest status in <data-root>/sync-status.json, logs in
~/Library/Logs/PersonalNotes (macOS) or ~/.local/state/personalnotes (Linux).
--install-service writes the user service file that keeps the daemon running.
On macOS it first checks the API URL: a host that resolves to a LAN address is
silently unreachable for launchd agents (Local Network Privacy, EHOSTUNREACH,
no prompt), so the installer prefers a Tailscale MagicDNS FQDN when one is
detectable and saves it to the config. --dry-run previews the check and the
service file without writing anything.

Local note commands (list, create, labels, markdown, agent, ...) are also handled by this binary.
The legacy hasna-notes / hasna-notes-mcp aliases are deprecated and will be removed in the next release.`;
}

async function print(value, opts, fallback) {
  if (opts.json) return jsonOut(value);
  line(fallback ?? JSON.stringify(value, null, 2));
}

function cliScriptPath() {
  return fileURLToPath(import.meta.url);
}

async function commandSyncStatus(opts) {
  const status = await readSyncStatus(dataRoot());
  if (!status) {
    if (opts.json) return jsonOut({ status: 'never' });
    return line('Never synced. Run: personalnotes sync');
  }
  if (opts.json) return jsonOut(status);
  line(`status: ${status.status}`);
  if (status.lastSyncAt) line(`lastSyncAt: ${status.lastSyncAt}`);
  if (status.lastSuccessAt) line(`lastSuccessAt: ${status.lastSuccessAt}`);
  if (status.status === 'error' && status.error) line(`error: ${status.error}`);
  if (status.apiUrl) line(`server: ${status.apiUrl}`);
  if (status.cursor) line(`cursor: ${status.cursor}`);
  if (status.runner) line(`runner: ${status.runner}`);
}

async function commandSyncService(opts, uninstall) {
  const dryRun = !!opts['dry-run'];
  let lnp = null;
  let env = process.env;
  if (!uninstall) {
    // macOS Local Network Privacy check (sync/lnp.mjs): a LAN-resolving API
    // URL silently breaks the launchd daemon (EHOSTUNREACH, no prompt) while
    // manual runs work. Prefer a Tailscale MagicDNS FQDN when detectable and
    // persist it so daemon and manual runs use the same safe URL.
    const resolved = await resolveClientConfig({ apiUrl: opts['api-url'] });
    lnp = await checkInstallApiUrl({ apiUrl: resolved.apiUrl });
    if (lnp.blocked) {
      if (!opts.json) for (const warning of lnpWarningLines(lnp)) process.stderr.write(warning + '\n');
      if (lnp.safeApiUrl) {
        if (!dryRun) {
          const existing = await loadClientConfig();
          await saveClientConfig({ ...existing, apiUrl: lnp.safeApiUrl });
          if (!opts.json) process.stderr.write(`Saved apiUrl to ${CONFIG_PATH}\n`);
        }
        // The service file embeds PERSONALNOTES_API_URL when set — make sure
        // it embeds the safe URL, not the LAN one the config no longer uses.
        if (process.env.PERSONALNOTES_API_URL) env = { ...process.env, PERSONALNOTES_API_URL: lnp.safeApiUrl };
      }
    }
  }
  if (dryRun) {
    const def = serviceDefinition({ scriptPath: cliScriptPath(), env });
    // def.instructions are the ENABLE steps — only meaningful for install.
    const payload = { ok: true, dryRun: true, uninstall, platform: def.platform, path: def.path, ...(uninstall ? {} : { instructions: def.instructions }), ...(lnp ? { lnp } : {}) };
    if (opts.json) return jsonOut(payload);
    line(`[dry-run] Would ${uninstall ? 'remove' : 'write'} ${def.path}`);
    if (lnp?.blocked && lnp.safeApiUrl) line(`[dry-run] Would save apiUrl ${lnp.safeApiUrl} to ${CONFIG_PATH}`);
    return;
  }
  const action = uninstall ? uninstallService : installService;
  const result = await action({ scriptPath: cliScriptPath(), env });
  if (opts.json) return jsonOut({ ok: true, removed: !!result.removed, platform: result.platform, path: result.path, instructions: result.instructions, ...(lnp ? { lnp } : {}) });
  line(uninstall
    ? (result.removed ? `Removed ${result.path}` : `No service file at ${result.path}`)
    : `Wrote ${result.path}`);
  line(uninstall ? 'To stop it now, run:' : 'To start it now, run:');
  for (const step of result.instructions) line(`  ${step}`);
}

async function commandSync(opts, args) {
  const action = args[0];
  if (opts['install-service'] || action === 'install-service' || action === 'install-schedule') {
    return commandSyncService(opts, false);
  }
  if (opts['uninstall-service'] || action === 'uninstall-service') {
    return commandSyncService(opts, true);
  }
  if (action === 'status' || opts.status) return commandSyncStatus(opts);
  const overrides = { apiUrl: opts['api-url'], apiKey: opts['api-key'], token: opts.token };
  if (opts.watch) {
    await watchSync({
      overrides,
      interval: typeof opts.interval === 'string' || typeof opts.interval === 'number' ? opts.interval : undefined,
      ...(typeof opts['log-file'] === 'string' ? { logPath: opts['log-file'] } : {}),
    });
    return; // timer + watcher keep the process alive until SIGTERM/SIGINT
  }
  try {
    const summary = await runSyncGuarded({ overrides, dryRun: !!opts['dry-run'] });
    return print(summary, opts, summaryLine(summary));
  } catch (err) {
    if (err?.code !== 'sync_already_running') throw err;
    // Not a failure: another run (daemon/GUI) is already syncing this store.
    return print({ ok: false, skipped: true, reason: 'already_running', message: err.message }, opts, `Sync skipped: ${err.message}`);
  }
}

async function handleHosted(cmd, args, opts) {
  if (cmd === 'sync') return commandSync(opts, args);
  const client = await createClient({ apiUrl: opts['api-url'], apiKey: opts['api-key'], token: opts.token });
  if (cmd === 'auth') {
    const action = args[0];
    if (action === 'login') {
      const result = await client.startLogin(opts.email);
      return print(result, opts, result.devCode ? `Login code created for ${result.email}: ${result.devCode}` : `Login code sent to ${result.email}`);
    }
    if (action === 'verify') {
      const result = await client.verifyLogin({ email: opts.email, code: opts.code, name: opts.name });
      const existing = await loadClientConfig();
      await saveClientConfig({ ...existing, apiUrl: client.config.apiUrl, token: result.token, apiKey: result.apiKey });
      return print(result, opts, `Signed in. Config saved to ${CONFIG_PATH}`);
    }
    if (action === 'device') {
      const result = await client.startDeviceLogin();
      return print(result, opts, `Open ${result.verificationUri} and enter code ${result.userCode}`);
    }
    if (action === 'device-token') {
      const result = await client.pollDeviceLogin(opts['device-code']);
      if (result.apiKey) {
        const existing = await loadClientConfig();
        await saveClientConfig({ ...existing, apiUrl: client.config.apiUrl, apiKey: result.apiKey });
        return print(result, opts, `Device login complete. Config saved to ${CONFIG_PATH}`);
      }
      return print(result, opts, result.message || `Device login status: ${result.status}`);
    }
    if (action === 'device-exchange') {
      const result = await client.exchangeDeviceLogin(opts['exchange-token']);
      if (result.apiKey) {
        const existing = await loadClientConfig();
        await saveClientConfig({ ...existing, apiUrl: client.config.apiUrl, apiKey: result.apiKey });
        return print(result, opts, `Device login complete. Config saved to ${CONFIG_PATH}`);
      }
      return print(result, opts, result.message || 'Device exchange complete.');
    }
    if (action === 'device-approve') {
      const result = await client.approveDeviceLogin(opts['user-code']);
      if (result.apiKey) {
        const existing = await loadClientConfig();
        await saveClientConfig({ ...existing, apiUrl: client.config.apiUrl, apiKey: result.apiKey });
      }
      return print(result, opts, result.apiKey ? `Device approved. Config saved to ${CONFIG_PATH}` : 'Device approved. Return to the requesting device to finish login.');
    }
    if (action === 'whoami') return print(await client.whoami(), opts);
    if (action === 'logout') {
      await clearClientConfig();
      return line(`Cleared ${CONFIG_PATH}`);
    }
  }
  if (cmd === 'cloud') {
    const action = args[0];
    if (action === 'status') return print(await client.apiInfo(), opts);
    if (action === 'list') return print(await client.listNotes({ limit: opts.limit }), opts);
    if (action === 'create') return print(await client.createNote({ title: opts.title, bodyMarkdown: opts.body || '' }), opts);
    if (action === 'sync') return commandSync(opts, []); // deprecated alias of `personalnotes sync`
  }
  if (cmd === 'billing') {
    const action = args[0];
    if (action === 'status') return print(await client.billingStatus(), opts);
    if (action === 'checkout') return print(await client.billingCheckout(), opts);
  }
  throw new Error('unknown_hosted_command');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  if (!cmd || cmd === 'help' || cmd === '--help' || opts.help) {
    line(usage());
    return;
  }
  if (cmd === 'auth' || cmd === 'sync' || cmd === 'cloud' || cmd === 'billing') {
    return handleHosted(cmd, opts._, opts);
  }
  await import('../cli/personalnotes.mjs');
}

main().catch((err) => {
  process.stderr.write(`personalnotes: ${err.message || err}\n`);
  process.exitCode = 1;
});
