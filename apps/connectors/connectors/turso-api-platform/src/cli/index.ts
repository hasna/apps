#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TursoApiPlatform } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setProfileOverride,
  loadProfile,
  getConfigDir,
} from '../utils/config';

const program = new Command();

function getClient(): TursoApiPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(chalk.red('Error: API key not configured. Run "connect-turso-api-platform auth set-key <key>" or set TURSO_API_PLATFORM_API_KEY.'));
    process.exit(1);
  }
  return new TursoApiPlatform({ apiKey, baseUrl: getBaseUrl() });
}

program
  .name('connect-turso-api-platform')
  .description('Turso Api Platform connector - items, events, and search API')
  .version('0.0.1')
  .option('--profile <name>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

const authCmd = program.command('auth').description('Authentication and configuration');

authCmd
  .command('set-key')
  .description('Set API key')
  .argument('<key>', 'API key')
  .action((key: string) => {
    setApiKey(key);
    console.log(chalk.green(`API key saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('set-base-url')
  .description('Set custom API base URL')
  .argument('<url>', 'Base URL (e.g. https://api.tursoapiplatform.com/v1)')
  .action((url: string) => {
    setBaseUrl(url);
    console.log(chalk.green(`Base URL saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    if (!apiKey) {
      console.log(chalk.yellow('Not configured'));
      console.log(chalk.gray('Run "connect-turso-api-platform auth set-key <key>" to configure'));
      return;
    }

    console.log(chalk.bold('Configuration:'));
    console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`  Base URL: ${chalk.white(baseUrl || 'https://api.tursoapiplatform.com/v1 (default)')}`);
    console.log(`  API Key: ${chalk.green('Set')}`);

    try {
      const client = getClient();
      await client.listItems({ limit: 1 });
      console.log(chalk.green('\nConnected successfully'));
    } catch (error) {
      console.log(chalk.red('\nConnection failed'));
      console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
    }
  });

authCmd
  .command('clear')
  .description('Clear stored credentials')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Credentials cleared'));
  });

const profileCmd = program.command('profile').description('Profile management');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.gray('No profiles configured'));
      return;
    }

    console.log(chalk.bold('Profiles:'));
    for (const profile of profiles) {
      const marker = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('use')
  .description('Switch to a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      console.log(chalk.green(`Switched to profile "${name}"`));
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('create')
  .description('Create a new profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    try {
      if (createProfile(name)) {
        console.log(chalk.green(`Profile "${name}" created`));
      } else {
        console.log(chalk.yellow(`Profile "${name}" already exists`));
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('delete')
  .description('Delete a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    if (deleteProfile(name)) {
      console.log(chalk.green(`Profile "${name}" deleted`));
    } else {
      console.log(chalk.yellow(`Cannot delete profile "${name}" (missing or default)`));
    }
  });

profileCmd
  .command('show')
  .description('Show current profile')
  .action(() => {
    const config = loadProfile();
    console.log(`Current profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`Config directory: ${chalk.gray(getConfigDir())}`);
    console.log(`Base URL: ${config.baseUrl || chalk.gray('Default')}`);
    console.log(`API Key: ${config.apiKey ? chalk.green('Set') : chalk.gray('Not set')}`);
  });

const itemsCmd = program.command('items').description('Item operations');

itemsCmd
  .command('list')
  .description('List items')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const items = await client.listItems();
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      if (!Array.isArray(items) || items.length === 0) {
        console.log(chalk.gray('No items found'));
        return;
      }
      console.log(chalk.bold(`Items (${items.length}):`));
      for (const item of items) {
        console.log(`  ${chalk.white(String(item.id ?? 'unknown'))}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create an item')
  .requiredOption('-d, --data <json>', 'Item payload as JSON')
  .action(async (options) => {
    try {
      const body = JSON.parse(options.data);
      const client = getClient();
      const item = await client.createItem(body);
      console.log(chalk.green('Item created'));
      console.log(JSON.stringify(item, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

itemsCmd
  .command('get')
  .description('Get item by ID')
  .argument('<itemId>', 'Item ID')
  .option('--json', 'Output as JSON')
  .action(async (itemId: string, options) => {
    try {
      const client = getClient();
      const item = await client.getItem(itemId);
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(JSON.stringify(item, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const events = await client.listEvents();
      if (options.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }
      if (!Array.isArray(events) || events.length === 0) {
        console.log(chalk.gray('No events found'));
        return;
      }
      console.log(chalk.bold(`Events (${events.length}):`));
      for (const event of events) {
        console.log(`  ${chalk.white(String(event.id ?? event.type ?? 'event'))}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search the API')
  .requiredOption('-d, --data <json>', 'Search payload as JSON')
  .action(async (options) => {
    try {
      const body = JSON.parse(options.data);
      const client = getClient();
      const result = await client.search(body);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('-m, --method <method>', 'HTTP method')
  .requiredOption('-p, --path <path>', 'API path (e.g. /items)')
  .option('-b, --body <json>', 'Request body as JSON')
  .action(async (options) => {
    try {
      const method = options.method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        throw new Error(`Unsupported method: ${options.method}`);
      }
      const body = options.body ? JSON.parse(options.body) : undefined;
      const client = getClient();
      const result = await client.rawRequest(method, options.path, { body });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
