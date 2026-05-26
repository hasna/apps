#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Modal } from '../api';
import {
  getTokenId, getTokenSecret, setTokenId, setTokenSecret, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-modal';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Modal connector CLI - Serverless cloud functions')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Modal {
  const tokenId = getTokenId();
  const tokenSecret = getTokenSecret();
  if (!tokenId || !tokenSecret) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-token" or set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET`);
    process.exit(1);
  }
  return new Modal({ tokenId, tokenSecret });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles found'); return; }
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" does not exist`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--token-id <id>', 'Token ID')
  .option('--token-secret <secret>', 'Token Secret')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { tokenId: opts.tokenId, tokenSecret: opts.tokenSecret });
    success(`Profile "${name}" created`);
    if (opts.use) { setCurrentProfile(name); info(`Switched to profile: ${name}`); }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') { error('Cannot delete default profile'); process.exit(1); }
  if (deleteProfile(name)) { success(`Profile "${name}" deleted`); }
  else { error(`Profile "${name}" not found`); process.exit(1); }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token ID: ${config.tokenId ? config.tokenId.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Token Secret: ${config.tokenSecret ? '********' : chalk.gray('not set')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-token')
  .description('Set Modal tokens')
  .requiredOption('--id <tokenId>', 'Token ID')
  .requiredOption('--secret <tokenSecret>', 'Token Secret')
  .action((opts) => {
    setTokenId(opts.id);
    setTokenSecret(opts.secret);
    success(`Tokens saved`);
  });

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const tokenId = getTokenId();
  info(`Token ID: ${tokenId ? tokenId.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Token Secret: ${getTokenSecret() ? '********' : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Web Endpoint Command
program.command('call <url>')
  .description('Call a Modal web endpoint')
  .option('-d, --data <json>', 'Request data as JSON')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const data = opts.data ? JSON.parse(opts.data) : undefined;
      const result = await client.callWebEndpoint(url, data);
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.green('\nResponse:'));
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Apps Commands
const appsCmd = program.command('apps').description('Manage apps');

appsCmd.command('list')
  .description('List apps')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listApps();
      if (getFormat(appsCmd) === 'json') {
        print(result.apps, 'json');
      } else {
        if (result.apps.length === 0) {
          info('No apps found');
          return;
        }
        result.apps.forEach(app => {
          console.log(chalk.cyan(`\n${app.name}`));
          console.log(`  ID: ${app.app_id}`);
          console.log(`  State: ${app.state}`);
          console.log(`  Created: ${app.created_at}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Secrets Commands
const secretsCmd = program.command('secrets').description('Manage secrets');

secretsCmd.command('list')
  .description('List secrets')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listSecrets();
      if (getFormat(secretsCmd) === 'json') {
        print(result.secrets, 'json');
      } else {
        if (result.secrets.length === 0) {
          info('No secrets found');
          return;
        }
        result.secrets.forEach(secret => {
          console.log(chalk.cyan(`\n${secret.name}`));
          console.log(`  Created: ${secret.created_at}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

secretsCmd.command('create <name>')
  .description('Create a secret')
  .requiredOption('-v, --values <json>', 'Secret values as JSON')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const values = JSON.parse(opts.values);
      await client.createSecret(name, values);
      success(`Secret "${name}" created`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

secretsCmd.command('delete <name>')
  .description('Delete a secret')
  .action(async (name: string) => {
    try {
      const client = getClient();
      await client.deleteSecret(name);
      success(`Secret "${name}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
