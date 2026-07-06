#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Typeform } from '../api';
import {
  getApiToken,
  setApiToken,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-typeform';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Typeform connector CLI - Forms, responses, webhooks, workspaces, themes, and images')
  .version(VERSION)
  .option('-k, --api-token <token>', 'Personal access token (overrides config)')
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

    if (opts.apiToken) {
      process.env.TYPEFORM_API_TOKEN = opts.apiToken;
      debug('API token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Typeform {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TYPEFORM_API_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Typeform({ apiToken });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function readJsonFile(path: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    error(`Could not read ${label} from ${path}`);
    process.exit(1);
  }
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

profileCmd.command('create <name>')
  .description('Create a new profile')
  .option('--api-token <token>', 'Personal access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.apiToken });
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
  info(`API Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-token <token>').description('Set personal access token').action((token: string) => {
  setApiToken(token);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiToken = getApiToken();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Forms commands
const formsCmd = program.command('forms').description('Manage Typeform forms');

formsCmd.command('list')
  .description('List forms')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Page size', '20')
  .option('--search <query>', 'Search query')
  .option('--workspace-id <id>', 'Filter by workspace ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listForms({
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
        search: opts.search,
        workspaceId: opts.workspaceId,
      });
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd.command('get <formId>').description('Get a form').action(async (formId: string) => {
  try {
    const client = getClient();
    print(await client.getForm(formId), getFormat(formsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

formsCmd.command('create')
  .description('Create a form')
  .requiredOption('-t, --title <title>', 'Form title')
  .option('--fields <json>', 'Fields JSON array')
  .option('--fields-file <path>', 'Path to fields JSON file')
  .option('--settings <json>', 'Settings JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const fields = opts.fieldsFile
        ? readJsonFile(opts.fieldsFile, 'fields') as unknown as Array<Record<string, unknown>>
        : opts.fields
          ? JSON.parse(opts.fields) as Array<Record<string, unknown>>
          : undefined;
      const settings = opts.settings ? parseJsonOption(opts.settings, 'settings') : undefined;
      const result = await client.createForm({ title: opts.title, fields, settings });
      success('Form created!');
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd.command('update <formId>')
  .description('Update a form (PUT)')
  .requiredOption('--form <json>', 'Full form JSON object')
  .option('--form-file <path>', 'Path to form JSON file')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const form = opts.formFile ? readJsonFile(opts.formFile, 'form') : parseJsonOption(opts.form, 'form');
      print(await client.updateForm(formId, form), getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd.command('patch <formId>')
  .description('Patch a form')
  .requiredOption('--form <json>', 'Partial form JSON object')
  .option('--form-file <path>', 'Path to form JSON file')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const form = opts.formFile ? readJsonFile(opts.formFile, 'form') : parseJsonOption(opts.form, 'form');
      print(await client.patchForm(formId, form), getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd.command('delete <formId>').description('Delete a form').action(async (formId: string) => {
  try {
    const client = getClient();
    await client.deleteForm(formId);
    success(`Form ${formId} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Responses commands
const responsesCmd = program.command('responses').description('Manage form responses');

responsesCmd.command('list <formId>')
  .description('List responses for a form')
  .option('--page-size <number>', 'Page size', '25')
  .option('--since <iso>', 'Responses since ISO timestamp')
  .option('--until <iso>', 'Responses until ISO timestamp')
  .option('--completed <bool>', 'Filter completed responses')
  .option('--before <token>', 'Pagination token (before)')
  .option('--after <token>', 'Pagination token (after)')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const completed = opts.completed === undefined ? undefined : opts.completed === 'true';
      const result = await client.listResponses(formId, {
        pageSize: parseInt(opts.pageSize, 10),
        since: opts.since,
        until: opts.until,
        completed,
        before: opts.before,
        after: opts.after,
      });
      print(result, getFormat(responsesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

responsesCmd.command('delete <formId>')
  .description('Delete responses by response ID')
  .requiredOption('--response-ids <csv>', 'Comma-separated response_id values')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const responseIds = opts.responseIds.split(',').map((id: string) => id.trim()).filter(Boolean);
      await client.deleteResponses(formId, responseIds);
      success(`Requested deletion for ${responseIds.length} response(s) from form ${formId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Webhooks commands
const webhooksCmd = program.command('webhooks').description('Manage form webhooks');

webhooksCmd.command('list <formId>').description('List webhooks').action(async (formId: string) => {
  try {
    const client = getClient();
    print(await client.listWebhooks(formId), getFormat(webhooksCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webhooksCmd.command('get <formId> <tag>').description('Get a webhook').action(async (formId: string, tag: string) => {
  try {
    const client = getClient();
    print(await client.getWebhook(formId, tag), getFormat(webhooksCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webhooksCmd.command('upsert <formId> <tag>')
  .description('Create or update a webhook')
  .requiredOption('-u, --url <url>', 'Webhook URL')
  .option('--enabled <bool>', 'Enable webhook', 'true')
  .option('--secret <secret>', 'Webhook secret')
  .option('--verify-ssl <bool>', 'Verify SSL', 'true')
  .action(async (formId: string, tag: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createOrUpdateWebhook({
        formId,
        tag,
        url: opts.url,
        enabled: opts.enabled === 'true',
        secret: opts.secret,
        verifySsl: opts.verifySsl === 'true',
      });
      success('Webhook saved!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd.command('delete <formId> <tag>').description('Delete a webhook').action(async (formId: string, tag: string) => {
  try {
    const client = getClient();
    await client.deleteWebhook(formId, tag);
    success(`Webhook ${tag} deleted from form ${formId}`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Workspaces commands
const workspacesCmd = program.command('workspaces').description('Manage workspaces');

workspacesCmd.command('list')
  .description('List workspaces')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Page size', '20')
  .option('--search <query>', 'Search query')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listWorkspaces({
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
        search: opts.search,
      });
      print(result, getFormat(workspacesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workspacesCmd.command('get <workspaceId>').description('Get a workspace').action(async (workspaceId: string) => {
  try {
    const client = getClient();
    print(await client.getWorkspace(workspaceId), getFormat(workspacesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

workspacesCmd.command('update <workspaceId>')
  .description('Update a workspace')
  .requiredOption('-n, --name <name>', 'Workspace name')
  .action(async (workspaceId: string, opts) => {
    try {
      const client = getClient();
      print(await client.updateWorkspace(workspaceId, opts.name), getFormat(workspacesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workspacesCmd.command('forms <workspaceId>')
  .description('List forms in a workspace')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Page size', '20')
  .option('--search <query>', 'Search query')
  .action(async (workspaceId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listWorkspaceForms(workspaceId, {
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
        search: opts.search,
      });
      print(result, getFormat(workspacesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Themes commands
const themesCmd = program.command('themes').description('Manage themes');

themesCmd.command('list')
  .description('List themes')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Page size', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.listThemes({
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
      }), getFormat(themesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

themesCmd.command('get <themeId>').description('Get a theme').action(async (themeId: string) => {
  try {
    const client = getClient();
    print(await client.getTheme(themeId), getFormat(themesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

themesCmd.command('create')
  .description('Create a theme')
  .requiredOption('--theme <json>', 'Theme JSON object')
  .option('--theme-file <path>', 'Path to theme JSON file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const theme = opts.themeFile ? readJsonFile(opts.themeFile, 'theme') : parseJsonOption(opts.theme, 'theme');
      const result = await client.createTheme(theme);
      success('Theme created!');
      print(result, getFormat(themesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

themesCmd.command('update <themeId>')
  .description('Update a theme')
  .requiredOption('--theme <json>', 'Theme JSON object')
  .option('--theme-file <path>', 'Path to theme JSON file')
  .action(async (themeId: string, opts) => {
    try {
      const client = getClient();
      const theme = opts.themeFile ? readJsonFile(opts.themeFile, 'theme') : parseJsonOption(opts.theme, 'theme');
      print(await client.updateTheme(themeId, theme), getFormat(themesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

themesCmd.command('delete <themeId>').description('Delete a theme').action(async (themeId: string) => {
  try {
    const client = getClient();
    await client.deleteTheme(themeId);
    success(`Theme ${themeId} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Images commands
const imagesCmd = program.command('images').description('Manage images');

imagesCmd.command('list')
  .description('List images')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Page size', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.listImages({
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
      }), getFormat(imagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imagesCmd.command('get <imageId>').description('Get an image').action(async (imageId: string) => {
  try {
    const client = getClient();
    print(await client.getImage(imageId), getFormat(imagesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

imagesCmd.command('create')
  .description('Create an image')
  .requiredOption('--image <json>', 'Image JSON object')
  .option('--image-file <path>', 'Path to image JSON file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const image = opts.imageFile ? readJsonFile(opts.imageFile, 'image') : parseJsonOption(opts.image, 'image');
      const result = await client.createImage(image);
      success('Image created!');
      print(result, getFormat(imagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imagesCmd.command('delete <imageId>').description('Delete an image').action(async (imageId: string) => {
  try {
    const client = getClient();
    await client.deleteImage(imageId);
    success(`Image ${imageId} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Raw request
program.command('raw-request')
  .description('Run an advanced relative Typeform API request')
  .requiredOption('--path <path>', 'API path (e.g. /forms)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters JSON object')
  .option('--body <json>', 'Request body JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: opts.query ? parseJsonOption(opts.query, 'query') as Record<string, string | number | boolean | Array<string | number | boolean> | undefined> : undefined,
        body: opts.body ? parseJsonOption(opts.body, 'body') : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
