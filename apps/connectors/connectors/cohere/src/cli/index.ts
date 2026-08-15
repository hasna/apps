#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Cohere } from '../api';
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

const CONNECTOR_NAME = 'connect-cohere';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Cohere AI connector CLI - Chat, embeddings, rerank, and classify')
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

function getClient(): Cohere {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set COHERE_API_KEY`);
    process.exit(1);
  }
  return new Cohere({ apiKey });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach(p => {
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
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

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
  } else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
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
  .option('-m, --model <model>', 'Model (default: command)')
  .option('-t, --temperature <temp>', 'Temperature')
  .option('--max-tokens <n>', 'Max tokens')
  .action(async (message: string, opts) => {
    try {
      const client = getClient();
      const result = await client.chat({
        message,
        model: opts.model,
        temperature: opts.temperature ? parseFloat(opts.temperature) : undefined,
        max_tokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.green('\nResponse:'));
        console.log(result.text);
        if (result.meta?.billed_units) {
          info(`\nTokens: ${result.meta.billed_units.input_tokens || 0} in, ${result.meta.billed_units.output_tokens || 0} out`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Embed Command
program.command('embed <texts...>')
  .description('Generate embeddings')
  .option('-m, --model <model>', 'Model (default: embed-english-v3.0)')
  .option('-t, --input-type <type>', 'Input type: search_document, search_query, classification, clustering')
  .action(async (texts: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.embed({
        texts,
        model: opts.model,
        input_type: opts.inputType,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        texts.forEach((text, i) => {
          console.log(chalk.cyan(`\n[${i + 1}] "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`));
          console.log(`Dimension: ${result.embeddings[i]?.length || 0}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Rerank Command
program.command('rerank <query>')
  .description('Rerank documents')
  .option('-d, --documents <docs...>', 'Documents to rerank')
  .option('-m, --model <model>', 'Model (default: rerank-english-v3.0)')
  .option('-n, --top-n <n>', 'Top N results')
  .action(async (query: string, opts) => {
    try {
      if (!opts.documents || opts.documents.length === 0) {
        error('No documents provided. Use -d option.');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.rerank({
        query,
        documents: opts.documents,
        model: opts.model,
        top_n: opts.topN ? parseInt(opts.topN) : undefined,
        return_documents: true,
      });
      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.cyan(`\nQuery: "${query}"\n`));
        result.results.forEach((r, i) => {
          console.log(`${chalk.yellow(`#${i + 1}`)} Score: ${chalk.green(r.relevance_score.toFixed(4))}`);
          if (r.document) {
            console.log(`   ${r.document.text.substring(0, 60)}${r.document.text.length > 60 ? '...' : ''}`);
          }
        });
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
        print(result.models, 'json');
      } else {
        result.models.forEach(m => {
          console.log(chalk.cyan(`\n${m.name}`));
          if (m.endpoints) console.log(`  Endpoints: ${m.endpoints.join(', ')}`);
          if (m.context_length) console.log(`  Context: ${m.context_length}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
