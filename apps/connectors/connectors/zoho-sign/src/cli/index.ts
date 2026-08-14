#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoSign } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'zoho-sign';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Sign connector CLI - Electronic signature and document signing')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth token (overrides config)')
  .option('-d, --data-center <dc>', 'Data center (com, eu, in, com.au, jp, ca)')
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
    if (opts.token) process.env.ZOHO_SIGN_TOKEN = opts.token;
    if (opts.dataCenter) process.env.ZOHO_SIGN_DATA_CENTER = opts.dataCenter;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoSign {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHO_SIGN_TOKEN.`);
    process.exit(1);
  }
  return new ZohoSign({ token, dataCenter: getDataCenter(), baseUrl: getBaseUrl() });
}

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

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
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
  .option('--token <token>', 'OAuth token')
  .option('--data-center <dc>', 'Data center')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { token: opts.token, dataCenter: opts.dataCenter });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
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

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set OAuth token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-data-center <dc>').description('Set data center').action((dc: string) => {
  setDataCenter(dc);
  success(`Data center saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-url <baseUrl>').description('Set base URL override').action((baseUrl: string) => {
  setBaseUrl(baseUrl);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter() || chalk.gray('com (default)')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const requestCmd = program.command('request').description('Document request commands');

requestCmd
  .command('list')
  .description('List document requests')
  .option('-n, --count <count>', 'Row count', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listRequests({ row_count: parseInt(opts.count, 10) });
      print(result.requests ?? result, getFormat(requestCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('get <requestId>')
  .description('Get a document request')
  .action(async (requestId: string) => {
    try {
      const client = getClient();
      const result = await client.getRequest(requestId);
      print(result.requests ?? result, getFormat(requestCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('send <requestId>')
  .description('Submit/send a draft request')
  .action(async (requestId: string) => {
    try {
      const client = getClient();
      const result = await client.sendRequest(requestId);
      success(`Request submitted: ${requestId}`);
      print(result.requests ?? result, getFormat(requestCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('delete <requestId>')
  .description('Delete a request')
  .action(async (requestId: string) => {
    try {
      await getClient().deleteRequest(requestId);
      success(`Request deleted: ${requestId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('recall <requestId>')
  .description('Recall a sent request')
  .action(async (requestId: string) => {
    try {
      await getClient().recallRequest(requestId);
      success(`Request recalled: ${requestId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('remind <requestId>')
  .description('Send reminder for a request')
  .action(async (requestId: string) => {
    try {
      await getClient().remindRequest(requestId);
      success(`Reminder sent: ${requestId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const templateCmd = program.command('template').description('Template commands');

templateCmd
  .command('list')
  .description('List templates')
  .option('-n, --count <count>', 'Row count', '20')
  .action(async (opts) => {
    try {
      const result = await getClient().listTemplates({ row_count: parseInt(opts.count, 10) });
      print(result.templates ?? result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd
  .command('get <templateId>')
  .description('Get template details')
  .action(async (templateId: string) => {
    try {
      const result = await getClient().getTemplate(templateId);
      print(result.templates ?? result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const folderCmd = program.command('folder').description('Folder commands');

folderCmd.command('list').description('List folders').action(async () => {
  try {
    const result = await getClient().listFolders();
    print(result.folders ?? result, getFormat(folderCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const userCmd = program.command('user').description('User management commands');

userCmd.command('list').description('List users').action(async () => {
  try {
    const result = await getClient().listUsers();
    print(result.users ?? result, getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

userCmd
  .command('get <userId>')
  .description('Get user details')
  .action(async (userId: string) => {
    try {
      const result = await getClient().getUser(userId);
      print(result.users ?? result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const webhookCmd = program.command('webhook').description('Webhook commands');

webhookCmd.command('list').description('List webhooks').action(async () => {
  try {
    const result = await getClient().listWebhooks();
    print(result.webhooks ?? result, getFormat(webhookCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const accountCmd = program.command('account').description('Get organization account details');

accountCmd.action(async () => {
  try {
    const result = await getClient().getAccount();
    print(result.account ?? result, getFormat(accountCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
