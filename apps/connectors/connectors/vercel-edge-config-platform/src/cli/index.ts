#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { EdgeConfigPlatform } from '../api';
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
  getTeamId,
  setTeamId,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-vercel-edge-config-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vercel Edge Config Platform connector - Manage Edge Configs via api.vercel.com')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --team-id <id>', 'Team ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
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
    if (opts.apiKey) {
      process.env.VERCEL_TOKEN = opts.apiKey;
    }
    if (opts.teamId) {
      process.env.VERCEL_TEAM_ID = opts.teamId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): EdgeConfigPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VERCEL_TOKEN.`);
    process.exit(1);
  }
  return new EdgeConfigPlatform({ apiKey, teamId: getTeamId() });
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
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--team-id <id>', 'Team ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, teamId: opts.teamId });
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
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
  } else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Team ID: ${config.teamId || chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-team <teamId>').description('Set team ID').action((teamId: string) => {
  setTeamId(teamId);
  success(`Team ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  const teamId = getTeamId();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Team ID: ${teamId || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Edge Config commands
const edgeConfigCmd = program.command('edge-config').description('Edge Config operations');

edgeConfigCmd.command('ls').description('List Edge Configs').action(async () => {
  try {
    const client = getClient();
    const result = await client.listEdgeConfigs();
    print(result, getFormat(edgeConfigCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

edgeConfigCmd
  .command('create <slug>')
  .description('Create an Edge Config')
  .action(async (slug: string) => {
    try {
      const client = getClient();
      const result = await client.createEdgeConfig({ slug });
      success('Edge Config created!');
      print(result, getFormat(edgeConfigCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

edgeConfigCmd.command('get <id>').description('Get an Edge Config').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.getEdgeConfig(id);
    print(result, getFormat(edgeConfigCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

edgeConfigCmd
  .command('update <id> <slug>')
  .description('Update an Edge Config slug')
  .action(async (id: string, slug: string) => {
    try {
      const client = getClient();
      const result = await client.updateEdgeConfig(id, { slug });
      success('Edge Config updated!');
      print(result, getFormat(edgeConfigCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

edgeConfigCmd.command('delete <id>').description('Delete an Edge Config').action(async (id: string) => {
  try {
    const client = getClient();
    await client.deleteEdgeConfig(id);
    success(`Edge Config ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Item commands
const itemCmd = program.command('item').description('Edge Config item operations');

itemCmd.command('ls <edgeConfigId>').description('List items').action(async (edgeConfigId: string) => {
  try {
    const client = getClient();
    const result = await client.listItems(edgeConfigId);
    print(result, getFormat(itemCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

itemCmd
  .command('get <edgeConfigId> <key>')
  .description('Get a single item')
  .action(async (edgeConfigId: string, key: string) => {
    try {
      const client = getClient();
      const result = await client.getItem(edgeConfigId, key);
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('patch <edgeConfigId>')
  .description('Batch update items (JSON body via --items)')
  .requiredOption('--items <json>', 'JSON array of patch operations')
  .action(async (edgeConfigId: string, opts) => {
    try {
      const items = JSON.parse(opts.items);
      const client = getClient();
      const result = await client.patchItems(edgeConfigId, { items });
      success('Items patched!');
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Schema commands
const schemaCmd = program.command('schema').description('Edge Config schema operations');

schemaCmd.command('get <edgeConfigId>').description('Get schema').action(async (edgeConfigId: string) => {
  try {
    const client = getClient();
    const result = await client.getSchema(edgeConfigId);
    print(result, getFormat(schemaCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

schemaCmd
  .command('update <edgeConfigId>')
  .description('Update schema')
  .requiredOption('--definition <json>', 'JSON schema definition')
  .option('--dry-run', 'Validate without applying')
  .action(async (edgeConfigId: string, opts) => {
    try {
      const definition = JSON.parse(opts.definition);
      const client = getClient();
      const result = await client.updateSchema(edgeConfigId, { definition }, { dryRun: opts.dryRun });
      success('Schema updated!');
      print(result, getFormat(schemaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemaCmd.command('delete <edgeConfigId>').description('Delete schema').action(async (edgeConfigId: string) => {
  try {
    const client = getClient();
    await client.deleteSchema(edgeConfigId);
    success('Schema deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Token commands
const tokenCmd = program.command('token').description('Edge Config token operations');

tokenCmd.command('ls <edgeConfigId>').description('List tokens').action(async (edgeConfigId: string) => {
  try {
    const client = getClient();
    const result = await client.listTokens(edgeConfigId);
    print(result, getFormat(tokenCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

tokenCmd
  .command('get <edgeConfigId> <token>')
  .description('Get token metadata')
  .action(async (edgeConfigId: string, token: string) => {
    try {
      const client = getClient();
      const result = await client.getToken(edgeConfigId, token);
      print(result, getFormat(tokenCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tokenCmd
  .command('create <edgeConfigId> <label>')
  .description('Create a token')
  .action(async (edgeConfigId: string, label: string) => {
    try {
      const client = getClient();
      const result = await client.createToken(edgeConfigId, { label });
      success('Token created!');
      print(result, getFormat(tokenCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tokenCmd
  .command('delete <edgeConfigId>')
  .description('Delete tokens')
  .option('--tokens <tokens>', 'Comma-separated token values')
  .option('--ids <ids>', 'Comma-separated token IDs')
  .action(async (edgeConfigId: string, opts) => {
    try {
      const params: { tokens?: string[]; ids?: string[] } = {};
      if (opts.tokens) params.tokens = opts.tokens.split(',').map((t: string) => t.trim());
      if (opts.ids) params.ids = opts.ids.split(',').map((t: string) => t.trim());
      if (!params.tokens && !params.ids) {
        error('Provide --tokens or --ids');
        process.exit(1);
      }
      const client = getClient();
      await client.deleteTokens(edgeConfigId, params);
      success('Tokens deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Backup commands
const backupCmd = program.command('backup').description('Edge Config backup operations');

backupCmd.command('ls <edgeConfigId>').description('List backups').action(async (edgeConfigId: string) => {
  try {
    const client = getClient();
    const result = await client.listBackups(edgeConfigId);
    print(result, getFormat(backupCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

backupCmd
  .command('get <edgeConfigId> <versionId>')
  .description('Get a backup')
  .action(async (edgeConfigId: string, versionId: string) => {
    try {
      const client = getClient();
      const result = await client.getBackup(edgeConfigId, versionId);
      print(result, getFormat(backupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

backupCmd
  .command('restore <edgeConfigId> <versionId>')
  .description('Restore from backup')
  .action(async (edgeConfigId: string, versionId: string) => {
    try {
      const client = getClient();
      const result = await client.restoreBackup(edgeConfigId, versionId);
      success('Backup restored!');
      print(result, getFormat(backupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
