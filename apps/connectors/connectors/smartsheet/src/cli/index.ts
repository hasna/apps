#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Smartsheet } from '../api';
import {
  getAccessToken,
  setAccessToken,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setProfileOverride,
  getConfigDir,
} from '../utils/config';

const program = new Command();

function getClient(): Smartsheet {
  const accessToken = getAccessToken();
  if (!accessToken) {
    console.error(
      chalk.red(
        'Error: Not authenticated. Run "connect-smartsheet auth set <token>" first or set SMARTSHEET_ACCESS_TOKEN.',
      ),
    );
    process.exit(1);
  }
  return new Smartsheet({ accessToken });
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

program
  .name('connect-smartsheet')
  .description('Smartsheet connector - Sheets, rows, columns, workspaces, and webhooks')
  .version('0.0.1')
  .option('--profile <name>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands
// ============================================

const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('set')
  .description('Set access token for the current profile')
  .argument('<token>', 'Smartsheet API access token')
  .action((token: string) => {
    setAccessToken(token);
    console.log(chalk.green(`Access token saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    const token = getAccessToken();
    if (!token) {
      console.log(chalk.yellow('Not authenticated'));
      console.log(chalk.gray('Run "connect-smartsheet auth set <token>" to authenticate'));
      return;
    }

    try {
      const client = getClient();
      const result = await client.listSheets({ pageSize: 1 });
      console.log(chalk.green('Authenticated'));
      console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
      console.log(`  Total Sheets: ${chalk.white(result.totalCount)}`);
    } catch (error) {
      console.log(chalk.red('Authentication failed'));
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

// ============================================
// Profile Commands
// ============================================

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
      console.log(chalk.yellow(`Cannot delete profile "${name}" (doesn't exist or is default)`));
    }
  });

profileCmd
  .command('show')
  .description('Show current profile')
  .action(() => {
    console.log(`Current profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`Config directory: ${chalk.gray(getConfigDir())}`);
  });

// ============================================
// Sheets Commands
// ============================================

const sheetsCmd = program.command('sheets').description('Sheet operations');

sheetsCmd
  .command('list')
  .description('List all sheets')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listSheets({ includeAll: true });

      if (options.json) {
        printJson(result.data);
        return;
      }

      if (result.data.length === 0) {
        console.log(chalk.gray('No sheets found'));
        return;
      }

      console.log(chalk.bold(`Sheets (${result.totalCount}):`));
      for (const sheet of result.data) {
        console.log(`  ${chalk.white(sheet.name)} ${chalk.gray(`(id: ${sheet.id})`)}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

sheetsCmd
  .command('get')
  .description('Get a sheet by ID')
  .argument('<id>', 'Sheet ID')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    try {
      const client = getClient();
      const sheet = await client.getSheet(parseInt(id, 10));

      if (options.json) {
        printJson(sheet);
        return;
      }

      console.log(chalk.bold(sheet.name));
      console.log(`  ID: ${chalk.gray(String(sheet.id))}`);
      console.log(`  Access: ${sheet.accessLevel}`);
      if (sheet.columns) {
        console.log(chalk.gray(`  Columns: ${sheet.columns.length}`));
      }
      if (sheet.totalRowCount !== undefined) {
        console.log(chalk.gray(`  Rows: ${sheet.totalRowCount}`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

sheetsCmd
  .command('create')
  .description('Create a new sheet')
  .requiredOption('-n, --name <name>', 'Sheet name')
  .option('--folder-id <id>', 'Parent folder ID')
  .option('--workspace-id <id>', 'Parent workspace ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const sheet = await client.createSheet({
        name: options.name,
        columns: [{ title: 'Primary Column', type: 'TEXT_NUMBER', primary: true }],
        folderId: options.folderId ? parseInt(options.folderId, 10) : undefined,
        workspaceId: options.workspaceId ? parseInt(options.workspaceId, 10) : undefined,
      });

      if (options.json) {
        printJson(sheet);
        return;
      }

      console.log(chalk.green(`Sheet created: ${sheet.name}`));
      console.log(`  ID: ${chalk.gray(String(sheet.id))}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

sheetsCmd
  .command('update')
  .description('Update sheet metadata')
  .argument('<id>', 'Sheet ID')
  .option('-n, --name <name>', 'New sheet name')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    try {
      const client = getClient();
      const sheet = await client.updateSheet(parseInt(id, 10), { name: options.name });

      if (options.json) {
        printJson(sheet);
        return;
      }

      console.log(chalk.green(`Sheet updated: ${sheet.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

sheetsCmd
  .command('delete')
  .description('Delete a sheet')
  .argument('<id>', 'Sheet ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteSheet(parseInt(id, 10));
      console.log(chalk.green(`Sheet ${id} deleted`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Rows Commands
// ============================================

const rowsCmd = program.command('rows').description('Row operations');

rowsCmd
  .command('get')
  .description('Get a row')
  .argument('<sheet-id>', 'Sheet ID')
  .argument('<row-id>', 'Row ID')
  .option('--json', 'Output as JSON')
  .action(async (sheetId: string, rowId: string, options) => {
    try {
      const client = getClient();
      const row = await client.getRow(parseInt(sheetId, 10), parseInt(rowId, 10));

      if (options.json) {
        printJson(row);
        return;
      }

      printJson(row);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

rowsCmd
  .command('add')
  .description('Add rows to a sheet')
  .argument('<sheet-id>', 'Sheet ID')
  .requiredOption('-d, --data <json>', 'Row data as JSON array')
  .option('--to-bottom', 'Add rows to bottom')
  .option('--json', 'Output as JSON')
  .action(async (sheetId: string, options) => {
    try {
      const rows = JSON.parse(options.data);
      const client = getClient();
      const result = await client.addRows({
        sheetId: parseInt(sheetId, 10),
        rows: Array.isArray(rows) ? rows : [rows],
        toBottom: options.toBottom ?? true,
      });

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(chalk.green('Rows added'));
      printJson(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

rowsCmd
  .command('update')
  .description('Update rows in a sheet')
  .argument('<sheet-id>', 'Sheet ID')
  .requiredOption('-d, --data <json>', 'Row update data as JSON array')
  .option('--json', 'Output as JSON')
  .action(async (sheetId: string, options) => {
    try {
      const rows = JSON.parse(options.data);
      const client = getClient();
      const result = await client.updateRows({
        sheetId: parseInt(sheetId, 10),
        rows,
      });

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(chalk.green('Rows updated'));
      printJson(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

rowsCmd
  .command('delete')
  .description('Delete rows from a sheet')
  .argument('<sheet-id>', 'Sheet ID')
  .argument('<row-ids>', 'Comma-separated row IDs')
  .action(async (sheetId: string, rowIds: string) => {
    try {
      const ids = rowIds.split(',').map((id) => parseInt(id.trim(), 10));
      const client = getClient();
      await client.deleteRows(parseInt(sheetId, 10), ids);
      console.log(chalk.green(`Deleted ${ids.length} row(s)`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Columns Commands
// ============================================

const columnsCmd = program.command('columns').description('Column operations');

columnsCmd
  .command('list')
  .description('List columns in a sheet')
  .argument('<sheet-id>', 'Sheet ID')
  .option('--json', 'Output as JSON')
  .action(async (sheetId: string, options) => {
    try {
      const client = getClient();
      const result = await client.listColumns(parseInt(sheetId, 10));

      if (options.json) {
        printJson(result.data);
        return;
      }

      console.log(chalk.bold(`Columns (${result.data.length}):`));
      for (const col of result.data) {
        console.log(`  ${chalk.white(col.title)} ${chalk.gray(`(id: ${col.id}, type: ${col.type})`)}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

columnsCmd
  .command('add')
  .description('Add columns to a sheet')
  .argument('<sheet-id>', 'Sheet ID')
  .requiredOption('-d, --data <json>', 'Column definitions as JSON array')
  .option('--json', 'Output as JSON')
  .action(async (sheetId: string, options) => {
    try {
      const columns = JSON.parse(options.data);
      const client = getClient();
      const result = await client.addColumns(parseInt(sheetId, 10), columns);

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(chalk.green('Columns added'));
      printJson(result);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

columnsCmd
  .command('delete')
  .description('Delete a column')
  .argument('<sheet-id>', 'Sheet ID')
  .argument('<column-id>', 'Column ID')
  .action(async (sheetId: string, columnId: string) => {
    try {
      const client = getClient();
      await client.deleteColumn(parseInt(sheetId, 10), parseInt(columnId, 10));
      console.log(chalk.green(`Column ${columnId} deleted`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Folders Commands
// ============================================

const foldersCmd = program.command('folders').description('Folder operations');

foldersCmd
  .command('list')
  .description('List folders')
  .option('--parent-id <id>', 'Parent folder ID')
  .option('--workspace-id <id>', 'Workspace ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listFolders({
        parentId: options.parentId ? parseInt(options.parentId, 10) : undefined,
        workspaceId: options.workspaceId ? parseInt(options.workspaceId, 10) : undefined,
      });

      if (options.json) {
        printJson(result.data);
        return;
      }

      console.log(chalk.bold(`Folders (${result.totalCount}):`));
      for (const folder of result.data) {
        console.log(`  ${chalk.white(folder.name)} ${chalk.gray(`(id: ${folder.id})`)}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

foldersCmd
  .command('create')
  .description('Create a folder')
  .requiredOption('-n, --name <name>', 'Folder name')
  .option('--parent-id <id>', 'Parent folder ID')
  .option('--workspace-id <id>', 'Workspace ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const folder = await client.createFolder({
        name: options.name,
        parentFolderId: options.parentId ? parseInt(options.parentId, 10) : undefined,
        workspaceId: options.workspaceId ? parseInt(options.workspaceId, 10) : undefined,
      });

      if (options.json) {
        printJson(folder);
        return;
      }

      console.log(chalk.green(`Folder created: ${folder.name}`));
      console.log(`  ID: ${chalk.gray(String(folder.id))}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Workspaces Commands
// ============================================

const workspacesCmd = program.command('workspaces').description('Workspace operations');

workspacesCmd
  .command('list')
  .description('List workspaces')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listWorkspaces({ includeAll: true });

      if (options.json) {
        printJson(result.data);
        return;
      }

      console.log(chalk.bold(`Workspaces (${result.totalCount}):`));
      for (const ws of result.data) {
        console.log(`  ${chalk.white(ws.name)} ${chalk.gray(`(id: ${ws.id})`)}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

workspacesCmd
  .command('create')
  .description('Create a workspace')
  .requiredOption('-n, --name <name>', 'Workspace name')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const ws = await client.createWorkspace(options.name);

      if (options.json) {
        printJson(ws);
        return;
      }

      console.log(chalk.green(`Workspace created: ${ws.name}`));
      console.log(`  ID: ${chalk.gray(String(ws.id))}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

workspacesCmd
  .command('delete')
  .description('Delete a workspace')
  .argument('<id>', 'Workspace ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteWorkspace(parseInt(id, 10));
      console.log(chalk.green(`Workspace ${id} deleted`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Reports Commands
// ============================================

const reportsCmd = program.command('reports').description('Report operations');

reportsCmd
  .command('list')
  .description('List reports')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listReports({ includeAll: true });

      if (options.json) {
        printJson(result.data);
        return;
      }

      console.log(chalk.bold(`Reports (${result.totalCount}):`));
      for (const report of result.data) {
        console.log(`  ${chalk.white(report.name)} ${chalk.gray(`(id: ${report.id})`)}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

reportsCmd
  .command('get')
  .description('Get a report by ID')
  .argument('<id>', 'Report ID')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    try {
      const client = getClient();
      const report = await client.getReport(parseInt(id, 10));

      if (options.json) {
        printJson(report);
        return;
      }

      console.log(chalk.bold(report.name));
      console.log(`  ID: ${chalk.gray(String(report.id))}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Webhooks Commands
// ============================================

const webhooksCmd = program.command('webhooks').description('Webhook operations');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listWebhooks();

      if (options.json) {
        printJson(result.data);
        return;
      }

      if (result.data.length === 0) {
        console.log(chalk.gray('No webhooks'));
        return;
      }

      console.log(chalk.bold(`Webhooks (${result.totalCount}):`));
      for (const webhook of result.data) {
        console.log(`\n  ${chalk.white(webhook.name)}`);
        console.log(`    ID: ${chalk.gray(String(webhook.id))}`);
        console.log(`    URL: ${webhook.callbackUrl}`);
        console.log(`    Enabled: ${webhook.enabled ? chalk.green('Yes') : chalk.red('No')}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a webhook')
  .requiredOption('-n, --name <name>', 'Webhook name')
  .requiredOption('-u, --url <url>', 'Callback URL')
  .requiredOption('-s, --sheet-id <id>', 'Sheet ID (scope object)')
  .requiredOption('-e, --events <events>', 'Comma-separated event names')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const webhook = await client.createWebhook({
        name: options.name,
        callbackUrl: options.url,
        scope: 'sheet',
        scopeObjectId: parseInt(options.sheetId, 10),
        events: options.events.split(',').map((e: string) => e.trim()),
      });

      if (options.json) {
        printJson(webhook);
        return;
      }

      console.log(chalk.green(`Webhook created: ${webhook.name}`));
      console.log(`  ID: ${chalk.gray(String(webhook.id))}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
