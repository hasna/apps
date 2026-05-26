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

const CONNECTOR_NAME = 'connect-accurai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('AccurAI connector CLI - AI-powered document data extraction and processing')
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
      process.env.ACCURAI_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ACCURAI_API_KEY environment variable.`);
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
// Documents Commands
// ============================================
const documentsCmd = program
  .command('documents')
  .description('Manage documents for data extraction');

documentsCmd
  .command('list')
  .description('List documents')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.documents.list({
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('get <id>')
  .description('Get a document by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.documents.get(id);
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('upload')
  .description('Upload a document for processing')
  .requiredOption('--name <name>', 'Document name')
  .requiredOption('--file-type <type>', 'File type (pdf, csv, png, jpg)')
  .option('--model-id <id>', 'Model ID for extraction')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.documents.upload({
        name: opts.name,
        file_type: opts.fileType,
        model_id: opts.modelId,
      });
      success('Document uploaded!');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('delete <id>')
  .description('Delete a document')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.documents.delete(id);
      success(`Document ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Predictions Commands
// ============================================
const predictionsCmd = program
  .command('predictions')
  .description('Manage predictions and data extractions');

predictionsCmd
  .command('list')
  .description('List predictions')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .option('--document-id <id>', 'Filter by document ID')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
      };
      if (opts.documentId) params.document_id = opts.documentId;
      if (opts.status) params.status = opts.status;
      const result = await client.predictions.list(params as any);
      print(result, getFormat(predictionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

predictionsCmd
  .command('get <id>')
  .description('Get a prediction by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.predictions.get(id);
      print(result, getFormat(predictionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

predictionsCmd
  .command('create')
  .description('Create a new prediction for a document')
  .requiredOption('--document-id <id>', 'Document ID')
  .option('--model-id <id>', 'Model ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.predictions.create({
        document_id: opts.documentId,
        model_id: opts.modelId,
      });
      success('Prediction created!');
      print(result, getFormat(predictionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Models Commands
// ============================================
const modelsCmd = program
  .command('models')
  .description('List available extraction models');

modelsCmd
  .command('list')
  .description('List available models')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.models.list();
      print(result, getFormat(modelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

modelsCmd
  .command('get <id>')
  .description('Get a model by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.models.get(id);
      print(result, getFormat(modelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
