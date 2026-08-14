#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Replicate } from '../api';
import {
  getApiKey, setApiKey, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-replicate';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Replicate connector CLI - Run ML models in the cloud')
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

function getClient(): Replicate {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set REPLICATE_API_TOKEN`);
    process.exit(1);
  }
  return new Replicate({ apiKey });
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
  .option('--api-key <key>', 'API token')
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
  info(`API Token: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiToken>').description('Set API token').action((apiToken: string) => {
  setApiKey(apiToken);
  success(`API token saved`);
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Token: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Models Commands
const modelsCmd = program.command('models').description('Manage models');

modelsCmd.command('get <owner> <name>')
  .description('Get a model')
  .action(async (owner: string, name: string) => {
    try {
      const client = getClient();
      const result = await client.getModel(owner, name);
      if (getFormat(modelsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.cyan(`\n${result.owner}/${result.name}`));
        if (result.description) console.log(`  ${result.description}`);
        console.log(`  Visibility: ${result.visibility}`);
        if (result.run_count) console.log(`  Runs: ${result.run_count.toLocaleString()}`);
        if (result.latest_version) console.log(`  Latest version: ${result.latest_version.id}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

modelsCmd.command('list')
  .description('List models')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listModels();
      if (getFormat(modelsCmd) === 'json') {
        print(result.results, 'json');
      } else {
        result.results.forEach(m => {
          console.log(chalk.cyan(`\n${m.owner}/${m.name}`));
          if (m.description) console.log(`  ${m.description.substring(0, 80)}${m.description.length > 80 ? '...' : ''}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Predictions Commands
const predictCmd = program.command('predict').description('Manage predictions');

predictCmd.command('create <version>')
  .description('Create a prediction')
  .requiredOption('-i, --input <json>', 'Input JSON')
  .option('--wait', 'Wait for prediction to complete')
  .action(async (version: string, opts) => {
    try {
      const client = getClient();
      const input = JSON.parse(opts.input);
      const prediction = await client.createPrediction({ version, input });

      if (opts.wait) {
        info(`Waiting for prediction ${prediction.id}...`);
        const result = await client.waitForPrediction(prediction.id);
        if (getFormat(predictCmd) === 'json') {
          print(result, 'json');
        } else {
          console.log(chalk.cyan(`\nPrediction ${result.id}`));
          console.log(`  Status: ${result.status}`);
          if (result.output) console.log(`  Output: ${JSON.stringify(result.output)}`);
          if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
        }
      } else {
        if (getFormat(predictCmd) === 'json') {
          print(prediction, 'json');
        } else {
          success(`Prediction created: ${prediction.id}`);
          console.log(`  Status: ${prediction.status}`);
          console.log(`  Get status: ${CONNECTOR_NAME} predict get ${prediction.id}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

predictCmd.command('get <id>')
  .description('Get a prediction')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getPrediction(id);
      if (getFormat(predictCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.cyan(`\nPrediction ${result.id}`));
        console.log(`  Status: ${result.status}`);
        console.log(`  Created: ${result.created_at}`);
        if (result.completed_at) console.log(`  Completed: ${result.completed_at}`);
        if (result.output) console.log(`  Output: ${JSON.stringify(result.output)}`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
        if (result.metrics?.predict_time) console.log(`  Predict time: ${result.metrics.predict_time.toFixed(2)}s`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

predictCmd.command('list')
  .description('List predictions')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listPredictions();
      if (getFormat(predictCmd) === 'json') {
        print(result.results, 'json');
      } else {
        result.results.forEach(p => {
          console.log(chalk.cyan(`\n${p.id}`));
          console.log(`  Status: ${p.status}`);
          console.log(`  Created: ${p.created_at}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

predictCmd.command('cancel <id>')
  .description('Cancel a prediction')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.cancelPrediction(id);
      success(`Prediction ${id} canceled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
