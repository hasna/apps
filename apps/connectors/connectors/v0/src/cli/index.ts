#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { V0 } from '../api';
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

const CONNECTOR_NAME = 'connect-v0';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('v0 Platform API connector CLI - projects, chats, deployments, and completions')
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

function getClient(): V0 {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set V0_API_KEY`);
    process.exit(1);
  }
  return new V0({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    error(`Failed to read JSON file for ${label}: ${path}`);
    process.exit(1);
  }
}

async function runAction(cmd: Command, fn: (client: V0) => Promise<unknown>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
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
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.v0.dev/v1)')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// User Commands
const userCmd = program.command('user').description('User account');

userCmd.command('get').description('Get current user').action(async function (this: Command) {
  await runAction(this, client => client.getUser());
});

userCmd.command('scopes').description('Get user scopes').action(async function (this: Command) {
  await runAction(this, client => client.getUserScopes());
});

// Project Commands
const projectsCmd = program.command('projects').description('Manage projects');

projectsCmd.command('list')
  .description('List projects')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .option('--scope-id <id>', 'Scope ID')
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.listProjects({
      limit: opts.limit,
      offset: opts.offset,
      scopeId: opts.scopeId,
    }));
  });

projectsCmd.command('create')
  .description('Create project')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('-d, --description <text>', 'Description')
  .option('--icon <icon>', 'Icon')
  .option('--instructions <text>', 'Instructions')
  .option('--vercel-project-id <id>', 'Vercel project ID')
  .option('--privacy <privacy>', 'Privacy setting')
  .option('--env <json>', 'Environment variables JSON object')
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.createProject({
      name: opts.name,
      description: opts.description,
      icon: opts.icon,
      instructions: opts.instructions,
      vercelProjectId: opts.vercelProjectId,
      privacy: opts.privacy,
      environmentVariables: parseJsonOption(opts.env, 'environment variables') as Record<string, string> | undefined,
    }));
  });

projectsCmd.command('get <projectId>').description('Get project').action(async function (this: Command, projectId: string) {
  await runAction(this, client => client.getProject(projectId));
});

projectsCmd.command('update <projectId>')
  .description('Update project')
  .option('-n, --name <name>', 'Project name')
  .option('-d, --description <text>', 'Description')
  .option('--icon <icon>', 'Icon')
  .option('--instructions <text>', 'Instructions')
  .option('--vercel-project-id <id>', 'Vercel project ID')
  .option('--privacy <privacy>', 'Privacy setting')
  .option('--env <json>', 'Environment variables JSON object')
  .action(async function (this: Command, projectId: string, opts) {
    await runAction(this, client => client.updateProject(projectId, {
      name: opts.name,
      description: opts.description,
      icon: opts.icon,
      instructions: opts.instructions,
      vercelProjectId: opts.vercelProjectId,
      privacy: opts.privacy,
      environmentVariables: parseJsonOption(opts.env, 'environment variables') as Record<string, string> | undefined,
    }));
  });

projectsCmd.command('delete <projectId>').description('Delete project').action(async function (this: Command, projectId: string) {
  await runAction(this, async client => {
    await client.deleteProject(projectId);
    return { deleted: true, projectId };
  });
});

// Chat Commands
const chatsCmd = program.command('chats').description('Manage chats');

chatsCmd.command('list')
  .description('List chats')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .option('--favorite', 'Filter favorites')
  .option('--vercel-project-id <id>', 'Vercel project ID')
  .option('--branch <branch>', 'Branch')
  .option('--project-id <id>', 'Project ID')
  .option('--scope-id <id>', 'Scope ID')
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.listChats({
      limit: opts.limit,
      offset: opts.offset,
      isFavorite: opts.favorite,
      vercelProjectId: opts.vercelProjectId,
      branch: opts.branch,
      projectId: opts.projectId,
      scopeId: opts.scopeId,
    }));
  });

chatsCmd.command('create')
  .description('Create chat with AI generation')
  .option('-m, --message <text>', 'Initial message')
  .option('--project-id <id>', 'Project ID')
  .option('--privacy <privacy>', 'Privacy setting')
  .option('-n, --name <name>', 'Chat name')
  .option('--system <text>', 'System prompt')
  .option('--metadata <json>', 'Metadata JSON')
  .option('--attachments <json>', 'Attachments JSON array')
  .option('--model-config <json>', 'Model configuration JSON')
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.createChat({
      initialMessage: opts.message,
      projectId: opts.projectId,
      privacy: opts.privacy,
      name: opts.name,
      system: opts.system,
      metadata: parseJsonOption(opts.metadata, 'metadata'),
      attachments: parseJsonOption(opts.attachments, 'attachments') as unknown[] | undefined,
      modelConfiguration: parseJsonOption(opts.modelConfig, 'model configuration'),
    }));
  });

chatsCmd.command('init')
  .description('Initialize chat from existing files or repo')
  .option('--type <type>', 'Init type (files, repo)')
  .option('--files <path>', 'JSON file with files array')
  .option('--repo <json>', 'Repo configuration JSON')
  .option('--context <text>', 'Initial context')
  .option('--project-id <id>', 'Project ID')
  .option('--privacy <privacy>', 'Privacy setting')
  .option('-n, --name <name>', 'Chat name')
  .option('--system <text>', 'System prompt')
  .option('--metadata <json>', 'Metadata JSON')
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.initChat({
      type: opts.type,
      files: opts.files ? parseJsonFile(opts.files, 'files') as Array<{ name: string; content: string }> : undefined,
      repo: parseJsonOption(opts.repo, 'repo'),
      initialContext: opts.context,
      projectId: opts.projectId,
      privacy: opts.privacy,
      name: opts.name,
      system: opts.system,
      metadata: parseJsonOption(opts.metadata, 'metadata'),
    }));
  });

chatsCmd.command('get <chatId>').description('Get chat').action(async function (this: Command, chatId: string) {
  await runAction(this, client => client.getChat(chatId));
});

chatsCmd.command('delete <chatId>').description('Delete chat').action(async function (this: Command, chatId: string) {
  await runAction(this, async client => {
    await client.deleteChat(chatId);
    return { deleted: true, chatId };
  });
});

// Chat Message Commands
const messagesCmd = program.command('messages').description('Chat messages');

messagesCmd.command('list <chatId>')
  .description('List chat messages')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async function (this: Command, chatId: string, opts) {
    await runAction(this, client => client.listChatMessages(chatId, {
      limit: opts.limit,
      cursor: opts.cursor,
    }));
  });

messagesCmd.command('get <chatId> <messageId>').description('Get chat message').action(async function (this: Command, chatId: string, messageId: string) {
  await runAction(this, client => client.getChatMessage(chatId, messageId));
});

messagesCmd.command('send <chatId>')
  .description('Send chat message')
  .requiredOption('-m, --message <text>', 'Message content')
  .option('--system <text>', 'System prompt')
  .option('--response-mode <mode>', 'Response mode')
  .option('--attachments <json>', 'Attachments JSON array')
  .option('--model-config <json>', 'Model configuration JSON')
  .action(async function (this: Command, chatId: string, opts) {
    await runAction(this, client => client.sendChatMessage(chatId, {
      message: opts.message,
      system: opts.system,
      responseMode: opts.responseMode,
      attachments: parseJsonOption(opts.attachments, 'attachments') as unknown[] | undefined,
      modelConfiguration: parseJsonOption(opts.modelConfig, 'model configuration'),
    }));
  });

// Deployment Commands
const deploymentsCmd = program.command('deployments').description('Manage deployments');

deploymentsCmd.command('list')
  .description('List deployments')
  .option('--project-id <id>', 'Project ID')
  .option('--chat-id <id>', 'Chat ID')
  .option('--version-id <id>', 'Version ID')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.listDeployments({
      projectId: opts.projectId,
      chatId: opts.chatId,
      versionId: opts.versionId,
      limit: opts.limit,
      offset: opts.offset,
    }));
  });

deploymentsCmd.command('create')
  .description('Create deployment')
  .option('--project-id <id>', 'Project ID')
  .option('--chat-id <id>', 'Chat ID')
  .option('--version-id <id>', 'Version ID')
  .option('--environment <env>', 'Environment')
  .option('-n, --name <name>', 'Deployment name')
  .action(async function (this: Command, opts) {
    await runAction(this, client => client.createDeployment({
      projectId: opts.projectId,
      chatId: opts.chatId,
      versionId: opts.versionId,
      environment: opts.environment,
      name: opts.name,
    }));
  });

deploymentsCmd.command('get <deploymentId>').description('Get deployment').action(async function (this: Command, deploymentId: string) {
  await runAction(this, client => client.getDeployment(deploymentId));
});

// Chat Completions
program.command('chat-completions')
  .description('Create chat completion')
  .requiredOption('-m, --message <text>', 'User message')
  .option('--model <model>', 'Model name')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--temperature <n>', 'Temperature', parseFloat)
  .option('--max-tokens <n>', 'Max tokens', parseInt)
  .option('--body <path>', 'Full request body JSON file')
  .action(async function (this: Command, opts) {
    await runAction(this, client => {
      if (opts.body) {
        const body = parseJsonFile(opts.body, 'request body') as Record<string, unknown>;
        return client.chatCompletions(body as Parameters<typeof client.chatCompletions>[0]);
      }
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: opts.message });
      return client.chatCompletions({
        model: opts.model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      });
    });
  });

program.command('stream-chat-completions')
  .description('Create streaming chat completion')
  .requiredOption('-m, --message <text>', 'User message')
  .option('--model <model>', 'Model name')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--body <path>', 'Full request body JSON file')
  .action(async function (this: Command, opts) {
    await runAction(this, client => {
      if (opts.body) {
        const body = parseJsonFile(opts.body, 'request body') as Record<string, unknown>;
        return client.streamChatCompletions(body as Parameters<typeof client.streamChatCompletions>[0]);
      }
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: opts.message });
      return client.streamChatCompletions({ model: opts.model, messages });
    });
  });

program.command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /user)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters JSON')
  .option('--body <json>', 'Request body JSON')
  .option('--body-file <path>', 'Request body JSON file')
  .action(async function (this: Command, opts) {
    await runAction(this, client => {
      let body: Record<string, unknown> | undefined;
      if (opts.bodyFile) {
        body = parseJsonFile(opts.bodyFile, 'request body') as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonOption(opts.body, 'request body');
      }
      return client.rawRequest({
        method: opts.method,
        path: opts.path,
        query: parseJsonOption(opts.query, 'query') as Record<string, string | number | boolean | undefined> | undefined,
        body,
      });
    });
  });

program.parse();
