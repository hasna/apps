#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { Notion } from '../api';
import {
  getClientId,
  getClientSecret,
  setCredentials,
  setApiKey,
  getApiKey,
  clearConfig,
  isAuthenticated,
  loadTokens,
  saveTokens,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  getWorkspaceName,
  getWorkspaceId,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
} from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';
import type { RichText } from '../types';

const program = new Command();

program
  .name('connect-notion')
  .description('Notion API connector CLI - Manage Notion pages, databases, and blocks')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    // Set profile override before any command runs
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-notion profiles create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to check authentication
function requireAuth(): Notion {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-notion auth login" or "connect-notion config set-key <api-key>" first.');
    process.exit(1);
  }
  return Notion.create();
}

// Helper to extract title from rich text
function extractTitle(richText: RichText[]): string {
  return richText.map(rt => rt.plain_text).join('');
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

authCmd
  .command('login')
  .description('Login to Notion via OAuth2 (opens browser)')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error('OAuth credentials not configured.');
      info('Run "connect-notion config set-credentials <client-id> <client-secret>" first.');
      info('Or set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables.');
      info('');
      info('Alternatively, use an internal integration token:');
      info('  connect-notion config set-key <your-integration-token>');
      process.exit(1);
    }

    info('Starting OAuth2 authentication flow...');
    info('A browser window will open for you to authorize the application.');

    // Start callback server first
    const serverPromise = startCallbackServer();

    // Open browser to auth URL
    const authUrl = getAuthUrl();
    await open(authUrl);

    info('Waiting for authentication...');

    const result = await serverPromise;

    if (result.success && result.tokens) {
      success('Successfully authenticated!');
      info(`Workspace: ${result.tokens.workspaceName || 'Unknown'}`);
      info(`Workspace ID: ${result.tokens.workspaceId || 'Unknown'}`);

      // Create profile from workspace name if available
      if (result.tokens.workspaceName) {
        const profileSlug = result.tokens.workspaceName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (profileSlug && !profileExists(profileSlug)) {
          try {
            createProfile(profileSlug);
            setCurrentProfile(profileSlug);
            setProfileOverride(profileSlug);
            saveTokens(result.tokens);
            info(`Created and switched to profile: ${profileSlug}`);
          } catch {
            // Profile creation failed, continue with default
          }
        }
      }
    } else {
      error(`Authentication failed: ${result.error}`);
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    if (isAuthenticated()) {
      const tokens = loadTokens();
      const apiKey = getApiKey();

      success('Authenticated');

      if (tokens?.accessToken) {
        info('Auth method: OAuth2');
        if (tokens.workspaceName) {
          info(`Workspace: ${tokens.workspaceName}`);
        }
        if (tokens.workspaceId) {
          info(`Workspace ID: ${tokens.workspaceId}`);
        }
        if (tokens.botId) {
          info(`Bot ID: ${tokens.botId}`);
        }
      } else if (apiKey) {
        info('Auth method: Internal Integration Token');
        info(`Token: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
      }
    } else {
      warn('Not authenticated');
      info('Run "connect-notion auth login" or "connect-notion config set-key <api-key>" to authenticate.');
    }
  });

authCmd
  .command('logout')
  .description('Clear stored authentication tokens')
  .action(() => {
    clearConfig();
    success('Logged out successfully');
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-credentials <clientId> <clientSecret>')
  .description('Set OAuth2 client credentials')
  .action((clientId: string, clientSecret: string) => {
    setCredentials(clientId, clientSecret);
    success('OAuth credentials saved successfully');
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('set-key <apiKey>')
  .description('Set Notion internal integration token (API key)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved successfully');
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const tokens = loadTokens();
    const apiKey = getApiKey();

    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 20)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${clientSecret ? '********' : chalk.gray('not set')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 10)}...` : chalk.gray('not set')}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
    if (tokens?.workspaceName) {
      info(`Workspace: ${tokens.workspaceName}`);
    }
    if (tokens?.workspaceId) {
      info(`Workspace ID: ${tokens.workspaceId}`);
    }
  });

configCmd
  .command('clear')
  .description('Clear all configuration and tokens')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Me Command (current user info)
// ============================================
program
  .command('me')
  .description('Get information about the authenticated bot/user')
  .action(async () => {
    try {
      const notion = requireAuth();
      const user = await notion.users.me();
      print(user, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Profiles Management Commands
// ============================================
const profilesCmd = program
  .command('profiles')
  .description('Manage multiple Notion profiles');

profilesCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    try {
      const profiles = listProfiles();
      const current = getCurrentProfile();

      if (profiles.length === 0) {
        info('No profiles found');
        return;
      }

      success(`${profiles.length} profile(s):`);
      for (const p of profiles) {
        if (p === current) {
          info(`  ${chalk.green('>')} ${p} ${chalk.gray('(current)')}`);
        } else {
          info(`    ${p}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('current')
  .description('Show current profile')
  .action(() => {
    const current = getCurrentProfile();
    info(`Current profile: ${chalk.green(current)}`);
    info(`Config directory: ${getConfigDir()}`);
  });

profilesCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
      info(`Switch to it with: connect-notion profiles switch ${name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('switch <name>')
  .alias('use')
  .description('Switch to a different profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
      info(`Config directory: ${getConfigDir()}`);

      if (isAuthenticated()) {
        const workspace = getWorkspaceName();
        if (workspace) {
          info(`Workspace: ${workspace}`);
        }
      } else {
        warn('Profile not authenticated. Run "connect-notion auth login" or "connect-notion config set-key"');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Databases Commands
// ============================================
const databasesCmd = program
  .command('databases')
  .description('Database management commands');

databasesCmd
  .command('list')
  .description('List all databases')
  .option('-n, --max <number>', 'Maximum databases to return', '100')
  .action(async (opts) => {
    try {
      const notion = requireAuth();
      const result = await notion.databases.list(undefined, parseInt(opts.max));

      if (!result.results || result.results.length === 0) {
        info('No databases found');
        return;
      }

      success(`Found ${result.results.length} databases:`);

      const databases = result.results.map(db => ({
        id: db.id,
        title: extractTitle(db.title),
        url: db.url,
        archived: db.archived,
        lastEdited: db.last_edited_time,
      }));

      print(databases, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databasesCmd
  .command('get <databaseId>')
  .description('Get a database by ID')
  .action(async (databaseId: string) => {
    try {
      const notion = requireAuth();
      const database = await notion.databases.get(databaseId);
      print(database, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databasesCmd
  .command('query <databaseId>')
  .description('Query a database')
  .option('-n, --max <number>', 'Maximum results to return', '100')
  .option('--filter <json>', 'Filter as JSON string')
  .action(async (databaseId: string, opts) => {
    try {
      const notion = requireAuth();
      const options: Record<string, unknown> = {
        page_size: parseInt(opts.max),
      };

      if (opts.filter) {
        options.filter = JSON.parse(opts.filter);
      }

      const result = await notion.databases.query(databaseId, options);

      if (!result.results || result.results.length === 0) {
        info('No pages found in database');
        return;
      }

      success(`Found ${result.results.length} pages:`);

      const pages = result.results.map(page => ({
        id: page.id,
        url: page.url,
        archived: page.archived,
        lastEdited: page.last_edited_time,
      }));

      print(pages, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databasesCmd
  .command('create <parentPageId> <title>')
  .description('Create a new database')
  .action(async (parentPageId: string, title: string) => {
    try {
      const notion = requireAuth();
      const database = await notion.databases.createSimple(parentPageId, title, {});
      success(`Database "${title}" created!`);
      info(`ID: ${database.id}`);
      info(`URL: ${database.url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Database Property Commands
// ============================================
const propsCmd = databasesCmd
  .command('props')
  .alias('properties')
  .description('Manage database properties (columns)');

propsCmd
  .command('list <databaseId>')
  .description('List all properties in a database')
  .action(async (databaseId: string) => {
    try {
      const notion = requireAuth();
      const properties = await notion.databases.getProperties(databaseId);

      success(`Properties in database:\n`);

      const propList = Object.entries(properties).map(([name, config]) => {
        let extra = '';
        const propType = config.type;

        // Show options for select/status/multi_select
        if (propType === 'select' && (config as any).select?.options) {
          const options = (config as any).select.options.map((o: any) => o.name);
          if (options.length > 0) {
            extra = ` [${options.join(', ')}]`;
          }
        } else if (propType === 'multi_select' && (config as any).multi_select?.options) {
          const options = (config as any).multi_select.options.map((o: any) => o.name);
          if (options.length > 0) {
            extra = ` [${options.join(', ')}]`;
          }
        } else if (propType === 'status' && (config as any).status?.options) {
          const options = (config as any).status.options.map((o: any) => o.name);
          if (options.length > 0) {
            extra = ` [${options.join(', ')}]`;
          }
        } else if (propType === 'formula' && (config as any).formula?.expression) {
          extra = ` = ${(config as any).formula.expression}`;
        } else if (propType === 'relation' && (config as any).relation?.database_id) {
          extra = ` → ${(config as any).relation.database_id.substring(0, 8)}...`;
        } else if (propType === 'rollup') {
          const rollup = (config as any).rollup;
          if (rollup) {
            extra = ` (${rollup.function})`;
          }
        } else if (propType === 'number' && (config as any).number?.format) {
          extra = ` (${(config as any).number.format})`;
        }

        return {
          name,
          type: propType,
          id: config.id,
          details: extra.trim(),
        };
      });

      print(propList, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('add <databaseId> <propertyName> <type>')
  .description('Add a new property (column) to a database')
  .option('-o, --options <options>', 'Comma-separated options for select/multi_select/status')
  .option('--format <format>', 'Number format (number, percent, dollar, euro, etc.)')
  .option('--formula <expression>', 'Formula expression')
  .option('--relation <databaseId>', 'Related database ID for relation property')
  .option('--rollup-relation <property>', 'Relation property name for rollup')
  .option('--rollup-property <property>', 'Property to rollup from related database')
  .option('--rollup-function <function>', 'Rollup function (count, sum, average, etc.)')
  .action(async (databaseId: string, propertyName: string, type: string, opts) => {
    try {
      const notion = requireAuth();
      const { DatabasesApi } = await import('../api/databases');

      // Build property config based on type
      let propertyConfig: Record<string, unknown>;

      switch (type) {
        case 'title':
          propertyConfig = { title: {} };
          break;
        case 'rich_text':
        case 'text':
          propertyConfig = { rich_text: {} };
          break;
        case 'number':
          propertyConfig = { number: { format: opts.format || 'number' } };
          break;
        case 'select':
          propertyConfig = { select: {} };
          if (opts.options) {
            const options = opts.options.split(',').map((o: string) => ({ name: o.trim() }));
            propertyConfig.select = { options };
          }
          break;
        case 'multi_select':
          propertyConfig = { multi_select: {} };
          if (opts.options) {
            const options = opts.options.split(',').map((o: string) => ({ name: o.trim() }));
            propertyConfig.multi_select = { options };
          }
          break;
        case 'status':
          propertyConfig = { status: {} };
          if (opts.options) {
            const options = opts.options.split(',').map((o: string) => ({ name: o.trim() }));
            propertyConfig.status = { options };
          }
          break;
        case 'date':
          propertyConfig = { date: {} };
          break;
        case 'people':
          propertyConfig = { people: {} };
          break;
        case 'files':
          propertyConfig = { files: {} };
          break;
        case 'checkbox':
          propertyConfig = { checkbox: {} };
          break;
        case 'url':
          propertyConfig = { url: {} };
          break;
        case 'email':
          propertyConfig = { email: {} };
          break;
        case 'phone_number':
        case 'phone':
          propertyConfig = { phone_number: {} };
          break;
        case 'formula':
          if (!opts.formula) {
            error('Formula expression required. Use --formula <expression>');
            process.exit(1);
          }
          propertyConfig = { formula: { expression: opts.formula } };
          break;
        case 'relation':
          if (!opts.relation) {
            error('Related database ID required. Use --relation <databaseId>');
            process.exit(1);
          }
          propertyConfig = {
            relation: {
              database_id: opts.relation,
              type: 'single_property',
              single_property: {},
            },
          };
          break;
        case 'rollup':
          if (!opts.rollupRelation || !opts.rollupProperty || !opts.rollupFunction) {
            error('Rollup requires --rollup-relation, --rollup-property, and --rollup-function');
            process.exit(1);
          }
          propertyConfig = {
            rollup: {
              relation_property_name: opts.rollupRelation,
              rollup_property_name: opts.rollupProperty,
              function: opts.rollupFunction,
            },
          };
          break;
        case 'created_time':
          propertyConfig = { created_time: {} };
          break;
        case 'created_by':
          propertyConfig = { created_by: {} };
          break;
        case 'last_edited_time':
          propertyConfig = { last_edited_time: {} };
          break;
        case 'last_edited_by':
          propertyConfig = { last_edited_by: {} };
          break;
        default:
          error(`Unknown property type: ${type}`);
          info('Valid types: title, rich_text, number, select, multi_select, status, date, people, files, checkbox, url, email, phone_number, formula, relation, rollup, created_time, created_by, last_edited_time, last_edited_by');
          process.exit(1);
      }

      await notion.databases.addProperty(databaseId, propertyName, propertyConfig);
      success(`Property "${propertyName}" (${type}) added to database`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('rename <databaseId> <oldName> <newName>')
  .description('Rename a property (column) in a database')
  .action(async (databaseId: string, oldName: string, newName: string) => {
    try {
      const notion = requireAuth();
      await notion.databases.renameProperty(databaseId, oldName, newName);
      success(`Property renamed from "${oldName}" to "${newName}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('delete <databaseId> <propertyName>')
  .description('Delete a property (column) from a database')
  .action(async (databaseId: string, propertyName: string) => {
    try {
      const notion = requireAuth();
      await notion.databases.deleteProperty(databaseId, propertyName);
      success(`Property "${propertyName}" deleted from database`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('add-option <databaseId> <propertyName> <optionName>')
  .description('Add an option to a select/multi_select property')
  .option('-c, --color <color>', 'Option color (default, gray, brown, orange, yellow, green, blue, purple, pink, red)')
  .action(async (databaseId: string, propertyName: string, optionName: string, opts) => {
    try {
      const notion = requireAuth();
      await notion.databases.addSelectOption(databaseId, propertyName, optionName, opts.color);
      success(`Option "${optionName}" added to property "${propertyName}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('add-formula <databaseId> <propertyName> <expression>')
  .description('Add a formula property to a database')
  .action(async (databaseId: string, propertyName: string, expression: string) => {
    try {
      const notion = requireAuth();
      await notion.databases.addFormulaProperty(databaseId, propertyName, expression);
      success(`Formula property "${propertyName}" added`);
      info(`Expression: ${expression}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('add-relation <databaseId> <propertyName> <relatedDatabaseId>')
  .description('Add a relation property linking to another database')
  .option('--single', 'Create a single-property relation (no synced property in related database)')
  .option('--synced-name <name>', 'Name of the synced property in the related database')
  .action(async (databaseId: string, propertyName: string, relatedDatabaseId: string, opts) => {
    try {
      const notion = requireAuth();
      await notion.databases.addRelationProperty(databaseId, propertyName, relatedDatabaseId, {
        singleProperty: opts.single,
        syncedPropertyName: opts.syncedName,
      });
      success(`Relation property "${propertyName}" added`);
      info(`Related database: ${relatedDatabaseId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propsCmd
  .command('add-rollup <databaseId> <propertyName>')
  .description('Add a rollup property based on a relation')
  .requiredOption('--relation <property>', 'Name of the relation property')
  .requiredOption('--property <property>', 'Name of the property to rollup from related database')
  .requiredOption('--function <function>', 'Rollup function (count, sum, average, min, max, etc.)')
  .action(async (databaseId: string, propertyName: string, opts) => {
    try {
      const notion = requireAuth();
      await notion.databases.addRollupProperty(
        databaseId,
        propertyName,
        opts.relation,
        opts.property,
        opts.function
      );
      success(`Rollup property "${propertyName}" added`);
      info(`Relation: ${opts.relation} → ${opts.property} (${opts.function})`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pages Commands
// ============================================
const pagesCmd = program
  .command('pages')
  .description('Page management commands');

pagesCmd
  .command('list')
  .description('List all pages')
  .option('-n, --max <number>', 'Maximum pages to return', '100')
  .action(async (opts) => {
    try {
      const notion = requireAuth();
      const result = await notion.pages.list(undefined, parseInt(opts.max));

      if (!result.results || result.results.length === 0) {
        info('No pages found');
        return;
      }

      success(`Found ${result.results.length} pages:`);

      const pages = result.results.map(page => ({
        id: page.id,
        url: page.url,
        archived: page.archived,
        lastEdited: page.last_edited_time,
      }));

      print(pages, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('get <pageId>')
  .description('Get a page by ID')
  .action(async (pageId: string) => {
    try {
      const notion = requireAuth();
      const page = await notion.pages.get(pageId);
      print(page, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('create <parentPageId> <title>')
  .description('Create a new page')
  .option('-c, --content <content>', 'Page content (plain text)')
  .action(async (parentPageId: string, title: string, opts) => {
    try {
      const notion = requireAuth();
      const page = await notion.pages.createSimple(parentPageId, title, opts.content);
      success(`Page "${title}" created!`);
      info(`ID: ${page.id}`);
      info(`URL: ${page.url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('update <pageId>')
  .description('Update a page')
  .option('--title <title>', 'New title')
  .option('--icon <emoji>', 'Icon emoji')
  .option('--cover <url>', 'Cover image URL')
  .option('--archive', 'Archive the page')
  .option('--unarchive', 'Unarchive the page')
  .action(async (pageId: string, opts) => {
    try {
      const notion = requireAuth();

      if (opts.title) {
        await notion.pages.updateTitle(pageId, opts.title);
        success(`Title updated to "${opts.title}"`);
      }

      if (opts.icon) {
        await notion.pages.setIcon(pageId, opts.icon);
        success(`Icon set to ${opts.icon}`);
      }

      if (opts.cover) {
        await notion.pages.setCover(pageId, opts.cover);
        success('Cover image updated');
      }

      if (opts.archive) {
        await notion.pages.archive(pageId);
        success('Page archived');
      }

      if (opts.unarchive) {
        await notion.pages.unarchive(pageId);
        success('Page unarchived');
      }

      if (!opts.title && !opts.icon && !opts.cover && !opts.archive && !opts.unarchive) {
        info('No updates specified. Use --title, --icon, --cover, --archive, or --unarchive');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('set-property <pageId> <propertyName> <value>')
  .description('Set a property value on a page (auto-detects type from database schema)')
  .option('-t, --type <type>', 'Property type (select, multi_select, status, checkbox, number, url, email, phone, text, date)')
  .action(async (pageId: string, propertyName: string, value: string, opts) => {
    try {
      const notion = requireAuth();

      // If type is specified, use it directly
      if (opts.type) {
        let result;
        switch (opts.type) {
          case 'select':
            result = await notion.pages.setSelect(pageId, propertyName, value);
            break;
          case 'multi_select':
            result = await notion.pages.setMultiSelect(pageId, propertyName, value.split(',').map(v => v.trim()));
            break;
          case 'status':
            result = await notion.pages.setStatus(pageId, propertyName, value);
            break;
          case 'checkbox':
            result = await notion.pages.setCheckbox(pageId, propertyName, value.toLowerCase() === 'true');
            break;
          case 'number':
            result = await notion.pages.setNumber(pageId, propertyName, parseFloat(value));
            break;
          case 'url':
            result = await notion.pages.setUrl(pageId, propertyName, value);
            break;
          case 'email':
            result = await notion.pages.setEmail(pageId, propertyName, value);
            break;
          case 'phone':
            result = await notion.pages.setPhone(pageId, propertyName, value);
            break;
          case 'text':
            result = await notion.pages.setRichText(pageId, propertyName, value);
            break;
          case 'date':
            result = await notion.pages.setDate(pageId, propertyName, value);
            break;
          default:
            error(`Unknown property type: ${opts.type}`);
            info('Valid types: select, multi_select, status, checkbox, number, url, email, phone, text, date');
            process.exit(1);
        }
        success(`Property "${propertyName}" set to "${value}"`);
        return;
      }

      // Auto-detect type from page's current property
      const page = await notion.pages.get(pageId);
      const property = page.properties[propertyName];

      if (!property) {
        error(`Property "${propertyName}" not found on page`);
        info('Available properties: ' + Object.keys(page.properties).join(', '));
        process.exit(1);
      }

      let result;
      switch (property.type) {
        case 'select':
          result = await notion.pages.setSelect(pageId, propertyName, value);
          break;
        case 'multi_select':
          result = await notion.pages.setMultiSelect(pageId, propertyName, value.split(',').map(v => v.trim()));
          break;
        case 'status':
          result = await notion.pages.setStatus(pageId, propertyName, value);
          break;
        case 'checkbox':
          result = await notion.pages.setCheckbox(pageId, propertyName, value.toLowerCase() === 'true');
          break;
        case 'number':
          result = await notion.pages.setNumber(pageId, propertyName, parseFloat(value));
          break;
        case 'url':
          result = await notion.pages.setUrl(pageId, propertyName, value);
          break;
        case 'email':
          result = await notion.pages.setEmail(pageId, propertyName, value);
          break;
        case 'phone_number':
          result = await notion.pages.setPhone(pageId, propertyName, value);
          break;
        case 'rich_text':
          result = await notion.pages.setRichText(pageId, propertyName, value);
          break;
        case 'date':
          result = await notion.pages.setDate(pageId, propertyName, value);
          break;
        default:
          error(`Property type "${property.type}" is not supported for direct updates`);
          info('Supported types: select, multi_select, status, checkbox, number, url, email, phone_number, rich_text, date');
          process.exit(1);
      }

      success(`Property "${propertyName}" set to "${value}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('delete <pageId>')
  .description('Delete (archive) a page')
  .action(async (pageId: string) => {
    try {
      const notion = requireAuth();
      await notion.pages.delete(pageId);
      success(`Page ${pageId} deleted (archived)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Blocks Commands
// ============================================
const blocksCmd = program
  .command('blocks')
  .description('Block management commands');

blocksCmd
  .command('list <blockId>')
  .description('List children of a block or page')
  .option('-n, --max <number>', 'Maximum blocks to return', '100')
  .action(async (blockId: string, opts) => {
    try {
      const notion = requireAuth();
      const result = await notion.blocks.list(blockId, undefined, parseInt(opts.max));

      if (!result.results || result.results.length === 0) {
        info('No blocks found');
        return;
      }

      success(`Found ${result.results.length} blocks:`);

      const blocks = result.results.map(block => ({
        id: block.id,
        type: block.type,
        hasChildren: block.has_children,
        archived: block.archived,
      }));

      print(blocks, getFormat(blocksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blocksCmd
  .command('get <blockId>')
  .description('Get a block by ID')
  .action(async (blockId: string) => {
    try {
      const notion = requireAuth();
      const block = await notion.blocks.get(blockId);
      print(block, getFormat(blocksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blocksCmd
  .command('children <blockId>')
  .description('Get all children of a block (handles pagination)')
  .action(async (blockId: string) => {
    try {
      const notion = requireAuth();
      const blocks = await notion.blocks.getAllChildren(blockId);

      if (blocks.length === 0) {
        info('No blocks found');
        return;
      }

      success(`Found ${blocks.length} blocks:`);
      print(blocks, getFormat(blocksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blocksCmd
  .command('create <parentBlockId> <type> <content>')
  .description('Create a block (types: paragraph, heading_1, heading_2, heading_3, bulleted_list_item, numbered_list_item, to_do, quote, code, callout, divider, bookmark)')
  .option('--language <lang>', 'Language for code blocks', 'plain text')
  .option('--checked', 'Checked state for to-do blocks')
  .action(async (parentBlockId: string, type: string, content: string, opts) => {
    try {
      const notion = requireAuth();
      let block;

      switch (type) {
        case 'paragraph':
          block = await notion.blocks.appendParagraph(parentBlockId, content);
          break;
        case 'heading_1':
          block = await notion.blocks.appendHeading(parentBlockId, 1, content);
          break;
        case 'heading_2':
          block = await notion.blocks.appendHeading(parentBlockId, 2, content);
          break;
        case 'heading_3':
          block = await notion.blocks.appendHeading(parentBlockId, 3, content);
          break;
        case 'bulleted_list_item':
          block = await notion.blocks.appendBulletedListItem(parentBlockId, content);
          break;
        case 'numbered_list_item':
          block = await notion.blocks.appendNumberedListItem(parentBlockId, content);
          break;
        case 'to_do':
          block = await notion.blocks.appendToDo(parentBlockId, content, opts.checked || false);
          break;
        case 'quote':
          block = await notion.blocks.appendQuote(parentBlockId, content);
          break;
        case 'code':
          block = await notion.blocks.appendCode(parentBlockId, content, opts.language);
          break;
        case 'callout':
          block = await notion.blocks.appendCallout(parentBlockId, content);
          break;
        case 'divider':
          block = await notion.blocks.appendDivider(parentBlockId);
          break;
        case 'bookmark':
          block = await notion.blocks.appendBookmark(parentBlockId, content);
          break;
        default:
          error(`Unknown block type: ${type}`);
          process.exit(1);
      }

      success(`Block created!`);
      info(`ID: ${block.id}`);
      info(`Type: ${block.type}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blocksCmd
  .command('update <blockId> <content>')
  .description('Update a paragraph block content')
  .action(async (blockId: string, content: string) => {
    try {
      const notion = requireAuth();
      await notion.blocks.updateParagraph(blockId, content);
      success(`Block ${blockId} updated`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blocksCmd
  .command('delete <blockId>')
  .description('Delete a block')
  .action(async (blockId: string) => {
    try {
      const notion = requireAuth();
      await notion.blocks.delete(blockId);
      success(`Block ${blockId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .description('User management commands');

usersCmd
  .command('list')
  .description('List all users')
  .option('-n, --max <number>', 'Maximum users to return', '100')
  .action(async (opts) => {
    try {
      const notion = requireAuth();
      const result = await notion.users.list(undefined, parseInt(opts.max));

      if (!result.results || result.results.length === 0) {
        info('No users found');
        return;
      }

      success(`Found ${result.results.length} users:`);

      const users = result.results.map(user => ({
        id: user.id,
        name: user.name,
        type: user.type,
        email: user.person?.email || '-',
      }));

      print(users, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <userId>')
  .description('Get a user by ID')
  .action(async (userId: string) => {
    try {
      const notion = requireAuth();
      const user = await notion.users.get(userId);
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('me')
  .description('Get the authenticated bot user')
  .action(async () => {
    try {
      const notion = requireAuth();
      const user = await notion.users.me();
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Command
// ============================================
program
  .command('search <query>')
  .description('Search pages and databases')
  .option('-n, --max <number>', 'Maximum results to return', '100')
  .option('--pages', 'Search only pages')
  .option('--databases', 'Search only databases')
  .action(async (query: string, opts) => {
    try {
      const notion = requireAuth();
      let result;

      if (opts.pages) {
        result = await notion.search.pages(query, undefined, parseInt(opts.max));
      } else if (opts.databases) {
        result = await notion.search.databases(query, undefined, parseInt(opts.max));
      } else {
        result = await notion.search.query(query, undefined, parseInt(opts.max));
      }

      if (!result.results || result.results.length === 0) {
        info(`No results found for "${query}"`);
        return;
      }

      success(`Found ${result.results.length} results:`);

      const results = result.results.map(item => {
        const isPage = item.object === 'page';
        return {
          id: item.id,
          type: item.object,
          url: item.url,
          title: isPage ? '-' : extractTitle((item as any).title || []),
          lastEdited: item.last_edited_time,
        };
      });

      print(results, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comments Commands
// ============================================
const commentsCmd = program
  .command('comments')
  .description('Comment management commands');

commentsCmd
  .command('list <blockId>')
  .description('List comments on a block or page')
  .option('-n, --max <number>', 'Maximum comments to return', '100')
  .action(async (blockId: string, opts) => {
    try {
      const notion = requireAuth();
      const result = await notion.comments.list(blockId, undefined, parseInt(opts.max));

      if (!result.results || result.results.length === 0) {
        info('No comments found');
        return;
      }

      success(`Found ${result.results.length} comments:`);

      const comments = result.results.map(comment => ({
        id: comment.id,
        discussionId: comment.discussion_id,
        text: notion.comments.getPlainText(comment),
        createdTime: comment.created_time,
        createdBy: comment.created_by.name || comment.created_by.id,
      }));

      print(comments, getFormat(commentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentsCmd
  .command('create <pageId> <text>')
  .description('Create a comment on a page')
  .action(async (pageId: string, text: string) => {
    try {
      const notion = requireAuth();
      const comment = await notion.comments.createSimple(pageId, text);
      success('Comment created!');
      info(`ID: ${comment.id}`);
      info(`Discussion ID: ${comment.discussion_id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Export Commands
// ============================================
const exportCmd = program
  .command('export')
  .description('Export Notion content to Markdown');

exportCmd
  .command('page <pageId>')
  .description('Export a page to Markdown')
  .option('-o, --output <dir>', 'Output directory')
  .option('-m, --metadata', 'Include frontmatter metadata')
  .option('-c, --children', 'Include child pages')
  .option('-r, --recursive', 'Recursively export all nested pages')
  .action(async (pageId: string, opts) => {
    try {
      const notion = requireAuth();
      info(`Exporting page ${pageId}...`);

      const result = await notion.export.exportPage(pageId, {
        outputDir: opts.output,
        includeMetadata: opts.metadata,
        includeChildPages: opts.children,
        recursive: opts.recursive,
      });

      success(`Exported: ${result.title}`);
      info(`File: ${result.filePath}`);

      if (result.childPages && result.childPages.length > 0) {
        info(`Child pages exported: ${result.childPages.length}`);
        for (const child of result.childPages) {
          info(`  - ${child.title}: ${child.filePath}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('database <databaseId>')
  .description('Export all pages in a database to Markdown')
  .option('-o, --output <dir>', 'Output directory')
  .option('-m, --metadata', 'Include frontmatter metadata')
  .option('-c, --children', 'Include child pages')
  .option('-r, --recursive', 'Recursively export all nested pages')
  .action(async (databaseId: string, opts) => {
    try {
      const notion = requireAuth();
      info(`Exporting database ${databaseId}...`);

      const results = await notion.export.exportDatabase(databaseId, {
        outputDir: opts.output,
        includeMetadata: opts.metadata,
        includeChildPages: opts.children,
        recursive: opts.recursive,
      });

      success(`Exported ${results.length} pages from database`);
      for (const result of results) {
        info(`  - ${result.title}: ${result.filePath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('workspace')
  .description('Export entire workspace to Markdown')
  .option('-o, --output <dir>', 'Output directory')
  .option('-m, --metadata', 'Include frontmatter metadata')
  .action(async (opts) => {
    try {
      const notion = requireAuth();
      info('Exporting workspace...');
      info('This may take a while for large workspaces.');

      const results = await notion.export.exportWorkspace({
        outputDir: opts.output,
        includeMetadata: opts.metadata,
        recursive: true,
      });

      success(`Exported ${results.length} top-level pages`);
      let totalPages = results.length;
      const countChildren = (items: typeof results): number => {
        let count = 0;
        for (const item of items) {
          if (item.childPages) {
            count += item.childPages.length;
            count += countChildren(item.childPages);
          }
        }
        return count;
      };
      totalPages += countChildren(results);
      info(`Total pages exported: ${totalPages}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Bulk Operations Commands
// ============================================
import { FilterParser } from '../api/bulk';

const bulkCmd = program
  .command('bulk')
  .description('Bulk operations on pages');

bulkCmd
  .command('update')
  .description('Bulk update properties on multiple pages')
  .option('-d, --database <id>', 'Database ID to query pages from')
  .option('-w, --where <filter>', 'Filter condition (e.g., "Type=App", "Status!=Done")')
  .option('-i, --ids <ids>', 'Comma-separated page IDs to update')
  .option('-s, --set <update>', 'Property update (e.g., "Type=Platform"). Can be used multiple times', (val, prev: string[]) => [...prev, val], [] as string[])
  .option('-c, --concurrency <n>', 'Max concurrent API calls', '3')
  .option('--dry-run', 'Preview changes without applying')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    try {
      const notion = requireAuth();

      // Validate inputs
      if (!opts.database && !opts.ids) {
        error('Either --database or --ids must be specified');
        process.exit(1);
      }

      if (!opts.set || opts.set.length === 0) {
        error('At least one --set option is required');
        info('Example: --set "Type=Platform" --set "Status=In progress"');
        process.exit(1);
      }

      // Parse updates
      const updates = opts.set.map((s: string) => FilterParser.parseUpdate(s));

      // Get page IDs if specified
      const pageIds = opts.ids ? opts.ids.split(',').map((id: string) => id.trim()) : undefined;

      // Preview first
      info('Fetching pages...');
      const preview = await notion.bulk.preview({
        databaseId: opts.database,
        where: opts.where,
        pageIds,
        updates,
      });

      if (preview.pages.length === 0) {
        warn('No pages match the filter criteria');
        return;
      }

      // Show preview
      info(`\nFound ${chalk.bold(preview.pages.length)} pages to update:\n`);

      // Show first 10 pages
      const displayPages = preview.pages.slice(0, 10);
      for (const page of displayPages) {
        const title = page.title || page.id;
        const currentVals = Object.entries(page.currentValues)
          .map(([k, v]) => `${k}: ${chalk.yellow(String(v))}`)
          .join(', ');
        info(`  ${chalk.cyan(title)}`);
        if (currentVals) {
          info(`    Current: ${currentVals}`);
        }
      }

      if (preview.pages.length > 10) {
        info(`  ... and ${preview.pages.length - 10} more pages`);
      }

      info(`\nUpdates to apply:`);
      for (const update of updates) {
        info(`  ${update.property} → ${chalk.green(update.value)}`);
      }

      if (opts.dryRun) {
        warn('\n[DRY RUN] No changes will be made');
        return;
      }

      // Confirm unless --yes
      if (!opts.yes) {
        info(`\n${chalk.yellow('This will update')} ${chalk.bold(preview.pages.length)} ${chalk.yellow('pages.')}`);
        info('Use --yes to skip this confirmation, or --dry-run to preview.\n');

        // Simple confirmation - wait for user
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question('Proceed? [y/N] ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          info('Cancelled');
          return;
        }
      }

      // Execute bulk update
      info('\nUpdating pages...');

      let lastProgressLog = 0;
      const result = await notion.bulk.update({
        databaseId: opts.database,
        where: opts.where,
        pageIds,
        updates,
        concurrency: parseInt(opts.concurrency),
        dryRun: false,
        onProgress: (current, total) => {
          // Log progress every 10% or every 5 items
          const percent = Math.floor((current / total) * 100);
          if (percent >= lastProgressLog + 10 || current === total) {
            info(`  Progress: ${current}/${total} (${percent}%)`);
            lastProgressLog = percent;
          }
        },
        onError: (err, page) => {
          warn(`  Failed to update ${page.id}: ${err.message}`);
        },
      });

      // Summary
      info('');
      success(`Bulk update complete!`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${chalk.green(result.success)}`);
      if (result.failed > 0) {
        info(`  Failed: ${chalk.red(result.failed)}`);
      }

      if (result.errors.length > 0 && result.errors.length <= 5) {
        warn('\nErrors:');
        for (const err of result.errors) {
          warn(`  ${err.pageId}: ${err.error}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('preview')
  .description('Preview pages that would be affected by a bulk update')
  .option('-d, --database <id>', 'Database ID to query pages from')
  .option('-w, --where <filter>', 'Filter condition (e.g., "Type=App")')
  .option('-i, --ids <ids>', 'Comma-separated page IDs')
  .option('-p, --property <name>', 'Show specific property values. Can be used multiple times', (val, prev: string[]) => [...prev, val], [] as string[])
  .action(async (opts) => {
    try {
      const notion = requireAuth();

      if (!opts.database && !opts.ids) {
        error('Either --database or --ids must be specified');
        process.exit(1);
      }

      const pageIds = opts.ids ? opts.ids.split(',').map((id: string) => id.trim()) : undefined;

      // Create dummy updates to show property values
      const updates = (opts.property || []).map((p: string) => ({ property: p, value: '' }));

      info('Fetching pages...');
      const preview = await notion.bulk.preview({
        databaseId: opts.database,
        where: opts.where,
        pageIds,
        updates,
      });

      if (preview.pages.length === 0) {
        warn('No pages match the filter criteria');
        return;
      }

      success(`Found ${preview.pages.length} pages:\n`);

      for (const page of preview.pages) {
        const title = page.title || page.id;
        info(`${chalk.cyan(title)} (${chalk.gray(page.id)})`);

        if (Object.keys(page.currentValues).length > 0) {
          for (const [key, value] of Object.entries(page.currentValues)) {
            info(`  ${key}: ${chalk.yellow(String(value))}`);
          }
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('schema <databaseId>')
  .description('Show database schema (property names and types)')
  .action(async (databaseId: string) => {
    try {
      const notion = requireAuth();
      const db = await notion.bulk.getSchema(databaseId);

      const title = db.title.map(t => t.plain_text).join('');
      success(`Database: ${title}\n`);

      info('Properties:');
      for (const [name, config] of Object.entries(db.properties)) {
        const type = config.type;
        let extra = '';

        // Show options for select/status
        if (type === 'select' && config.select) {
          const options = (config.select as { options: Array<{ name: string }> }).options;
          if (options && options.length > 0) {
            extra = ` [${options.map(o => o.name).join(', ')}]`;
          }
        } else if (type === 'status' && config.status) {
          const options = (config.status as { options: Array<{ name: string }> }).options;
          if (options && options.length > 0) {
            extra = ` [${options.map(o => o.name).join(', ')}]`;
          }
        } else if (type === 'multi_select' && config.multi_select) {
          const options = (config.multi_select as { options: Array<{ name: string }> }).options;
          if (options && options.length > 0) {
            extra = ` [${options.map(o => o.name).join(', ')}]`;
          }
        }

        info(`  ${chalk.cyan(name)}: ${chalk.yellow(type)}${chalk.gray(extra)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
