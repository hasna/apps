#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { DocuSign } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getAccountId,
  setAccountId,
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

const CONNECTOR_NAME = 'connect-docusign';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('DocuSign connector CLI - Electronic signature with envelope management')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-a, --account <id>', 'Account ID (overrides config)')
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
    if (opts.token) {
      process.env.DOCUSIGN_ACCESS_TOKEN = opts.token;
    }
    if (opts.account) {
      process.env.DOCUSIGN_ACCOUNT_ID = opts.account;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): DocuSign {
  const accessToken = getAccessToken();
  const accountId = getAccountId();
  const baseUrl = getBaseUrl();

  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set DOCUSIGN_ACCESS_TOKEN.`);
    process.exit(1);
  }
  if (!accountId) {
    error(`No account ID configured. Run "${CONNECTOR_NAME} config set-account <id>" or set DOCUSIGN_ACCOUNT_ID.`);
    process.exit(1);
  }
  return new DocuSign({ accessToken, accountId, baseUrl });
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

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
    success(`Profiles:`);
    profiles.forEach(p => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
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
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'Access token')
  .option('--account <id>', 'Account ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      accessToken: opts.token,
      accountId: opts.account,
    });
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
    if (deleteProfile(name)) {
      success(`Profile "${name}" deleted`);
    } else {
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (demo)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-account <accountId>')
  .description('Set account ID')
  .action((accountId: string) => {
    setAccountId(accountId);
    success(`Account ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set base URL (for production use)')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const accountId = getAccountId();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${accountId || chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (demo)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Envelope Commands
// ============================================
const envelopeCmd = program
  .command('envelope')
  .description('Envelope management commands');

envelopeCmd
  .command('list')
  .description('List envelopes')
  .option('--from <date>', 'From date (ISO format)')
  .option('--to <date>', 'To date (ISO format)')
  .option('--status <status>', 'Filter by status')
  .option('-n, --count <count>', 'Number of results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEnvelopes({
        from_date: opts.from,
        to_date: opts.to,
        status: opts.status,
        count: parseInt(opts.count),
      });
      const format = getFormat(envelopeCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Envelopes (${result.resultSetSize}):`);
        if (result.envelopes) {
          result.envelopes.forEach(e => {
            const status = e.status === 'completed' ? chalk.green(`[${e.status}]`)
              : e.status === 'sent' ? chalk.yellow(`[${e.status}]`)
              : chalk.gray(`[${e.status}]`);
            console.log(`  ${e.emailSubject || 'No subject'} ${status}`);
            console.log(`    ID: ${e.envelopeId}`);
            if (e.sentDateTime) console.log(`    Sent: ${e.sentDateTime}`);
          });
        } else {
          info('No envelopes found');
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

envelopeCmd
  .command('get <envelopeId>')
  .description('Get envelope details')
  .action(async (envelopeId: string) => {
    try {
      const client = getClient();
      const result = await client.getEnvelope(envelopeId);
      const format = getFormat(envelopeCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Envelope: ${result.emailSubject || 'No subject'}`));
        info(`ID: ${result.envelopeId}`);
        info(`Status: ${result.status}`);
        if (result.sentDateTime) info(`Sent: ${result.sentDateTime}`);
        if (result.completedDateTime) info(`Completed: ${result.completedDateTime}`);
        if (result.createdDateTime) info(`Created: ${result.createdDateTime}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

envelopeCmd
  .command('send <envelopeId>')
  .description('Send a draft envelope')
  .action(async (envelopeId: string) => {
    try {
      const client = getClient();
      const result = await client.sendEnvelope(envelopeId);
      success(`Envelope sent: ${result.envelopeId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

envelopeCmd
  .command('void <envelopeId>')
  .description('Void an envelope')
  .requiredOption('-r, --reason <reason>', 'Reason for voiding')
  .action(async (envelopeId: string, opts) => {
    try {
      const client = getClient();
      await client.voidEnvelope(envelopeId, opts.reason);
      success(`Envelope voided: ${envelopeId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Template Commands
// ============================================
const templateCmd = program
  .command('template')
  .description('Template management commands');

templateCmd
  .command('list')
  .description('List templates')
  .option('-n, --count <count>', 'Number of results', '20')
  .option('-s, --search <text>', 'Search text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTemplates({
        count: parseInt(opts.count),
        search_text: opts.search,
      });
      const format = getFormat(templateCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Templates (${result.resultSetSize}):`);
        if (result.envelopeTemplates) {
          result.envelopeTemplates.forEach(t => {
            console.log(`  ${t.name}`);
            console.log(`    ID: ${t.templateId}`);
            if (t.description) console.log(`    ${chalk.gray(t.description)}`);
          });
        } else {
          info('No templates found');
        }
      }
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
      const client = getClient();
      const result = await client.getTemplate(templateId);
      const format = getFormat(templateCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Template: ${result.name}`));
        info(`ID: ${result.templateId}`);
        if (result.description) info(`Description: ${result.description}`);
        if (result.created) info(`Created: ${result.created}`);
        if (result.lastModified) info(`Last Modified: ${result.lastModified}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
