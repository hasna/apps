#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoCreator } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getDataCenter,
  setDataCenter,
  getEnvironment,
  setEnvironment,
  getZohoCreatorConfig,
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
import { success, error, info, print, setVerboseMode } from '../utils/output';

const CONNECTOR_NAME = 'connect-zoho-creator';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Creator API connector — low-code apps, forms, reports, and records')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides profile)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setVerboseMode(true);
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) process.env.ZOHOCREATOR_ACCESS_TOKEN = opts.token;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoCreator {
  const config = getZohoCreatorConfig();
  if (!config) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOCREATOR_ACCESS_TOKEN.`);
    process.exit(1);
  }
  return new ZohoCreator(config);
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON for ${label}`);
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
  profiles.forEach((p) => console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`));
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
  .option('--token <token>', 'OAuth access token')
  .option('--data-center <dc>', 'Data center (com, eu, in, com.au, jp, ca, sa)')
  .option('--environment <env>', 'Environment (production, stage)')
  .action((name: string, opts) => {
    try {
      if (profileExists(name)) {
        error(`Profile "${name}" already exists`);
        process.exit(1);
      }
      createProfile(name, {
        accessToken: opts.token,
        dataCenter: opts.dataCenter,
        environment: opts.environment,
      });
      success(`Profile "${name}" created`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
  info(`Environment: ${config.environment || chalk.gray('production (default)')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setAccessToken(token);
  success(`Access token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-data-center <dc>').action((dc: string) => {
  try {
    setDataCenter(dc as Parameters<typeof setDataCenter>[0]);
    success(`Data center set to: ${dc}`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

configCmd.command('set-environment <env>').action((env: string) => {
  try {
    setEnvironment(env as Parameters<typeof setEnvironment>[0]);
    success(`Environment set to: ${env}`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${getAccessToken() ? `${getAccessToken()!.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter() || 'com'}`);
  info(`Environment: ${getEnvironment() || 'production'}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Applications
const appsCmd = program.command('applications').description('Zoho Creator applications');

appsCmd.command('list').action(async () => {
  try {
    const result = await getClient().listApplications();
    print(result, getFormat(appsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

appsCmd
  .command('get <accountOwner> <appLinkName>')
  .action(async (accountOwner: string, appLinkName: string) => {
    try {
      const result = await getClient().getApplication(accountOwner, appLinkName);
      print(result, getFormat(appsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Forms
const formsCmd = program.command('forms').description('Zoho Creator forms');

formsCmd
  .command('list <accountOwner> <appLinkName>')
  .action(async (accountOwner: string, appLinkName: string) => {
    try {
      const result = await getClient().listForms(accountOwner, appLinkName);
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Reports
const reportsCmd = program.command('reports').description('Zoho Creator reports');

reportsCmd
  .command('list <accountOwner> <appLinkName>')
  .action(async (accountOwner: string, appLinkName: string) => {
    try {
      const result = await getClient().listReports(accountOwner, appLinkName);
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('records <accountOwner> <appLinkName> <reportLinkName>')
  .option('-c, --criteria <criteria>', 'Filter criteria')
  .option('--from <n>', 'Start index', parseInt)
  .option('--max-records <n>', 'Max records', parseInt)
  .action(async (accountOwner: string, appLinkName: string, reportLinkName: string, opts) => {
    try {
      const result = await getClient().getReportRecords(accountOwner, appLinkName, reportLinkName, {
        criteria: opts.criteria,
        from: opts.from,
        max_records: opts.maxRecords,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('count <accountOwner> <appLinkName> <reportLinkName>')
  .option('-c, --criteria <criteria>', 'Filter criteria')
  .action(async (accountOwner: string, appLinkName: string, reportLinkName: string, opts) => {
    try {
      const result = await getClient().getRecordCount(accountOwner, appLinkName, reportLinkName, {
        criteria: opts.criteria,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Records
const recordsCmd = program.command('records').description('Zoho Creator records');

recordsCmd
  .command('add <accountOwner> <appLinkName> <formLinkName>')
  .requiredOption('-d, --data <json>', 'Record data as JSON object')
  .action(async (accountOwner: string, appLinkName: string, formLinkName: string, opts) => {
    try {
      const data = parseJsonOption(opts.data, '--data');
      const result = await getClient().addRecord(accountOwner, appLinkName, formLinkName, data);
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd
  .command('update <accountOwner> <appLinkName> <reportLinkName> <recordId>')
  .requiredOption('-d, --data <json>', 'Record data as JSON object')
  .action(async (accountOwner: string, appLinkName: string, reportLinkName: string, recordId: string, opts) => {
    try {
      const data = parseJsonOption(opts.data, '--data');
      const result = await getClient().updateRecord(accountOwner, appLinkName, reportLinkName, recordId, data);
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd
  .command('delete <accountOwner> <appLinkName> <reportLinkName> <recordId>')
  .action(async (accountOwner: string, appLinkName: string, reportLinkName: string, recordId: string) => {
    try {
      const result = await getClient().deleteRecord(accountOwner, appLinkName, reportLinkName, recordId);
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Functions
const functionsCmd = program.command('functions').description('Zoho Creator Deluge functions');

functionsCmd
  .command('invoke <accountOwner> <appLinkName> <functionLinkName>')
  .option('-p, --payload <json>', 'Function payload as JSON')
  .option('--public-key <key>', 'Public key for published functions')
  .action(async (accountOwner: string, appLinkName: string, functionLinkName: string, opts) => {
    try {
      const payload = opts.payload ? parseJsonOption(opts.payload, '--payload') : undefined;
      const result = await getClient().invokeFunction(accountOwner, appLinkName, functionLinkName, {
        payload,
        publicKey: opts.publicKey,
      });
      print(result, getFormat(functionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
