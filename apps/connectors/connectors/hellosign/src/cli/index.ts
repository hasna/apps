#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { HelloSign } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-hellosign';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('HelloSign (Dropbox Sign) connector CLI - Electronic signature with templates and teams')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      process.env.HELLOSIGN_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): HelloSign {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set HELLOSIGN_API_KEY.`);
    process.exit(1);
  }
  return new HelloSign({ apiKey });
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Signature Request Commands
// ============================================
const requestCmd = program
  .command('request')
  .description('Signature request commands');

requestCmd
  .command('list')
  .description('List signature requests')
  .option('-n, --page-size <size>', 'Number of results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .option('-q, --query <query>', 'Search query')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSignatureRequests({
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
        query: opts.query,
      });
      const format = getFormat(requestCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Signature Requests (${result.list_info.num_results} total):`);
        if (result.signature_requests && result.signature_requests.length > 0) {
          result.signature_requests.forEach(r => {
            const status = r.is_complete ? chalk.green('[completed]')
              : r.is_declined ? chalk.red('[declined]')
              : chalk.yellow('[pending]');
            console.log(`  ${r.title || 'Untitled'} ${status}`);
            console.log(`    ID: ${r.signature_request_id}`);
            console.log(`    Signers: ${r.signatures.length}`);
          });
        } else {
          info('No signature requests found');
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('get <requestId>')
  .description('Get signature request details')
  .action(async (requestId: string) => {
    try {
      const client = getClient();
      const result = await client.getSignatureRequest(requestId);
      const format = getFormat(requestCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const r = result.signature_request;
        console.log(chalk.bold(`Signature Request: ${r.title || 'Untitled'}`));
        info(`ID: ${r.signature_request_id}`);
        info(`Subject: ${r.subject || 'N/A'}`);
        info(`Complete: ${r.is_complete ? 'Yes' : 'No'}`);
        info(`Created: ${new Date(r.created_at * 1000).toISOString()}`);
        if (r.signatures.length > 0) {
          console.log(chalk.bold('\nSigners:'));
          r.signatures.forEach(s => {
            const status = s.status_code === 'signed' ? chalk.green('[signed]') : chalk.yellow(`[${s.status_code}]`);
            console.log(`  ${s.signer_name} <${s.signer_email_address}> ${status}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('remind <requestId>')
  .description('Send reminder to a signer')
  .requiredOption('-e, --email <email>', 'Signer email address')
  .action(async (requestId: string, opts) => {
    try {
      const client = getClient();
      await client.sendReminder(requestId, opts.email);
      success(`Reminder sent to ${opts.email}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

requestCmd
  .command('cancel <requestId>')
  .description('Cancel a signature request')
  .action(async (requestId: string) => {
    try {
      const client = getClient();
      await client.cancelSignatureRequest(requestId);
      success(`Signature request cancelled: ${requestId}`);
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
  .description('Template commands');

templateCmd
  .command('list')
  .description('List templates')
  .option('-n, --page-size <size>', 'Number of results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .option('-q, --query <query>', 'Search query')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTemplates({
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
        query: opts.query,
      });
      const format = getFormat(templateCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Templates (${result.list_info.num_results} total):`);
        if (result.templates && result.templates.length > 0) {
          result.templates.forEach(t => {
            console.log(`  ${t.title}`);
            console.log(`    ID: ${t.template_id}`);
            console.log(`    Roles: ${t.signer_roles.map(r => r.name).join(', ')}`);
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
        const t = result.template;
        console.log(chalk.bold(`Template: ${t.title}`));
        info(`ID: ${t.template_id}`);
        info(`Creator: ${t.is_creator ? 'Yes' : 'No'}`);
        info(`Locked: ${t.is_locked ? 'Yes' : 'No'}`);
        if (t.signer_roles.length > 0) {
          console.log(chalk.bold('\nSigner Roles:'));
          t.signer_roles.forEach(r => {
            console.log(`  ${r.name}${r.order !== undefined ? ` (order: ${r.order})` : ''}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd
  .command('delete <templateId>')
  .description('Delete a template')
  .action(async (templateId: string) => {
    try {
      const client = getClient();
      await client.deleteTemplate(templateId);
      success(`Template deleted: ${templateId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program
  .command('account')
  .description('Account commands');

accountCmd
  .command('show')
  .description('Show account details')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getAccount();
      const format = getFormat(accountCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const a = result.account;
        console.log(chalk.bold(`Account: ${a.email_address}`));
        info(`ID: ${a.account_id}`);
        info(`Paid HS: ${a.is_paid_hs ? 'Yes' : 'No'}`);
        info(`Paid HF: ${a.is_paid_hf ? 'Yes' : 'No'}`);
        if (a.quotas) {
          console.log(chalk.bold('\nQuotas:'));
          info(`  Templates: ${a.quotas.templates_left}/${a.quotas.templates_total}`);
          info(`  API Requests Left: ${a.quotas.api_signature_requests_left}`);
          info(`  Documents Left: ${a.quotas.documents_left}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Team Commands
// ============================================
const teamCmd = program
  .command('team')
  .description('Team commands');

teamCmd
  .command('show')
  .description('Show team details')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getTeam();
      const format = getFormat(teamCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const t = result.team;
        console.log(chalk.bold(`Team: ${t.name}`));
        if (t.accounts.length > 0) {
          console.log(chalk.bold('\nMembers:'));
          t.accounts.forEach(a => {
            console.log(`  ${a.email_address} (${a.role_code})`);
          });
        }
        if (t.invited_accounts && t.invited_accounts.length > 0) {
          console.log(chalk.bold('\nInvited:'));
          t.invited_accounts.forEach(a => {
            console.log(`  ${a.email_address}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('create <name>')
  .description('Create a team')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.createTeam(name);
      success(`Team created: ${result.team.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('add-member')
  .description('Add a member to the team')
  .option('-e, --email <email>', 'Member email address')
  .option('-i, --account-id <id>', 'Member account ID')
  .action(async (opts) => {
    try {
      if (!opts.email && !opts.accountId) {
        error('Either --email or --account-id is required');
        process.exit(1);
      }
      const client = getClient();
      await client.addTeamMember({
        email_address: opts.email,
        account_id: opts.accountId,
      });
      success(`Member added to team`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('remove-member')
  .description('Remove a member from the team')
  .option('-e, --email <email>', 'Member email address')
  .option('-i, --account-id <id>', 'Member account ID')
  .action(async (opts) => {
    try {
      if (!opts.email && !opts.accountId) {
        error('Either --email or --account-id is required');
        process.exit(1);
      }
      const client = getClient();
      await client.removeTeamMember({
        email_address: opts.email,
        account_id: opts.accountId,
      });
      success(`Member removed from team`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
