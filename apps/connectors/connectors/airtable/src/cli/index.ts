#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Airtable } from '../api';
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
import type { Record as AirtableRecord, Field } from '../types';

const program = new Command();

// Helper to get authenticated client
function getClient(): Airtable {
  const accessToken = getAccessToken();
  if (!accessToken) {
    console.error(chalk.red('Error: Not authenticated. Run "connect-airtable auth set <token>" first or set AIRTABLE_ACCESS_TOKEN.'));
    process.exit(1);
  }
  return new Airtable({ accessToken });
}

// Format field type
function formatFieldType(field: Field): string {
  let typeStr = field.type;
  if (field.options?.linkedTableId) {
    typeStr += ` -> ${field.options.linkedTableId}`;
  }
  return typeStr;
}

// Format record for display
function formatRecord(record: AirtableRecord): void {
  console.log(`\n${chalk.bold('Record ID:')} ${chalk.cyan(record.id)}`);
  console.log(`${chalk.gray('Created:')} ${record.createdTime}`);
  console.log(chalk.bold('Fields:'));
  for (const [key, value] of Object.entries(record.fields)) {
    const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    console.log(`  ${chalk.white(key)}: ${displayValue}`);
  }
}

program
  .name('connect-airtable')
  .description('Airtable connector - Manage bases, tables, records, and views')
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
  .argument('<token>', 'Airtable personal access token or API key')
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
      console.log(chalk.gray('Run "connect-airtable auth set <token>" to authenticate'));
      return;
    }

    try {
      const client = getClient();
      const result = await client.listBases();
      console.log(chalk.green('Authenticated'));
      console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
      console.log(`  Accessible Bases: ${chalk.white(result.bases.length)}`);
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
// Bases Commands
// ============================================

const basesCmd = program.command('bases').description('Base operations');

basesCmd
  .command('list')
  .description('List all accessible bases')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listBases();

      if (result.bases.length === 0) {
        console.log(chalk.gray('No bases found'));
        return;
      }

      console.log(chalk.bold(`Bases (${result.bases.length}):`));
      for (const base of result.bases) {
        console.log(`\n  ${chalk.white(base.name)}`);
        console.log(`    ID: ${chalk.gray(base.id)}`);
        console.log(`    Permission: ${base.permissionLevel}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

basesCmd
  .command('schema')
  .description('Get base schema (tables and fields)')
  .argument('<base-id>', 'Base ID')
  .action(async (baseId: string) => {
    try {
      const client = getClient();
      const result = await client.getBaseSchema(baseId);

      console.log(chalk.bold(`Tables (${result.tables.length}):`));
      for (const table of result.tables) {
        console.log(`\n  ${chalk.blue(table.name)}`);
        console.log(`    ID: ${chalk.gray(table.id)}`);
        if (table.description) {
          console.log(`    Description: ${table.description}`);
        }
        console.log(`    Primary Field: ${table.primaryFieldId}`);

        console.log(chalk.gray('    Fields:'));
        for (const field of table.fields) {
          console.log(`      - ${chalk.white(field.name)} (${formatFieldType(field)})`);
        }

        if (table.views.length > 0) {
          console.log(chalk.gray('    Views:'));
          for (const view of table.views) {
            console.log(`      - ${view.name} [${view.type}]`);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Tables Commands
// ============================================

const tablesCmd = program.command('tables').description('Table operations');

tablesCmd
  .command('create')
  .description('Create a table in a base')
  .argument('<base-id>', 'Base ID')
  .requiredOption('-n, --name <name>', 'Table name')
  .option('-d, --description <description>', 'Table description')
  .action(async (baseId: string, options) => {
    try {
      const client = getClient();
      const table = await client.createTable(baseId, {
        name: options.name,
        description: options.description,
        fields: [
          { name: 'Name', type: 'singleLineText' },
        ],
      });
      console.log(chalk.green(`Table created: ${table.name}`));
      console.log(`  ID: ${chalk.gray(table.id)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

tablesCmd
  .command('update')
  .description('Update table metadata')
  .argument('<base-id>', 'Base ID')
  .argument('<table-id>', 'Table ID')
  .option('-n, --name <name>', 'New table name')
  .option('-d, --description <description>', 'New description')
  .action(async (baseId: string, tableId: string, options) => {
    try {
      const client = getClient();
      const table = await client.updateTable(baseId, tableId, {
        name: options.name,
        description: options.description,
      });
      console.log(chalk.green(`Table updated: ${table.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Records Commands
// ============================================

const recordsCmd = program.command('records').description('Record operations');

recordsCmd
  .command('list')
  .description('List records in a table')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .option('-f, --filter <formula>', 'Filter by formula')
  .option('-v, --view <view>', 'View to use')
  .option('--max <n>', 'Maximum records', '100')
  .option('--fields <fields>', 'Comma-separated field names')
  .option('--json', 'Output as JSON')
  .action(async (baseId: string, table: string, options) => {
    try {
      const client = getClient();
      const result = await client.listRecords(baseId, table, {
        filterByFormula: options.filter,
        view: options.view,
        maxRecords: parseInt(options.max),
        fields: options.fields?.split(','),
      });

      if (options.json) {
        console.log(JSON.stringify(result.records, null, 2));
        return;
      }

      if (result.records.length === 0) {
        console.log(chalk.gray('No records found'));
        return;
      }

      console.log(chalk.bold(`Records (${result.records.length}):`));
      for (const record of result.records) {
        formatRecord(record);
      }

      if (result.offset) {
        console.log(chalk.gray(`\n... more records available (offset: ${result.offset})`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

recordsCmd
  .command('get')
  .description('Get a single record')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .argument('<record-id>', 'Record ID')
  .option('--json', 'Output as JSON')
  .action(async (baseId: string, table: string, recordId: string, options) => {
    try {
      const client = getClient();
      const record = await client.getRecord(baseId, table, recordId);

      if (options.json) {
        console.log(JSON.stringify(record, null, 2));
        return;
      }

      formatRecord(record);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

recordsCmd
  .command('create')
  .description('Create a record')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .requiredOption('-d, --data <json>', 'Field data as JSON')
  .option('--typecast', 'Enable typecast for automatic field conversion')
  .action(async (baseId: string, table: string, options) => {
    try {
      const fields = JSON.parse(options.data);
      const client = getClient();
      const record = await client.createRecord(baseId, table, fields, {
        typecast: options.typecast,
      });
      console.log(chalk.green(`Record created: ${record.id}`));
      formatRecord(record as AirtableRecord);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

recordsCmd
  .command('update')
  .description('Update a record')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .argument('<record-id>', 'Record ID')
  .requiredOption('-d, --data <json>', 'Field data as JSON')
  .option('--typecast', 'Enable typecast for automatic field conversion')
  .action(async (baseId: string, table: string, recordId: string, options) => {
    try {
      const fields = JSON.parse(options.data);
      const client = getClient();
      const record = await client.updateRecord(baseId, table, recordId, fields, {
        typecast: options.typecast,
      });
      console.log(chalk.green(`Record updated: ${record.id}`));
      formatRecord(record as AirtableRecord);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

recordsCmd
  .command('delete')
  .description('Delete a record')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .argument('<record-id>', 'Record ID')
  .action(async (baseId: string, table: string, recordId: string) => {
    try {
      const client = getClient();
      const result = await client.deleteRecord(baseId, table, recordId);
      console.log(chalk.green(`Record deleted: ${result.id}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Fields Commands
// ============================================

const fieldsCmd = program.command('fields').description('Field operations');

fieldsCmd
  .command('create')
  .description('Create a field in a table')
  .argument('<base-id>', 'Base ID')
  .argument('<table-id>', 'Table ID')
  .requiredOption('-n, --name <name>', 'Field name')
  .requiredOption('-t, --type <type>', 'Field type')
  .option('-d, --description <description>', 'Field description')
  .option('--options <json>', 'Field options as JSON')
  .action(async (baseId: string, tableId: string, options) => {
    try {
      const client = getClient();
      const field = await client.createField(baseId, tableId, {
        name: options.name,
        type: options.type,
        description: options.description,
        options: options.options ? JSON.parse(options.options) : undefined,
      });
      console.log(chalk.green(`Field created: ${field.name}`));
      console.log(`  ID: ${chalk.gray(field.id)}`);
      console.log(`  Type: ${field.type}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

fieldsCmd
  .command('update')
  .description('Update a field')
  .argument('<base-id>', 'Base ID')
  .argument('<table-id>', 'Table ID')
  .argument('<field-id>', 'Field ID')
  .option('-n, --name <name>', 'New field name')
  .option('-d, --description <description>', 'New description')
  .action(async (baseId: string, tableId: string, fieldId: string, options) => {
    try {
      const client = getClient();
      const field = await client.updateField(baseId, tableId, fieldId, {
        name: options.name,
        description: options.description,
      });
      console.log(chalk.green(`Field updated: ${field.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Comments Commands
// ============================================

const commentsCmd = program.command('comments').description('Comment operations');

commentsCmd
  .command('list')
  .description('List comments on a record')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .argument('<record-id>', 'Record ID')
  .action(async (baseId: string, table: string, recordId: string) => {
    try {
      const client = getClient();
      const result = await client.listComments(baseId, table, recordId);

      if (result.comments.length === 0) {
        console.log(chalk.gray('No comments'));
        return;
      }

      console.log(chalk.bold(`Comments (${result.comments.length}):`));
      for (const comment of result.comments) {
        console.log(`\n  ${chalk.white(comment.author.name || comment.author.email)}`);
        console.log(`    ${chalk.gray(comment.createdTime)}`);
        console.log(`    ${comment.text}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

commentsCmd
  .command('create')
  .description('Create a comment on a record')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .argument('<record-id>', 'Record ID')
  .argument('<text>', 'Comment text')
  .action(async (baseId: string, table: string, recordId: string, text: string) => {
    try {
      const client = getClient();
      const comment = await client.createComment(baseId, table, recordId, text);
      console.log(chalk.green('Comment created'));
      console.log(`  ID: ${chalk.gray(comment.id)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

commentsCmd
  .command('delete')
  .description('Delete a comment')
  .argument('<base-id>', 'Base ID')
  .argument('<table>', 'Table ID or name')
  .argument('<record-id>', 'Record ID')
  .argument('<comment-id>', 'Comment ID')
  .action(async (baseId: string, table: string, recordId: string, commentId: string) => {
    try {
      const client = getClient();
      await client.deleteComment(baseId, table, recordId, commentId);
      console.log(chalk.green('Comment deleted'));
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
  .description('List webhooks for a base')
  .argument('<base-id>', 'Base ID')
  .action(async (baseId: string) => {
    try {
      const client = getClient();
      const result = await client.listWebhooks(baseId);

      if (result.webhooks.length === 0) {
        console.log(chalk.gray('No webhooks'));
        return;
      }

      console.log(chalk.bold(`Webhooks (${result.webhooks.length}):`));
      for (const webhook of result.webhooks) {
        console.log(`\n  ID: ${chalk.white(webhook.id)}`);
        console.log(`    Enabled: ${webhook.isHookEnabled ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`    Notifications: ${webhook.areNotificationsEnabled ? chalk.green('Yes') : chalk.red('No')}`);
        if (webhook.notificationUrl) {
          console.log(`    URL: ${webhook.notificationUrl}`);
        }
        if (webhook.expirationTime) {
          console.log(`    Expires: ${webhook.expirationTime}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete')
  .description('Delete a webhook')
  .argument('<base-id>', 'Base ID')
  .argument('<webhook-id>', 'Webhook ID')
  .action(async (baseId: string, webhookId: string) => {
    try {
      const client = getClient();
      await client.deleteWebhook(baseId, webhookId);
      console.log(chalk.green('Webhook deleted'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

webhooksCmd
  .command('refresh')
  .description('Refresh a webhook (extend expiration)')
  .argument('<base-id>', 'Base ID')
  .argument('<webhook-id>', 'Webhook ID')
  .action(async (baseId: string, webhookId: string) => {
    try {
      const client = getClient();
      const result = await client.refreshWebhook(baseId, webhookId);
      console.log(chalk.green('Webhook refreshed'));
      console.log(`  New expiration: ${result.expirationTime}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
