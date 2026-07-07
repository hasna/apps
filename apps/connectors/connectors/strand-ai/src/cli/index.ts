#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StrandAI } from '../api';
import {
  getApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-strand-ai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Strand AI connector CLI - WSI uploads, Lattice inference, and imputation results')
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

function getClient(): StrandAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRAND_API_KEY`);
    process.exit(1);
  }
  return new StrandAI({ apiKey, baseUrl: getBaseUrl() });
}

function handleResult(cmd: Command, data: unknown): void {
  print(data, getFormat(cmd));
}

async function runAction(cmd: Command, fn: (client: StrandAI) => Promise<unknown>): Promise<void> {
  try {
    const client = getClient();
    const result = await fn(client);
    handleResult(cmd, result);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach((p) => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd
  .command('use <name>')
  .description('Switch profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
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

profileCmd
  .command('delete <name>')
  .description('Delete profile')
  .action((name: string) => {
    if (name === 'default') {
      error('Cannot delete default profile');
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
  .description('Show profile')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    console.log(chalk.bold(`Profile: ${profileName}`));
    info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 10) + '...' : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved');
  });

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 10) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || 'https://app.strandai.com/api/v1 (default)'}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Upload commands
const uploadsCmd = program.command('uploads').description('Manage WSI uploads');

uploadsCmd
  .command('list')
  .description('List uploads')
  .option('--limit <n>', 'Page size (1-200)', '100')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts: { limit: string; cursor?: string }) => {
    await runAction(uploadsCmd, (client) =>
      client.listUploads({ limit: Number(opts.limit), cursor: opts.cursor })
    );
  });

uploadsCmd
  .command('get <id>')
  .description('Get upload by ID')
  .action(async (id: string) => {
    await runAction(uploadsCmd, (client) => client.getUpload(id));
  });

uploadsCmd
  .command('initiate')
  .description('Initiate a resumable upload')
  .requiredOption('--filename <name>', 'Slide filename')
  .requiredOption('--file-size <bytes>', 'File size in bytes')
  .requiredOption('--content-type <type>', 'MIME type (e.g. image/tiff)')
  .action(async (opts: { filename: string; fileSize: string; contentType: string }) => {
    await runAction(uploadsCmd, (client) =>
      client.initiateUpload({
        filename: opts.filename,
        fileSize: Number(opts.fileSize),
        contentType: opts.contentType,
      })
    );
  });

uploadsCmd
  .command('complete <id>')
  .description('Finalize upload after bytes are PUT to uploadUrl')
  .action(async (id: string) => {
    await runAction(uploadsCmd, (client) => client.completeUpload(id));
  });

// Predict commands
const predictCmd = program.command('predict').description('Lattice prediction jobs');

predictCmd
  .command('estimate')
  .description('Estimate credit cost')
  .requiredOption('--upload-id <id>', 'Upload UUID')
  .requiredOption('--markers <json>', 'JSON array of marker names')
  .action(async (opts: { uploadId: string; markers: string }) => {
    await runAction(predictCmd, (client) =>
      client.estimatePrediction({
        uploadId: opts.uploadId,
        markers: JSON.parse(opts.markers),
      })
    );
  });

predictCmd
  .command('submit')
  .description('Submit a prediction job')
  .requiredOption('--upload-id <id>', 'Upload UUID')
  .requiredOption('--markers <json>', 'JSON array of marker names')
  .option('--model <version>', 'Lattice model version (v0.4, v0.5, v0.6)')
  .action(async (opts: { uploadId: string; markers: string; model?: string }) => {
    await runAction(predictCmd, (client) =>
      client.submitPrediction({
        uploadId: opts.uploadId,
        markers: JSON.parse(opts.markers),
        model: opts.model as 'v0.4' | 'v0.5' | 'v0.6' | undefined,
      })
    );
  });

// Job commands
const jobsCmd = program.command('jobs').description('Manage inference jobs');

jobsCmd
  .command('get <id>')
  .description('Get job status')
  .action(async (id: string) => {
    await runAction(jobsCmd, (client) => client.getJob(id));
  });

jobsCmd
  .command('cancel <id>')
  .description('Cancel an in-flight job')
  .action(async (id: string) => {
    await runAction(jobsCmd, (client) => client.cancelJob(id));
  });

jobsCmd
  .command('results <id>')
  .description('Get signed results download URL')
  .action(async (id: string) => {
    await runAction(jobsCmd, (client) => client.getJobResults(id));
  });

jobsCmd
  .command('stream-url <id>')
  .description('Print SSE stream URL (use curl or an SSE client with Bearer auth)')
  .action(async (id: string) => {
    const client = getClient();
    const url = client.getJobStreamUrl(id);
    if (getFormat(jobsCmd) === 'json') {
      print({ streamUrl: url }, 'json');
    } else {
      info(url);
      info('Open with Authorization: Bearer <STRAND_API_KEY>');
    }
  });

// Raw request
program
  .command('raw-request')
  .description('Send an authenticated raw API request')
  .requiredOption('--method <method>', 'HTTP method')
  .requiredOption('--path <path>', 'API path (e.g. /uploads)')
  .option('--body <json>', 'JSON request body')
  .action(async (opts: { method: string; path: string; body?: string }) => {
    const method = opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    await runAction(program, (client) => client.rawRequest(method, opts.path, body));
  });

program.parse();
