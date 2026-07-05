#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { VectorShift } from '../api';
import {
  getApiKey, setApiKey, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { DataType } from '../types';

const CONNECTOR_NAME = 'connect-vectorshift';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('VectorShift connector CLI - AI pipelines, chatbots, and workflows')
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

function getClient(): VectorShift {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VECTORSHIFT_API_KEY`);
    process.exit(1);
  }
  return new VectorShift({ apiKey });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
  success('API key saved');
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

// Pipelines
const pipelinesCmd = program.command('pipelines').description('Manage pipelines');

pipelinesCmd.command('list')
  .description('List available pipelines')
  .option('--include-shared', 'Include shared pipelines')
  .option('--verbose', 'Include full pipeline objects')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPipelines({
        includeShared: opts.includeShared,
        verbose: opts.verbose,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        if (result.objects?.length) {
          print(result.objects, 'pretty');
        } else {
          result.object_ids.forEach(id => console.log(chalk.cyan(id)));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd.command('run <pipelineId>')
  .description('Run a pipeline')
  .option('--inputs <json>', 'Pipeline inputs as JSON object', '{}')
  .action(async (pipelineId: string, opts) => {
    try {
      const client = getClient();
      const inputs = parseJsonOption(opts.inputs, '--inputs') as Record<string, DataType>;
      const result = await client.runPipeline(pipelineId, { inputs });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.green(`Run: ${result.run_id}`));
        print(result.outputs, 'pretty');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Chatbots
const chatbotsCmd = program.command('chatbots').description('Manage chatbots');

chatbotsCmd.command('list')
  .description('List chatbots')
  .option('--include-shared', 'Include shared chatbots')
  .option('--verbose', 'Include full chatbot objects')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listChatbots({
        includeShared: opts.includeShared,
        verbose: opts.verbose,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        if (result.objects?.length) {
          print(result.objects, 'pretty');
        } else {
          result.object_ids.forEach(id => console.log(chalk.cyan(id)));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatbotsCmd.command('run <chatbotId> <text>')
  .description('Run a chatbot with text input')
  .option('--conversation-id <id>', 'Conversation ID for multi-turn chat')
  .option('--stream', 'Enable streaming response')
  .action(async (chatbotId: string, text: string, opts) => {
    try {
      const client = getClient();
      const result = await client.runChatbot(chatbotId, {
        text,
        conversation_id: opts.conversationId,
        stream: opts.stream,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.green('\nResponse:'));
        console.log(result.output_message);
        if (result.follow_up_questions?.length) {
          info('\nFollow-up questions:');
          result.follow_up_questions.forEach(q => console.log(`  - ${q}`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatbotsCmd.command('create')
  .description('Create a chatbot')
  .requiredOption('--pipeline-id <id>', 'Pipeline ID to attach')
  .requiredOption('--name <name>', 'Chatbot name')
  .requiredOption('--description <description>', 'Chatbot description')
  .requiredOption('--input <field>', 'Pipeline input field name')
  .requiredOption('--output <field>', 'Pipeline output field name')
  .option('--deployed', 'Deploy chatbot immediately', true)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createChatbot({
        pipeline: { id: opts.pipelineId, version: 'latest' },
        name: opts.name,
        description: opts.description,
        input: opts.input,
        output: opts.output,
        deployed: opts.deployed,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        success(`Chatbot created: ${result.id}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
