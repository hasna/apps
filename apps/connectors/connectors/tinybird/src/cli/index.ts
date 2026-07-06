#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tinybird } from '../api';
import {
  getApiKey,
  setApiKey,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'tinybird';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tinybird real-time analytics and data platform connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
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
      process.env.TINYBIRD_API_TOKEN = opts.apiKey;
      process.env.CONNECTOR_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tinybird {
  const apiToken = getApiKey();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set TINYBIRD_API_TOKEN.`);
    process.exit(1);
  }
  return new Tinybird({ apiToken, baseUrl: getBaseUrl() });
}

function run<T>(cmd: Command, fn: () => Promise<T>): void {
  fn()
    .then((result) => print(result, getFormat(cmd)))
    .catch((err) => {
      error(String(err));
      process.exit(1);
    });
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API token')
  .option('--host <url>', 'Custom API host')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { api_token: opts.apiKey, apiKey: opts.apiKey, host: opts.host });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const token = config.api_token || config.apiKey;
  console.log(chalk.bold(`Profile: ${profileName}${profileName === getCurrentProfile() ? chalk.green(' (active)') : ''}`));
  info(`API Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Host: ${config.host || chalk.gray('default (api.tinybird.co)')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API token').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-host <host>').description('Set custom API host').action((host: string) => {
  setBaseUrl(host);
  success(`Host saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Host: ${getBaseUrl() || chalk.gray('default (api.tinybird.co)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// SQL
const sqlCmd = program.command('sql').description('Run SQL queries');

sqlCmd
  .command('query <q>')
  .description('Execute a SQL query')
  .option('--format <format>', 'Response format (json, csv, ndjson, parquet, prometheus)', 'json')
  .action((q: string, opts) => {
    run(sqlCmd, () => getClient().sql.query({ q, format: opts.format }));
  });

// Pipes
const pipesCmd = program.command('pipes').description('Manage and query pipes');

pipesCmd.command('list').option('--attrs <attrs>').option('--dependencies', 'Include dependencies').action((opts) => {
  run(pipesCmd, () => getClient().pipes.list({ attrs: opts.attrs, dependencies: opts.dependencies }));
});

pipesCmd.command('get <name>').action((name: string) => {
  run(pipesCmd, () => getClient().pipes.get(name));
});

pipesCmd
  .command('create <name>')
  .option('-d, --description <description>')
  .option('--sql <sql>')
  .action((name: string, opts) => {
    run(pipesCmd, () => getClient().pipes.create({ name, description: opts.description, sql: opts.sql }));
  });

pipesCmd
  .command('update <name>')
  .option('--new-name <newName>')
  .option('-d, --description <description>')
  .action((name: string, opts) => {
    run(pipesCmd, () => getClient().pipes.update(name, { newName: opts.newName, description: opts.description }));
  });

pipesCmd.command('delete <name>').action((name: string) => {
  run(pipesCmd, () => getClient().pipes.delete(name));
});

pipesCmd
  .command('query <name>')
  .option('--format <format>', 'Response format', 'json')
  .option('--params <json>', 'JSON parameters object for parameterized pipes')
  .action((name: string, opts) => {
    const parameters = opts.params ? JSON.parse(opts.params) : undefined;
    run(pipesCmd, () => getClient().pipes.query(name, { format: opts.format, parameters }));
  });

pipesCmd
  .command('append-node <name> <nodeName> <sql>')
  .option('-d, --description <description>')
  .action((name: string, nodeName: string, sql: string, opts) => {
    run(pipesCmd, () => getClient().pipes.appendNode(name, { nodeName, sql, description: opts.description }));
  });

pipesCmd
  .command('edit-node <name> <nodeId>')
  .option('--sql <sql>')
  .option('-d, --description <description>')
  .action((name: string, nodeId: string, opts) => {
    run(pipesCmd, () => getClient().pipes.editNode(name, nodeId, { sql: opts.sql, description: opts.description }));
  });

pipesCmd.command('delete-node <name> <nodeId>').action((name: string, nodeId: string) => {
  run(pipesCmd, () => getClient().pipes.deleteNode(name, nodeId));
});

pipesCmd.command('explain <name>').action((name: string) => {
  run(pipesCmd, () => getClient().pipes.explain(name));
});

// Datasources
const dsCmd = program.command('datasources').description('Manage datasources');

dsCmd.command('list').option('--attrs <attrs>').action((opts) => {
  run(dsCmd, () => getClient().datasources.list({ attrs: opts.attrs }));
});

dsCmd.command('get <name>').action((name: string) => {
  run(dsCmd, () => getClient().datasources.get(name));
});

dsCmd
  .command('create <name>')
  .requiredOption('--mode <mode>', 'create, append, or replace')
  .option('--schema <schema>')
  .option('--url <url>')
  .option('--format <format>', 'csv, ndjson, or parquet')
  .option('--engine <engine>')
  .action((name: string, opts) => {
    run(dsCmd, () =>
      getClient().datasources.createOrAppend({
        name,
        mode: opts.mode,
        schema: opts.schema,
        url: opts.url,
        format: opts.format,
        engine: opts.engine,
      }),
    );
  });

dsCmd
  .command('alter <name>')
  .option('--schema <schema>')
  .option('-d, --description <description>')
  .option('--ttl <ttl>')
  .option('--kafka-topic <topic>')
  .option('--kafka-store-raw-value')
  .option('--dry-run')
  .action((name: string, opts) => {
    run(dsCmd, () =>
      getClient().datasources.alter(name, {
        schema: opts.schema,
        description: opts.description,
        ttl: opts.ttl,
        kafkaTopic: opts.kafkaTopic,
        kafkaStoreRawValue: opts.kafkaStoreRawValue,
        dryRun: opts.dryRun,
      }),
    );
  });

dsCmd.command('truncate <name>').option('--quarantine').action((name: string, opts) => {
  run(dsCmd, () => getClient().datasources.truncate(name, { quarantine: opts.quarantine }));
});

dsCmd.command('delete-rows <name>').requiredOption('--condition <condition>').action((name: string, opts) => {
  run(dsCmd, () => getClient().datasources.deleteRows(name, opts.condition));
});

dsCmd.command('drop <name>').option('--force').action((name: string, opts) => {
  run(dsCmd, () => getClient().datasources.drop(name, { force: opts.force }));
});

dsCmd.command('rename <name> <newName>').action((name: string, newName: string) => {
  run(dsCmd, () => getClient().datasources.rename(name, newName));
});

// Events
const eventsCmd = program.command('events').description('Ingest events');

eventsCmd
  .command('ingest <name> <ndjson>')
  .description('Ingest NDJSON events into a datasource')
  .action((name: string, ndjson: string) => {
    run(eventsCmd, () => getClient().events.ingest(name, ndjson));
  });

// Tokens
const tokensCmd = program.command('tokens').description('Manage API tokens');

tokensCmd.command('list').action(() => run(tokensCmd, () => getClient().tokens.list()));
tokensCmd.command('get <id>').action((id: string) => run(tokensCmd, () => getClient().tokens.get(id)));
tokensCmd
  .command('create <name>')
  .requiredOption('--scopes <scopes>', 'Comma-separated scopes')
  .option('-d, --description <description>')
  .action((name: string, opts) => {
    run(tokensCmd, () =>
      getClient().tokens.create({ name, scopes: opts.scopes.split(','), description: opts.description }),
    );
  });
tokensCmd
  .command('update <id>')
  .option('--name <name>')
  .option('--scopes <scopes>', 'Comma-separated scopes')
  .option('-d, --description <description>')
  .action((id: string, opts) => {
    run(tokensCmd, () =>
      getClient().tokens.update(id, {
        name: opts.name,
        scopes: opts.scopes ? opts.scopes.split(',') : undefined,
        description: opts.description,
      }),
    );
  });
tokensCmd.command('delete <id>').action((id: string) => run(tokensCmd, () => getClient().tokens.delete(id)));

// Jobs
const jobsCmd = program.command('jobs').description('Manage background jobs');

jobsCmd
  .command('list')
  .option('--limit <limit>')
  .option('--status <status>')
  .option('--kind <kind>')
  .action((opts) => {
    run(jobsCmd, () =>
      getClient().jobs.list({
        limit: opts.limit ? Number(opts.limit) : undefined,
        status: opts.status,
        kind: opts.kind,
      }),
    );
  });

jobsCmd.command('get <id>').action((id: string) => run(jobsCmd, () => getClient().jobs.get(id)));
jobsCmd.command('cancel <id>').action((id: string) => run(jobsCmd, () => getClient().jobs.cancel(id)));

program.parse();
