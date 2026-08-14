#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { RunPod } from '../api';
import {
  getApiKey, setApiKey, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-runpod';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('RunPod connector CLI - Serverless GPU computing')
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

function getClient(): RunPod {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set RUNPOD_API_KEY`);
    process.exit(1);
  }
  return new RunPod({ apiKey });
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { apiKey: opts.apiKey });
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
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved`);
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Run Commands
const runCmd = program.command('run').description('Run serverless jobs');

runCmd.command('sync <endpoint>')
  .description('Run a job synchronously')
  .requiredOption('-i, --input <json>', 'Input JSON')
  .action(async (endpoint: string, opts) => {
    try {
      const client = getClient();
      const input = JSON.parse(opts.input);
      const result = await client.runSync(endpoint, { input });
      if (getFormat(runCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.cyan(`\nJob ${result.id}`));
        console.log(`  Status: ${result.status}`);
        if (result.executionTime) console.log(`  Execution time: ${result.executionTime}ms`);
        if (result.output) console.log(`  Output: ${JSON.stringify(result.output)}`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runCmd.command('async <endpoint>')
  .description('Run a job asynchronously')
  .requiredOption('-i, --input <json>', 'Input JSON')
  .option('--wait', 'Wait for job to complete')
  .action(async (endpoint: string, opts) => {
    try {
      const client = getClient();
      const input = JSON.parse(opts.input);
      const result = await client.run(endpoint, { input });

      if (opts.wait) {
        info(`Waiting for job ${result.id}...`);
        const job = await client.waitForJob(endpoint, result.id);
        if (getFormat(runCmd) === 'json') {
          print(job, 'json');
        } else {
          console.log(chalk.cyan(`\nJob ${job.id}`));
          console.log(`  Status: ${job.status}`);
          if (job.executionTime) console.log(`  Execution time: ${job.executionTime}ms`);
          if (job.output) console.log(`  Output: ${JSON.stringify(job.output)}`);
          if (job.error) console.log(chalk.red(`  Error: ${job.error}`));
        }
      } else {
        if (getFormat(runCmd) === 'json') {
          print(result, 'json');
        } else {
          success(`Job submitted: ${result.id}`);
          console.log(`  Status: ${result.status}`);
          console.log(`  Get status: ${CONNECTOR_NAME} job status ${endpoint} ${result.id}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Job Commands
const jobCmd = program.command('job').description('Manage jobs');

jobCmd.command('status <endpoint> <jobId>')
  .description('Get job status')
  .action(async (endpoint: string, jobId: string) => {
    try {
      const client = getClient();
      const result = await client.getJob(endpoint, jobId);
      if (getFormat(jobCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.cyan(`\nJob ${result.id}`));
        console.log(`  Status: ${result.status}`);
        if (result.delayTime) console.log(`  Delay time: ${result.delayTime}ms`);
        if (result.executionTime) console.log(`  Execution time: ${result.executionTime}ms`);
        if (result.output) console.log(`  Output: ${JSON.stringify(result.output)}`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd.command('cancel <endpoint> <jobId>')
  .description('Cancel a job')
  .action(async (endpoint: string, jobId: string) => {
    try {
      const client = getClient();
      await client.cancelJob(endpoint, jobId);
      success(`Job ${jobId} cancelled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Endpoint Commands
const endpointCmd = program.command('endpoint').description('Manage endpoints');

endpointCmd.command('health <endpoint>')
  .description('Get endpoint health')
  .action(async (endpoint: string) => {
    try {
      const client = getClient();
      const result = await client.health(endpoint);
      if (getFormat(endpointCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.cyan('\nJobs:'));
        console.log(`  In Queue: ${result.jobs.inQueue}`);
        console.log(`  In Progress: ${result.jobs.inProgress}`);
        console.log(`  Completed: ${result.jobs.completed}`);
        console.log(`  Failed: ${result.jobs.failed}`);
        console.log(chalk.cyan('\nWorkers:'));
        console.log(`  Ready: ${result.workers.ready}`);
        console.log(`  Running: ${result.workers.running}`);
        console.log(`  Idle: ${result.workers.idle}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

endpointCmd.command('purge <endpoint>')
  .description('Purge endpoint queue')
  .action(async (endpoint: string) => {
    try {
      const client = getClient();
      const result = await client.purgeQueue(endpoint);
      success(`Purged ${result.removed} jobs from queue`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
