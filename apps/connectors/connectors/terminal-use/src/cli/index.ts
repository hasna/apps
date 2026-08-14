#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getToken,
  setToken,
  getAgentApiKey,
  setAgentApiKey,
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
  getConnectorConfig,
} from '../utils/config';
import type { CreateFilesystemParams, CreateTaskParams, DeployAgentParams, OutputFormat } from '../types';
import { success, error, info, print, printStream, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-terminal-use';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Terminal Use API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'API bearer token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) {
      process.env.TERMINAL_USE_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const config = getConnectorConfig();
  if (!config.token) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set TERMINAL_USE_TOKEN.`);
    process.exit(1);
  }
  return new Connector({
    token: config.token,
    agentApiKey: config.agentApiKey,
    baseUrl: config.baseUrl,
  });
}

function parseJsonOption(value: string | undefined, label: string): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function runAction(action: () => Promise<void>): void {
  action().catch((err) => {
    error(String(err));
    process.exit(1);
  });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
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
  .option('--token <token>', 'API token')
  .option('--use', 'Activate after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { token: opts.token });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token: ${config.token ? `${config.token.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Agent API key: ${config.agentApiKey ? `${config.agentApiKey.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <token>').description('Set API bearer token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-agent-key <key>').description('Set optional x-agent-api-key').action((key: string) => {
  setAgentApiKey(key);
  success(`Agent API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show active configuration').action(() => {
  const token = getToken();
  console.log(chalk.bold(`Active profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Agent API key: ${getAgentApiKey() ? `${getAgentApiKey()!.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || 'https://api.terminaluse.com'}`);
});

configCmd.command('clear').description('Clear active profile config').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const projectsCmd = program.command('projects').description('Project operations');

projectsCmd.command('list')
  .option('--namespace-id <id>', 'Namespace ID filter')
  .option('--limit <n>', 'Result limit', parseInt)
  .option('--page-number <n>', 'Page number', parseInt)
  .action((opts, cmd) => runAction(async () => {
    const client = getClient();
    const result = await client.projects.list({
      namespaceId: opts.namespaceId,
      limit: opts.limit,
      pageNumber: opts.pageNumber,
    });
    print(result, getFormat(cmd));
  }));

projectsCmd.command('create')
  .requiredOption('--namespace-id <id>', 'Namespace ID')
  .requiredOption('--name <name>', 'Project name')
  .option('--description <text>', 'Project description')
  .action((opts, cmd) => runAction(async () => {
    const client = getClient();
    const result = await client.projects.create({
      namespaceId: opts.namespaceId,
      name: opts.name,
      description: opts.description,
    });
    print(result, getFormat(cmd));
  }));

const agentsCmd = program.command('agents').description('Agent operations');

agentsCmd.command('list')
  .option('--namespace-id <id>', 'Namespace ID filter')
  .option('--limit <n>', 'Result limit', parseInt)
  .action((opts, cmd) => runAction(async () => {
    const client = getClient();
    print(await client.agents.list({ namespaceId: opts.namespaceId, limit: opts.limit }), getFormat(cmd));
  }));

agentsCmd.command('get')
  .requiredOption('--agent-id <id>', 'Agent ID')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().agents.get(opts.agentId), getFormat(cmd));
  }));

agentsCmd.command('get-by-name')
  .requiredOption('--namespace-slug <slug>', 'Namespace slug')
  .requiredOption('--agent-name <name>', 'Agent name')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().agents.getByName(opts.namespaceSlug, opts.agentName), getFormat(cmd));
  }));

agentsCmd.command('deploy')
  .requiredOption('--agent-name <name>', 'Agent name (namespace/agent)')
  .option('--version-id <id>', 'Version ID')
  .option('--branch <branch>', 'Branch name')
  .option('--author-name <name>', 'Git author name')
  .option('--author-email <email>', 'Git author email')
  .option('--commit-message <message>', 'Commit message')
  .option('--commit-sha <sha>', 'Commit SHA')
  .option('--body <json>', 'Full deploy JSON body')
  .action((opts, cmd) => runAction(async () => {
    const body = parseJsonOption(opts.body, '--body');
    const result = await getClient().agents.deploy((body ?? {
      agentName: opts.agentName,
      versionId: opts.versionId,
      branch: opts.branch,
      authorName: opts.authorName,
      authorEmail: opts.authorEmail,
      commitMessage: opts.commitMessage,
      commitSha: opts.commitSha,
    }) as DeployAgentParams);
    print(result, getFormat(cmd));
  }));

const tasksCmd = program.command('tasks').description('Task operations');

tasksCmd.command('list')
  .option('--agent-id <id>', 'Filter by agent ID')
  .option('--limit <n>', 'Result limit', parseInt)
  .option('--status <status>', 'Task status filter')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().tasks.list({
      agentId: opts.agentId,
      limit: opts.limit,
      status: opts.status,
    }), getFormat(cmd));
  }));

tasksCmd.command('create')
  .option('--agent-id <id>', 'Agent ID')
  .option('--agent-name <name>', 'Agent name (namespace/agent)')
  .option('--branch <branch>', 'Target branch')
  .option('--filesystem-id <id>', 'Filesystem ID')
  .option('--name <name>', 'Task name')
  .option('--body <json>', 'Full create-task JSON body')
  .action((opts, cmd) => runAction(async () => {
    const body = parseJsonOption(opts.body, '--body');
    print(await getClient().tasks.create((body ?? {
      agentId: opts.agentId,
      agentName: opts.agentName,
      branch: opts.branch,
      filesystemId: opts.filesystemId,
      name: opts.name,
    }) as CreateTaskParams), getFormat(cmd));
  }));

tasksCmd.command('get')
  .requiredOption('--task-id <id>', 'Task ID')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().tasks.get(opts.taskId), getFormat(cmd));
  }));

tasksCmd.command('cancel')
  .requiredOption('--task-id <id>', 'Task ID')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().tasks.cancel(opts.taskId), getFormat(cmd));
  }));

tasksCmd.command('send-text-event')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--text <text>', 'Text content')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().tasks.sendTextEvent(opts.taskId, {
      text: opts.text,
      idempotencyKey: opts.idempotencyKey,
    }), getFormat(cmd));
  }));

tasksCmd.command('send-data-event')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--data <json>', 'JSON data payload')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().tasks.sendDataEvent(opts.taskId, {
      data: parseJsonOption(opts.data, '--data'),
      idempotencyKey: opts.idempotencyKey,
    }), getFormat(cmd));
  }));

tasksCmd.command('stream')
  .requiredOption('--task-id <id>', 'Task ID')
  .option('--raw', 'Write raw SSE stream to stdout')
  .action((opts) => runAction(async () => {
    debug('Opening SSE stream', { taskId: opts.taskId });
    const response = await getClient().tasks.stream(opts.taskId);
    await printStream(response, Boolean(opts.raw));
  }));

const messagesCmd = program.command('messages').description('Message operations (v2)');

messagesCmd.command('list')
  .option('--task-id <id>', 'Filter by task ID')
  .option('--limit <n>', 'Result limit', parseInt)
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().messages.list({
      taskId: opts.taskId,
      limit: opts.limit,
    }), getFormat(cmd));
  }));

messagesCmd.command('get')
  .requiredOption('--message-id <id>', 'Message ID')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().messages.get(opts.messageId), getFormat(cmd));
  }));

const filesystemsCmd = program.command('filesystems').description('Filesystem operations');

filesystemsCmd.command('create')
  .option('--project-id <id>', 'Project ID')
  .option('--name <name>', 'Filesystem name')
  .option('--body <json>', 'Full create JSON body')
  .action((opts, cmd) => runAction(async () => {
    const body = parseJsonOption(opts.body, '--body');
    print(await getClient().filesystems.create((body ?? {
      projectId: opts.projectId,
      name: opts.name,
    }) as CreateFilesystemParams), getFormat(cmd));
  }));

filesystemsCmd.command('list')
  .option('--project-id <id>', 'Project ID filter')
  .option('--limit <n>', 'Result limit', parseInt)
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().filesystems.list({
      projectId: opts.projectId,
      limit: opts.limit,
    }), getFormat(cmd));
  }));

filesystemsCmd.command('get')
  .requiredOption('--filesystem-id <id>', 'Filesystem ID')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().filesystems.get(opts.filesystemId), getFormat(cmd));
  }));

filesystemsCmd.command('list-files')
  .requiredOption('--filesystem-id <id>', 'Filesystem ID')
  .option('--path <path>', 'Directory path')
  .option('--prefix <prefix>', 'Path prefix')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().filesystems.listFiles(opts.filesystemId, {
      path: opts.path,
      prefix: opts.prefix,
    }), getFormat(cmd));
  }));

filesystemsCmd.command('get-file')
  .requiredOption('--filesystem-id <id>', 'Filesystem ID')
  .requiredOption('--file-path <path>', 'File path')
  .action((opts, cmd) => runAction(async () => {
    print(await getClient().filesystems.getFile(opts.filesystemId, opts.filePath), getFormat(cmd));
  }));

filesystemsCmd.command('upload-url')
  .requiredOption('--filesystem-id <id>', 'Filesystem ID')
  .option('--path <path>', 'Target path')
  .option('--content-type <type>', 'Content type')
  .option('--body <json>', 'Full request JSON body')
  .action((opts, cmd) => runAction(async () => {
    const body = parseJsonOption(opts.body, '--body');
    print(await getClient().filesystems.getUploadUrl(opts.filesystemId, (body ?? {
      path: opts.path,
      contentType: opts.contentType,
    }) as Record<string, unknown>), getFormat(cmd));
  }));

filesystemsCmd.command('download-url')
  .requiredOption('--filesystem-id <id>', 'Filesystem ID')
  .option('--path <path>', 'Target path')
  .option('--body <json>', 'Full request JSON body')
  .action((opts, cmd) => runAction(async () => {
    const body = parseJsonOption(opts.body, '--body');
    print(await getClient().filesystems.getDownloadUrl(opts.filesystemId, (body ?? {
      path: opts.path,
    }) as Record<string, unknown>), getFormat(cmd));
  }));

filesystemsCmd.command('sync-complete')
  .requiredOption('--filesystem-id <id>', 'Filesystem ID')
  .option('--body <json>', 'Sync complete JSON body')
  .action((opts, cmd) => runAction(async () => {
    const body = parseJsonOption(opts.body, '--body') ?? {};
    print(await getClient().filesystems.syncComplete(opts.filesystemId, body as Record<string, unknown>), getFormat(cmd));
  }));

program.command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'Relative API path (must start with /)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--params <json>', 'Query params JSON object')
  .option('--body <json>', 'Request body JSON')
  .action((opts, cmd) => runAction(async () => {
    const params = parseJsonOption(opts.params, '--params') as Record<string, string | number | boolean | undefined> | undefined;
    const body = parseJsonOption(opts.body, '--body');
    const result = await getClient().rawRequest({
      path: opts.path,
      method: opts.method,
      params,
      body,
    });
    print(result, getFormat(cmd));
  }));

program.parse();
