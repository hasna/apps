#!/usr/bin/env bun
import { readFileSync } from 'fs';
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

const CONNECTOR_NAME = 'connect-typless';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Typless connector CLI - AI-powered document data extraction and OCR')
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
      process.env.TYPLESS_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TYPLESS_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: process.env.TYPLESS_BASE_URL });
}

function readBase64File(filePath: string): string {
  return readFileSync(filePath).toString('base64');
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

    createProfile(name, { apiKey: opts.apiKey });
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
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();

  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Extraction commands
const extractionCmd = program.command('extraction').description('Document data extraction');

extractionCmd
  .command('extract')
  .description('Extract data from a document synchronously')
  .requiredOption('--file <path>', 'Path to document file')
  .requiredOption('--document-type <name>', 'Document type name')
  .option('--customer <id>', 'Customer identifier for usage reports')
  .action(async (opts) => {
    try {
      const client = getClient();
      const fileName = opts.file.split('/').pop() || opts.file;
      const result = await client.extraction.extractData({
        file: readBase64File(opts.file),
        file_name: fileName,
        document_type_name: opts.documentType,
        customer: opts.customer,
      });
      print(result, getFormat(extractionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

extractionCmd
  .command('extract-async')
  .description('Start asynchronous data extraction')
  .requiredOption('--file <path>', 'Path to document file')
  .requiredOption('--document-type <name>', 'Document type name')
  .option('--customer <id>', 'Customer identifier for usage reports')
  .option('--wait', 'Poll until extraction completes')
  .option('--interval <ms>', 'Poll interval in milliseconds', '2000')
  .option('--max-attempts <n>', 'Maximum poll attempts when --wait is set', '60')
  .action(async (opts) => {
    try {
      const client = getClient();
      const fileName = opts.file.split('/').pop() || opts.file;
      const started = await client.extraction.extractDataAsync({
        file: readBase64File(opts.file),
        file_name: fileName,
        document_type_name: opts.documentType,
        customer: opts.customer,
      });

      if (!opts.wait) {
        success('Async extraction started');
        print(started, getFormat(extractionCmd));
        return;
      }

      info(`Polling extraction ${started.extraction_id}...`);
      const result = await client.extraction.waitForExtraction(started.extraction_id, {
        intervalMs: parseInt(opts.interval, 10),
        maxAttempts: parseInt(opts.maxAttempts, 10),
      });
      print(result, getFormat(extractionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

extractionCmd
  .command('get <extractionId>')
  .description('Get extraction status and results by extraction ID')
  .action(async (extractionId: string) => {
    try {
      const client = getClient();
      const result = await client.extraction.getExtractionData(extractionId);
      print(result, getFormat(extractionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

extractionCmd
  .command('awaiting-poll')
  .description('List extraction IDs ready for result retrieval')
  .option('--customer <id>', 'Filter by customer identifier')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.extraction.awaitingPoll(opts.customer);
      print(result, getFormat(extractionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Training commands
const trainingCmd = program.command('training').description('Model training and dataset management');

trainingCmd
  .command('add-document')
  .description('Add a labeled document to the training dataset')
  .requiredOption('--file <path>', 'Path to document file')
  .requiredOption('--document-type <name>', 'Document type name')
  .option('--customer <id>', 'Customer identifier')
  .option('--learning-fields <json>', 'JSON object of learning field values')
  .option('--line-items <json>', 'JSON array of line item rows')
  .action(async (opts) => {
    try {
      const client = getClient();
      const fileName = opts.file.split('/').pop() || opts.file;
      const payload: Record<string, unknown> = {
        file: readBase64File(opts.file),
        file_name: fileName,
        document_type_name: opts.documentType,
      };

      if (opts.customer) payload.customer = opts.customer;
      if (opts.learningFields) payload.learning_fields = JSON.parse(opts.learningFields);
      if (opts.lineItems) payload.line_items = JSON.parse(opts.lineItems);

      const result = await client.training.addDocument(payload as any);
      success('Document added to training dataset');
      print(result, getFormat(trainingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('add-feedback')
  .description('Submit document feedback for continuous learning')
  .requiredOption('--object-id <id>', 'Object ID from extraction response')
  .option('--learning-fields <json>', 'JSON object of corrected field values')
  .option('--line-items <json>', 'JSON array of corrected line item rows')
  .action(async (opts) => {
    try {
      const client = getClient();
      const payload: Record<string, unknown> = { object_id: opts.objectId };
      if (opts.learningFields) payload.learning_fields = JSON.parse(opts.learningFields);
      if (opts.lineItems) payload.line_items = JSON.parse(opts.lineItems);

      const result = await client.training.addDocumentFeedback(payload as any);
      success('Feedback submitted');
      print(result, getFormat(trainingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('start')
  .description('Start training for a document type')
  .requiredOption('--document-type <name>', 'Document type name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.training.startTraining({
        document_type_name: opts.documentType,
      });
      success('Training started');
      print(result, getFormat(trainingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw passthrough
const rawCmd = program.command('raw').description('Raw API passthrough');

rawCmd
  .command('request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /extract-data)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.query ? JSON.parse(opts.query) : undefined;
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.raw.request(opts.path, {
        method: opts.method.toUpperCase(),
        body,
        params,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
