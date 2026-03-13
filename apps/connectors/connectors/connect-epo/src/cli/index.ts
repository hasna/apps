#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { EPO } from '../api';
import {
  getConsumerKey,
  getConsumerSecret,
  setCredentials,
  getBaseUrl,
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
  clearToken,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';
import type { DocumentType, DocumentFormat } from '../types';

const CONNECTOR_NAME = 'connect-epo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('EPO Open Patent Services (OPS) API connector - Search and retrieve patent data')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

// Helper to get root command format
function getRootFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): EPO {
  const consumerKey = getConsumerKey();
  const consumerSecret = getConsumerSecret();
  if (!consumerKey || !consumerSecret) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-credentials <key> <secret>" or set EPO_CONSUMER_KEY and EPO_CONSUMER_SECRET environment variables.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new EPO({ consumerKey, consumerSecret, baseUrl });
}

// Helper to parse document reference
function parseDocRef(input: string): { type: DocumentType; format: DocumentFormat; number: string } {
  // Default to publication/epodoc
  return {
    type: 'publication',
    format: 'epodoc',
    number: input,
  };
}

// ============================================
// Search Command
// ============================================
program
  .command('search <query>')
  .description('Search published patents using CQL query (e.g., "ti=solar AND pa=tesla")')
  .option('--range <range>', 'Result range (e.g., "1-25")', '1-25')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();

      const [begin, end] = opts.range.split('-').map((n: string) => parseInt(n));

      const result = await client.publications.search(query, {
        rangeBegin: begin,
        rangeEnd: end,
      });

      if (result.success) {
        success(`Found ${result.totalResults || 0} results`);
        print(result.results, getRootFormat());
      } else {
        error(result.error || 'Search failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Publication Commands
// ============================================
const pubCmd = program
  .command('publication')
  .alias('pub')
  .description('Get publication data');

pubCmd
  .command('get <number>')
  .description('Get publication by document number')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.publications.getPublication(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Publication retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get publication');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pubCmd
  .command('biblio <number>')
  .description('Get bibliographic data for a publication')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.publications.getBiblio(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Bibliographic data retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get bibliographic data');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pubCmd
  .command('abstract <number>')
  .description('Get abstract for a publication')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.publications.getAbstract(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Abstract retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get abstract');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pubCmd
  .command('description <number>')
  .description('Get description for a publication')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.publications.getDescription(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Description retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get description');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pubCmd
  .command('claims <number>')
  .description('Get claims for a publication')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.publications.getClaims(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Claims retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get claims');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pubCmd
  .command('images <number>')
  .description('Get images metadata for a publication')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.publications.getImages(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Images metadata retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get images');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Family Commands
// ============================================
const familyCmd = program
  .command('family')
  .description('Get patent family (INPADOC) data');

familyCmd
  .command('get <number>')
  .description('Get patent family for a document')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.family.getFamily(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success(`Family retrieved: ${result.data?.totalMembers || 0} members`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get family');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

familyCmd
  .command('biblio <number>')
  .description('Get patent family with bibliographic data')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.family.getFamilyWithBiblio(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success(`Family with biblio retrieved: ${result.data?.totalMembers || 0} members`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get family with biblio');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

familyCmd
  .command('legal <number>')
  .description('Get patent family with legal status')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.family.getFamilyWithLegal(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success(`Family with legal status retrieved: ${result.data?.totalMembers || 0} members`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get family with legal');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Legal Status Commands
// ============================================
program
  .command('legal <number>')
  .description('Get legal status for a document')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.legal.getLegalStatus(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success(`Legal status retrieved: ${result.data?.events.length || 0} events`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get legal status');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Register Commands
// ============================================
const registerCmd = program
  .command('register')
  .alias('reg')
  .description('Access EP Register data');

registerCmd
  .command('search <query>')
  .description('Search the EP Register')
  .option('--range <range>', 'Result range (e.g., "1-25")', '1-25')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();

      const [begin, end] = opts.range.split('-').map((n: string) => parseInt(n));

      const result = await client.register.search(query, {
        rangeBegin: begin,
        rangeEnd: end,
      });

      if (result.success) {
        success(`Found ${result.totalResults || 0} results`);
        print(result.results, getRootFormat());
      } else {
        error(result.error || 'Register search failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

registerCmd
  .command('get <number>')
  .description('Get register data for a publication')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'publication')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.register.getRegisterData(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Register data retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get register data');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

registerCmd
  .command('procedural-steps <number>')
  .alias('steps')
  .description('Get procedural steps for an application')
  .option('-t, --type <type>', 'Document type (publication, application, priority)', 'application')
  .option('--format <format>', 'Document format (docdb, epodoc, original)', 'epodoc')
  .action(async (number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.register.getProceduralSteps(
        opts.type as DocumentType,
        opts.format as DocumentFormat,
        number
      );

      if (result.success) {
        success('Procedural steps retrieved');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get procedural steps');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Classification Commands
// ============================================
const classCmd = program
  .command('classification')
  .alias('class')
  .description('Access CPC classification data');

classCmd
  .command('get <symbol>')
  .description('Get CPC classification by symbol (e.g., "H01L", "A01B1/00")')
  .option('--children', 'Include child classifications')
  .option('--ancestors', 'Include ancestor classifications')
  .action(async (symbol: string, opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.children) {
        result = await client.classification.getCPCWithChildren(symbol);
      } else if (opts.ancestors) {
        result = await client.classification.getCPCWithAncestors(symbol);
      } else {
        result = await client.classification.getCPC(symbol);
      }

      if (result.success) {
        success(`Classification retrieved: ${result.data?.length || 0} nodes`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Failed to get classification');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

classCmd
  .command('search <query>')
  .description('Search CPC classifications by keyword')
  .action(async (query: string) => {
    try {
      const client = getClient();
      const result = await client.classification.searchCPC(query);

      if (result.success) {
        success(`Found ${result.data?.length || 0} classifications`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Classification search failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Manage authentication');

authCmd
  .command('test')
  .description('Test authentication with current credentials')
  .action(async () => {
    try {
      const client = getClient();
      await client.authenticate();
      success('Authentication successful');
      info(`Token expires: ${client.getTokenExpiry()?.toISOString() || 'unknown'}`);
    } catch (err) {
      error(`Authentication failed: ${err}`);
      process.exit(1);
    }
  });

authCmd
  .command('clear-token')
  .description('Clear cached OAuth token')
  .action(() => {
    clearToken();
    success('Token cleared');
  });

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
  .option('--consumer-key <key>', 'Consumer key')
  .option('--consumer-secret <secret>', 'Consumer secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      consumerKey: opts.consumerKey,
      consumerSecret: opts.consumerSecret,
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
    info(`Consumer Key: ${config.consumerKey ? `${config.consumerKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Consumer Secret: ${config.consumerSecret ? '********' : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://ops.epo.org/3.2/rest-services)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-credentials <consumerKey> <consumerSecret>')
  .description('Set consumer key and secret')
  .action((consumerKey: string, consumerSecret: string) => {
    setCredentials(consumerKey, consumerSecret);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const consumerKey = getConsumerKey();
    const consumerSecret = getConsumerSecret();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Consumer Key: ${consumerKey ? `${consumerKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Consumer Secret: ${consumerSecret ? '********' : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://ops.epo.org/3.2/rest-services)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Parse and execute
program.parse();
