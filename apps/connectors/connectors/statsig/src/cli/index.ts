#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Statsig } from '../api';
import {
  getApiKey,
  setApiKey,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-statsig';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Statsig Console API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.STATSIG_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Statsig {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STATSIG_API_KEY.`);
    process.exit(1);
  }
  return new Statsig({ apiKey });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid JSON for ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function runAction(cmd: Command, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--api-key <key>', 'API key').option('--use', 'Activate after create').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { apiKey: opts.apiKey });
  success(`Profile "${name}" created`);
  if (opts.use) setCurrentProfile(name);
});

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear active profile config').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

function addListGetCommands(parent: Command, resource: string, listFn: (client: Statsig) => Promise<unknown>, getFn: (client: Statsig, id: string) => Promise<unknown>): void {
  parent.command('list').description(`List ${resource}`).action(async function (this: Command) {
    await runAction(this, () => listFn(getClient()));
  });
  parent.command('get <id>').description(`Get ${resource} by ID`).action(async function (this: Command, id: string) {
    await runAction(this, () => getFn(getClient(), id));
  });
}

const gatesCmd = program.command('gates').description('Feature gate operations');
addListGetCommands(gatesCmd, 'gates', (c) => c.gates.list(), (c, id) => c.gates.get(id));
gatesCmd.command('create').requiredOption('--body <json>', 'Gate JSON body').action(async function (this: Command, opts) {
  const body = parseJsonOption(opts.body, 'body');
  await runAction(this, () => getClient().gates.create(body));
});
gatesCmd.command('delete <id>').action(async function (this: Command, id: string) {
  await runAction(this, () => getClient().gates.delete(id));
});
gatesCmd.command('enable <id>').action(async function (this: Command, id: string) {
  await runAction(this, () => getClient().gates.enable(id));
});
gatesCmd.command('disable <id>').action(async function (this: Command, id: string) {
  await runAction(this, () => getClient().gates.disable(id));
});

const experimentsCmd = program.command('experiments').description('Experiment operations');
addListGetCommands(experimentsCmd, 'experiments', (c) => c.experiments.list(), (c, id) => c.experiments.get(id));
experimentsCmd.command('create').requiredOption('--body <json>', 'Experiment JSON body').action(async function (this: Command, opts) {
  const body = parseJsonOption(opts.body, 'body');
  await runAction(this, () => getClient().experiments.create(body));
});
experimentsCmd.command('start <id>').action(async function (this: Command, id: string) {
  await runAction(this, () => getClient().experiments.start(id));
});
experimentsCmd.command('finish <id>').option('--body <json>', 'Finish payload JSON').action(async function (this: Command, id: string, opts) {
  const body = opts.body ? parseJsonOption(opts.body, 'body') : undefined;
  await runAction(this, () => getClient().experiments.finish(id, body));
});

const dynamicConfigsCmd = program.command('dynamic-configs').description('Dynamic config operations');
addListGetCommands(dynamicConfigsCmd, 'dynamic configs', (c) => c.dynamicConfigs.list(), (c, id) => c.dynamicConfigs.get(id));

const holdoutsCmd = program.command('holdouts').description('Holdout operations');
holdoutsCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().holdouts.list());
});

const segmentsCmd = program.command('segments').description('Segment operations');
segmentsCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().segments.list());
});

const layersCmd = program.command('layers').description('Layer operations');
layersCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().layers.list());
});

const autotunesCmd = program.command('autotunes').description('Autotune operations');
autotunesCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().autotunes.list());
});

const metricsCmd = program.command('metrics').description('Metric operations');
addListGetCommands(metricsCmd, 'metrics', (c) => c.metrics.list(), (c, id) => c.metrics.get(id));

const tagsCmd = program.command('tags').description('Tag operations');
tagsCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().tags.list());
});

const usersCmd = program.command('users').description('User operations');
usersCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().users.list());
});
usersCmd.command('get-by-email <email>').action(async function (this: Command, email: string) {
  await runAction(this, () => getClient().users.getByEmail(email));
});

const teamsCmd = program.command('teams').description('Team operations');
teamsCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().teams.list());
});

const eventsCmd = program.command('events').description('Event operations');
eventsCmd.command('list').action(async function (this: Command) {
  await runAction(this, () => getClient().events.list());
});

program.parse();
