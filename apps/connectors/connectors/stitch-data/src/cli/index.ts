#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Stitch } from '../api';
import { StitchApiError } from '../types';
import {
  getAccessToken,
  setAccessToken,
  getClientId,
  setClientId,
  getBaseUrl,
  setBaseUrl,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  maskAccessToken,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, warn, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-stitch-data';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stitch (Stitch Connect) connector CLI - manage sources, destinations, streams, replication jobs, and reporting')
  .version(VERSION)
  .option('-k, --api-key <token>', 'Stitch access token (overrides env/config)')
  .option('-c, --client-id <id>', 'Stitch client (account) id for reporting endpoints')
  .option('-b, --base-url <url>', 'Override the API base URL')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-v, --verbose', 'Verbose error output')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Helpers
// ============================================

function globalOpts(): Record<string, unknown> {
  return program.opts();
}

function getFormat(): OutputFormat {
  return (globalOpts().format as OutputFormat) || 'pretty';
}

function resolveClientId(): number | undefined {
  const opts = globalOpts();
  if (opts.clientId) {
    const parsed = Number(opts.clientId);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return getClientId();
}

function getStitch(): Stitch {
  const opts = globalOpts();
  const accessToken = (opts.apiKey as string) || getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set --token <token>", set STITCH_ACCESS_TOKEN, or pass --api-key.`);
    process.exit(1);
  }
  const baseUrl = (opts.baseUrl as string) || getBaseUrl();
  return new Stitch({ accessToken, clientId: resolveClientId(), baseUrl });
}

async function run(fn: () => Promise<unknown>, format: OutputFormat = getFormat()): Promise<void> {
  try {
    const result = await fn();
    if (result !== undefined) {
      print(result, format);
    }
  } catch (err) {
    if (err instanceof StitchApiError) {
      error(`${err.message} [status ${err.statusCode}]`);
      if (globalOpts().verbose && err.errors) {
        console.error(JSON.stringify(err.errors, null, 2));
      }
    } else {
      error((err as Error).message);
    }
    process.exit(1);
  }
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}: ${value}`);
    process.exit(1);
  }
}

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage stored credentials');

configCmd
  .command('set')
  .description('Store credentials for the active profile')
  .option('-t, --token <token>', 'Stitch access token')
  .option('-c, --client-id <id>', 'Stitch client (account) id')
  .option('-b, --base-url <url>', 'API base URL')
  .action((opts: { token?: string; clientId?: string; baseUrl?: string }) => {
    let changed = false;
    if (opts.token) {
      setAccessToken(opts.token);
      changed = true;
    }
    if (opts.clientId) {
      const parsed = Number(opts.clientId);
      if (Number.isNaN(parsed)) {
        error('Client id must be a number');
        process.exit(1);
      }
      setClientId(parsed);
      changed = true;
    }
    if (opts.baseUrl) {
      setBaseUrl(opts.baseUrl);
      changed = true;
    }
    if (!changed) {
      warn('Nothing to set. Provide --token, --client-id, and/or --base-url.');
      return;
    }
    success(`Credentials saved to profile "${getCurrentProfile()}".`);
  });

configCmd
  .command('show')
  .description('Show the active profile configuration (token masked)')
  .action(() => {
    const profile = loadProfile();
    const token = getAccessToken();
    print(
      {
        profile: getCurrentProfile(),
        accessToken: token ? maskAccessToken(token) : null,
        clientId: getClientId() ?? null,
        baseUrl: getBaseUrl() ?? 'https://api.stitchdata.com (default)',
        configDir: getConfigDir(),
        source: token && !profile.accessToken ? 'environment' : 'profile',
      },
      getFormat(),
    );
  });

configCmd
  .command('clear')
  .description('Clear stored credentials for the active profile')
  .action(() => {
    clearConfig();
    success(`Cleared credentials for profile "${getCurrentProfile()}".`);
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }
    success('Profiles:');
    profiles.forEach((p) => {
      const active = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${active}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile "${name}".`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    if (createProfile(name)) {
      success(`Created profile "${name}".`);
    } else {
      error(`Profile "${name}" already exists.`);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (deleteProfile(name)) {
      success(`Deleted profile "${name}".`);
    } else {
      error(`Could not delete profile "${name}" (it may not exist or is the default).`);
      process.exit(1);
    }
  });

// ============================================
// Sources Commands
// ============================================
const sourcesCmd = program.command('sources').description('Manage data sources');

sourcesCmd
  .command('list')
  .description('List all sources')
  .action(() => run(() => getStitch().sources.list()));

sourcesCmd
  .command('get <sourceId>')
  .description('Get a source by id')
  .action((sourceId: string) => run(() => getStitch().sources.get(Number(sourceId))));

sourcesCmd
  .command('create')
  .description('Create a source')
  .requiredOption('-t, --type <type>', 'Source type (e.g. platform.hubspot)')
  .requiredOption('-n, --name <name>', 'Display name')
  .option('--properties <json>', 'Source properties as JSON')
  .action((opts: { type: string; name: string; properties?: string }) =>
    run(() =>
      getStitch().sources.create({
        type: opts.type,
        display_name: opts.name,
        properties: parseJsonOption(opts.properties, '--properties'),
      }),
    ),
  );

sourcesCmd
  .command('update <sourceId>')
  .description('Update a source')
  .option('-n, --name <name>', 'New display name')
  .option('--properties <json>', 'Source properties as JSON')
  .action((sourceId: string, opts: { name?: string; properties?: string }) =>
    run(() =>
      getStitch().sources.update(Number(sourceId), {
        display_name: opts.name,
        properties: parseJsonOption(opts.properties, '--properties'),
      }),
    ),
  );

sourcesCmd
  .command('delete <sourceId>')
  .description('Delete a source')
  .action((sourceId: string) => run(() => getStitch().sources.delete(Number(sourceId))));

sourcesCmd
  .command('pause <sourceId>')
  .description('Pause a source')
  .option('--at <timestamp>', 'ISO timestamp to record as paused_at')
  .action((sourceId: string, opts: { at?: string }) =>
    run(() => getStitch().sources.pause(Number(sourceId), opts.at || nowIso())),
  );

sourcesCmd
  .command('unpause <sourceId>')
  .description('Unpause a source')
  .action((sourceId: string) => run(() => getStitch().sources.unpause(Number(sourceId))));

sourcesCmd
  .command('check <sourceId>')
  .description('Show the last connection check for a source')
  .action((sourceId: string) => run(() => getStitch().sources.lastConnectionCheck(Number(sourceId))));

// ============================================
// Source Types Commands
// ============================================
const sourceTypesCmd = program.command('source-types').description('Browse the source type catalog');

sourceTypesCmd
  .command('list')
  .description('List all source types')
  .action(() => run(() => getStitch().sourceTypes.list()));

sourceTypesCmd
  .command('get <type>')
  .description('Get a source type by name')
  .action((type: string) => run(() => getStitch().sourceTypes.get(type)));

// ============================================
// Destinations Commands
// ============================================
const destinationsCmd = program.command('destinations').description('Manage data destinations');

destinationsCmd
  .command('list')
  .description('List all destinations')
  .action(() => run(() => getStitch().destinations.list()));

destinationsCmd
  .command('create')
  .description('Create a destination')
  .requiredOption('-t, --type <type>', 'Destination type')
  .option('-n, --name <name>', 'Display name')
  .option('--properties <json>', 'Destination properties as JSON')
  .action((opts: { type: string; name?: string; properties?: string }) =>
    run(() =>
      getStitch().destinations.create({
        type: opts.type,
        display_name: opts.name,
        properties: parseJsonOption(opts.properties, '--properties'),
      }),
    ),
  );

destinationsCmd
  .command('update <destinationId>')
  .description('Update a destination')
  .option('-n, --name <name>', 'New display name')
  .option('--properties <json>', 'Destination properties as JSON')
  .action((destinationId: string, opts: { name?: string; properties?: string }) =>
    run(() =>
      getStitch().destinations.update(Number(destinationId), {
        display_name: opts.name,
        properties: parseJsonOption(opts.properties, '--properties'),
      }),
    ),
  );

destinationsCmd
  .command('delete <destinationId>')
  .description('Delete a destination')
  .action((destinationId: string) => run(() => getStitch().destinations.delete(Number(destinationId))));

// ============================================
// Destination Types Commands
// ============================================
const destinationTypesCmd = program.command('destination-types').description('Browse the destination type catalog');

destinationTypesCmd
  .command('list')
  .description('List all destination types')
  .action(() => run(() => getStitch().destinationTypes.list()));

destinationTypesCmd
  .command('get <type>')
  .description('Get a destination type by name')
  .action((type: string) => run(() => getStitch().destinationTypes.get(type)));

// ============================================
// Streams Commands
// ============================================
const streamsCmd = program.command('streams').description('Inspect a source\'s streams');

streamsCmd
  .command('list <sourceId>')
  .description('List streams for a source')
  .action((sourceId: string) => run(() => getStitch().streams.list(Number(sourceId))));

streamsCmd
  .command('get <sourceId> <streamId>')
  .description('Get a stream by id')
  .action((sourceId: string, streamId: string) =>
    run(() => getStitch().streams.get(Number(sourceId), Number(streamId))),
  );

// ============================================
// Replication (sync) Commands
// ============================================
const syncCmd = program.command('sync').description('Start/stop replication jobs');

syncCmd
  .command('start <sourceId>')
  .description('Start a replication job for a source')
  .action((sourceId: string) => run(() => getStitch().replication.start(Number(sourceId))));

syncCmd
  .command('stop <sourceId>')
  .description('Stop the running replication job for a source')
  .action((sourceId: string) => run(() => getStitch().replication.stop(Number(sourceId))));

// ============================================
// Reporting Commands (loads / extractions)
// ============================================
const loadsCmd = program.command('loads').description('Report on destination loads');

loadsCmd
  .command('list')
  .description('List load events')
  .option('--page <page>', 'Page number (100 records/page)')
  .action((opts: { page?: string }) =>
    run(() => getStitch().reporting.listLoads({ page: opts.page ? Number(opts.page) : undefined })),
  );

const extractionsCmd = program.command('extractions').description('Report on extraction (tap) jobs');

extractionsCmd
  .command('list')
  .description('List extraction jobs')
  .option('--page <page>', 'Page number (100 records/page)')
  .action((opts: { page?: string }) =>
    run(() => getStitch().reporting.listExtractions({ page: opts.page ? Number(opts.page) : undefined })),
  );

extractionsCmd
  .command('log <jobName>')
  .description('Show the log output for an extraction job')
  .action((jobName: string) => run(() => getStitch().reporting.getExtractionLog(jobName)));

// ============================================
// Utilities
// ============================================

// Deterministic ISO timestamp helper (avoids importing Date directly at module load)
function nowIso(): string {
  return new Date().toISOString();
}

program.parseAsync(process.argv).catch((err) => {
  error((err as Error).message);
  process.exit(1);
});
