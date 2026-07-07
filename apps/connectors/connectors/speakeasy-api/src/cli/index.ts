#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
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
  buildConnectorConfig,
  getWorkspaceId,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-speakeasy-api';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Speakeasy API connector CLI')
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
        error(`Profile "${opts.profile}" does not exist.`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.SPEAKEASY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPEAKEASY_API_KEY.`);
    process.exit(1);
  }
  return new Connector(buildConnectorConfig());
}

function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
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

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Workspace ID: ${config.workspaceId || chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Workspace ID: ${getWorkspaceId() || chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Auth commands
const authCmd = program.command('auth').description('Authentication');

authCmd.command('validate').action(async () => {
  try {
    const client = getClient();
    const result = await client.auth.validate();
    success('API key is valid');
    print(result, getFormat(authCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// APIs commands
const apisCmd = program.command('apis').description('Manage APIs');

apisCmd.command('list').action(async () => {
  try {
    const result = await getClient().apis.list();
    print(result, getFormat(apisCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

apisCmd.command('versions <apiID>').action(async (apiID: string) => {
  try {
    const result = await getClient().apis.listVersions(apiID);
    print(result, getFormat(apisCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

apisCmd
  .command('upsert <apiID>')
  .requiredOption('--body <json>', 'API JSON body')
  .action(async (apiID: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, '--body');
      const result = await getClient().apis.upsert(apiID, body as never);
      print(result, getFormat(apisCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

apisCmd
  .command('delete <apiID> <versionID>')
  .action(async (apiID: string, versionID: string) => {
    try {
      await getClient().apis.delete(apiID, versionID);
      success(`Deleted API ${apiID} version ${versionID}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Endpoints commands
const endpointsCmd = program.command('endpoints').description('Manage API endpoints');

endpointsCmd
  .command('list <apiID> <versionID>')
  .action(async (apiID: string, versionID: string) => {
    try {
      const result = await getClient().endpoints.list(apiID, versionID);
      print(result, getFormat(endpointsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

endpointsCmd
  .command('find <apiID> <versionID> <displayName>')
  .action(async (apiID: string, versionID: string, displayName: string) => {
    try {
      const result = await getClient().endpoints.find(apiID, versionID, displayName);
      print(result, getFormat(endpointsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

endpointsCmd
  .command('get <apiID> <versionID> <endpointID>')
  .action(async (apiID: string, versionID: string, endpointID: string) => {
    try {
      const result = await getClient().endpoints.get(apiID, versionID, endpointID);
      print(result, getFormat(endpointsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

endpointsCmd
  .command('upsert <apiID> <versionID> <endpointID>')
  .requiredOption('--body <json>', 'Endpoint JSON body')
  .action(async (apiID: string, versionID: string, endpointID: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, '--body');
      const result = await getClient().endpoints.upsert(apiID, versionID, endpointID, body as never);
      print(result, getFormat(endpointsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

endpointsCmd
  .command('delete <apiID> <versionID> <endpointID>')
  .action(async (apiID: string, versionID: string, endpointID: string) => {
    try {
      await getClient().endpoints.delete(apiID, versionID, endpointID);
      success('Endpoint deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Metadata commands
const metadataCmd = program.command('metadata').description('Version metadata');

metadataCmd
  .command('list <apiID> <versionID>')
  .action(async (apiID: string, versionID: string) => {
    try {
      const result = await getClient().metadata.list(apiID, versionID);
      print(result, getFormat(metadataCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metadataCmd
  .command('insert <apiID> <versionID>')
  .requiredOption('--body <json>', 'Metadata JSON body')
  .action(async (apiID: string, versionID: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, '--body');
      const result = await getClient().metadata.insert(apiID, versionID, body as never);
      print(result, getFormat(metadataCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metadataCmd
  .command('delete <apiID> <versionID> <metaKey> <metaValue>')
  .action(async (apiID: string, versionID: string, metaKey: string, metaValue: string) => {
    try {
      await getClient().metadata.delete(apiID, versionID, metaKey, metaValue);
      success('Metadata deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Schemas commands
const schemasCmd = program.command('schemas').description('OpenAPI schema management');

schemasCmd
  .command('get <apiID> <versionID>')
  .action(async (apiID: string, versionID: string) => {
    try {
      const result = await getClient().schemas.get(apiID, versionID);
      print(result, getFormat(schemasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemasCmd
  .command('list <apiID> <versionID>')
  .action(async (apiID: string, versionID: string) => {
    try {
      const result = await getClient().schemas.list(apiID, versionID);
      print(result, getFormat(schemasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemasCmd
  .command('download <apiID> <versionID>')
  .action(async (apiID: string, versionID: string) => {
    try {
      const result = await getClient().schemas.download(apiID, versionID);
      console.log(result);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemasCmd
  .command('register <apiID> <versionID> <file>')
  .action(async (apiID: string, versionID: string, file: string) => {
    try {
      const content = readFileSync(file);
      const blob = new Blob([content]);
      await getClient().schemas.register(apiID, versionID, blob);
      success('Schema registered');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemasCmd
  .command('diff <apiID> <versionID> <baseRevision> <targetRevision>')
  .action(async (apiID: string, versionID: string, baseRevision: string, targetRevision: string) => {
    try {
      const result = await getClient().schemas.diff(apiID, versionID, baseRevision, targetRevision);
      print(result, getFormat(schemasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Eventlog commands
const eventlogCmd = program.command('eventlog').description('Request event log');

eventlogCmd
  .command('query')
  .option('--filters <json>', 'Filters JSON')
  .action(async (opts) => {
    try {
      const filters = opts.filters ? (parseJsonOption(opts.filters, '--filters') as never) : undefined;
      const result = await getClient().eventlog.query(filters);
      print(result, getFormat(eventlogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventlogCmd.command('get <requestID>').action(async (requestID: string) => {
  try {
    const result = await getClient().eventlog.get(requestID);
    print(result, getFormat(eventlogCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Embeds commands
const embedsCmd = program.command('embeds').description('Embed access tokens');

embedsCmd
  .command('token')
  .option('--description <text>', 'Token description')
  .option('--duration <minutes>', 'Duration in minutes', parseInt)
  .action(async (opts) => {
    try {
      const result = await getClient().embeds.getAccessToken({
        description: opts.description,
        duration: opts.duration,
      });
      print(result, getFormat(embedsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

embedsCmd.command('list').action(async () => {
  try {
    const result = await getClient().embeds.listValid();
    print(result, getFormat(embedsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

embedsCmd.command('revoke <tokenID>').action(async (tokenID: string) => {
  try {
    await getClient().embeds.revoke(tokenID);
    success('Token revoked');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Events commands
const eventsCmd = program.command('events').description('Post workspace events');

eventsCmd
  .command('post')
  .requiredOption('--workspace-id <id>', 'Workspace ID')
  .requiredOption('--body <json>', 'CliEventBatch JSON array')
  .action(async (opts) => {
    try {
      const events = parseJsonOption(opts.body, '--body') as never;
      await getClient().events.post(opts.workspaceId, events);
      success('Events posted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw escape hatch
program
  .command('raw <method> <path>')
  .option('--params <json>', 'Query params JSON object')
  .option('--body <json>', 'Request body JSON')
  .action(async (method: string, path: string, opts) => {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(upper)) {
      error('Method must be GET, POST, PUT, or DELETE');
      process.exit(1);
    }
    try {
      const params = opts.params ? (parseJsonOption(opts.params, '--params') as Record<string, string>) : undefined;
      const body = opts.body ? parseJsonOption(opts.body, '--body') : undefined;
      const result = await getClient().raw(upper as 'GET' | 'POST' | 'PUT' | 'DELETE', path, { params, body: body as never });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
