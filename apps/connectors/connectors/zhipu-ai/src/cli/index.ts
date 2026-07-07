#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZhipuAi } from '../api';
import {
  getApiKey, setApiKey, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-zhipu-ai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zhipu AI (GLM) connector CLI - OpenAI-compatible chat and models')
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
  return (cmd.optsWithGlobals().format || 'pretty') as OutputFormat;
}

function getClient(): ZhipuAi {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZHIPU_AI_API_KEY`);
    process.exit(1);
  }
  return new ZhipuAi({ apiKey, baseUrl: process.env.ZHIPU_AI_BASE_URL });
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

// Chat Command
program.command('chat <message>')
  .description('Send a chat message')
  .option('-m, --model <model>', 'Model (default: glm-5.2)', 'glm-5.2')
  .option('-t, --temperature <temp>', 'Temperature')
  .option('--max-tokens <n>', 'Max tokens')
  .option('-s, --system <prompt>', 'System prompt')
  .action(async (message: string, opts) => {
    try {
      const client = getClient();
      const messages: { role: 'system' | 'user'; content: string }[] = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: message });

      const result = await client.chat({
        model: opts.model,
        messages,
        temperature: opts.temperature ? parseFloat(opts.temperature) : undefined,
        max_tokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.green('\nResponse:'));
        console.log(result.choices[0]?.message?.content || '');
        if (result.usage) {
          info(`\nTokens: ${result.usage.prompt_tokens} in, ${result.usage.completion_tokens} out`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Models Command
program.command('models')
  .description('List available models')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listModels();
      if (getFormat(program) === 'json') {
        print(result.data, 'json');
      } else {
        result.data.forEach(m => {
          console.log(chalk.cyan(`\n${m.id}`));
          if (m.owned_by) console.log(`  Owner: ${m.owned_by}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Model Get Command
program.command('model <id>')
  .description('Get model details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getModel(id);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search Command
program.command('search <query>')
  .description('Search via Zhipu AI search API')
  .option('-c, --count <n>', 'Number of results to return')
  .option('--domain <domain>', 'Limit results to a domain')
  .option('--recency <recency>', 'Recency filter (oneDay, oneWeek, oneMonth, oneYear, noLimit)')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search({
        search_engine: 'search-prime',
        search_query: query,
        count: opts.count ? parseInt(opts.count) : undefined,
        search_domain_filter: opts.domain,
        search_recency_filter: opts.recency,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
