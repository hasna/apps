#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-accredible';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Accredible connector CLI - digital credentials and certificates')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.ACCREDIBLE_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ACCREDIBLE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
// Credentials Commands
// ============================================
const credentialsCmd = program
  .command('credentials')
  .description('Manage digital credentials and certificates');

credentialsCmd
  .command('list')
  .description('List credentials')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .option('--group-id <id>', 'Filter by group ID')
  .option('--email <email>', 'Filter by recipient email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
      };
      if (opts.groupId) params.group_id = parseInt(opts.groupId);
      if (opts.email) params.email = opts.email;
      const result = await client.credentials.list(params as any);
      print(result, getFormat(credentialsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

credentialsCmd
  .command('get <id>')
  .description('Get a credential by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.credentials.get(parseInt(id));
      print(result, getFormat(credentialsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

credentialsCmd
  .command('create')
  .description('Create a new credential')
  .requiredOption('--name <name>', 'Recipient name')
  .requiredOption('--email <email>', 'Recipient email')
  .option('--group-id <id>', 'Group ID')
  .option('--credential-name <name>', 'Credential name')
  .option('--description <desc>', 'Credential description')
  .option('--issued-on <date>', 'Issue date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: any = {
        credential: {
          recipient: {
            name: opts.name,
            email: opts.email,
          },
        },
      };
      if (opts.groupId) params.credential.group_id = parseInt(opts.groupId);
      if (opts.credentialName) params.credential.name = opts.credentialName;
      if (opts.description) params.credential.description = opts.description;
      if (opts.issuedOn) params.credential.issued_on = opts.issuedOn;
      const result = await client.credentials.create(params);
      success('Credential created!');
      print(result, getFormat(credentialsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

credentialsCmd
  .command('delete <id>')
  .description('Delete a credential')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.credentials.delete(parseInt(id));
      success(`Credential ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Groups Commands
// ============================================
const groupsCmd = program
  .command('groups')
  .description('Manage credential groups');

groupsCmd
  .command('list')
  .description('List groups')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.groups.list({
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('get <id>')
  .description('Get a group by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.groups.get(parseInt(id));
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('create')
  .description('Create a new group')
  .requiredOption('--name <name>', 'Group name')
  .option('--course-name <name>', 'Course name')
  .option('--course-description <desc>', 'Course description')
  .option('--course-link <url>', 'Course link')
  .option('--design-id <id>', 'Design ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: any = {
        group: {
          name: opts.name,
        },
      };
      if (opts.courseName) params.group.course_name = opts.courseName;
      if (opts.courseDescription) params.group.course_description = opts.courseDescription;
      if (opts.courseLink) params.group.course_link = opts.courseLink;
      if (opts.designId) params.group.design_id = parseInt(opts.designId);
      const result = await client.groups.create(params);
      success('Group created!');
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('delete <id>')
  .description('Delete a group')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.groups.delete(parseInt(id));
      success(`Group ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Designs Commands
// ============================================
const designsCmd = program
  .command('designs')
  .description('List certificate designs');

designsCmd
  .command('list')
  .description('List available designs')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.designs.list({
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(designsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Evidence Commands
// ============================================
const evidenceCmd = program
  .command('evidence')
  .description('Manage evidence items on credentials');

evidenceCmd
  .command('add <credentialId>')
  .description('Add evidence to a credential')
  .requiredOption('--description <desc>', 'Evidence description')
  .option('--category <category>', 'Evidence category (e.g., grade, url)')
  .option('--url <url>', 'Evidence URL')
  .option('--value <value>', 'Evidence value (for grade category)')
  .option('--hidden', 'Hide evidence from public view')
  .action(async (credentialId: string, opts) => {
    try {
      const client = getClient();
      const item: any = {
        description: opts.description,
      };
      if (opts.category) item.category = opts.category;
      if (opts.url) item.url = opts.url;
      if (opts.value) item.string_object = opts.value;
      if (opts.hidden) item.hidden = true;
      const result = await client.evidence.create(parseInt(credentialId), item);
      success('Evidence item added!');
      print(result, getFormat(evidenceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// SSO Commands
// ============================================
const ssoCmd = program
  .command('sso')
  .description('Single sign-on link generation');

ssoCmd
  .command('generate-link')
  .description('Generate an SSO link for a recipient')
  .requiredOption('--email <email>', 'Recipient email')
  .option('--group-id <id>', 'Group ID')
  .option('--credential-id <id>', 'Credential ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: any = {
        sso: {
          email: opts.email,
        },
      };
      if (opts.groupId) params.sso.group_id = parseInt(opts.groupId);
      if (opts.credentialId) params.sso.credential_id = parseInt(opts.credentialId);
      const result = await client.sso.generateLink(params);
      success('SSO link generated!');
      print(result, getFormat(ssoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
