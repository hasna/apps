#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GoogleSheets } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccessToken,
  setAccessToken,
  setOAuthTokens,
  getRefreshToken,
  getClientId,
  getClientSecret,
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
  getAuthType,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';
import type { CellValue } from '../types';

const CONNECTOR_NAME = 'connect-googlesheets';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Sheets API v4 connector - Read and write spreadsheets')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.GOOGLE_API_KEY = opts.apiKey;
    }
    // Set access token from flag if provided
    if (opts.token) {
      process.env.GOOGLE_ACCESS_TOKEN = opts.token;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): GoogleSheets {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!apiKey && !accessToken) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-key <key>" for API key auth or "${CONNECTOR_NAME} config set-token <token>" for OAuth.`);
    process.exit(1);
  }

  return new GoogleSheets({
    apiKey,
    accessToken,
    refreshToken,
    clientId,
    clientSecret,
  });
}

// Helper to parse values from CLI
function parseValues(valuesStr: string): CellValue[][] {
  try {
    const parsed = JSON.parse(valuesStr);
    if (!Array.isArray(parsed)) {
      // Single row
      return [Array.isArray(parsed) ? parsed : [parsed]];
    }
    // Check if it's already 2D array
    if (parsed.length > 0 && Array.isArray(parsed[0])) {
      return parsed;
    }
    // Single row as array
    return [parsed];
  } catch {
    // Treat as comma-separated single row
    return [valuesStr.split(',').map(v => v.trim())];
  }
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }

    success(`Profiles:`);
    profiles.forEach(p => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--token <token>', 'OAuth access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      accessToken: opts.token,
    });
    success(`Profile "${name}" created`);

    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
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

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 10)}...` : chalk.gray('not set')}`);
    info(`Refresh Token: ${config.refreshToken ? 'configured' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set Google API key (for read-only access to public sheets)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-token <accessToken>')
  .description('Set OAuth access token (for full read/write access)')
  .option('--refresh <refreshToken>', 'Refresh token')
  .option('--expires <timestamp>', 'Token expiry timestamp (ms)')
  .action((accessToken: string, opts) => {
    const expiresAt = opts.expires ? parseInt(opts.expires) : undefined;
    if (opts.refresh) {
      setOAuthTokens(accessToken, opts.refresh, expiresAt);
    } else {
      setAccessToken(accessToken, expiresAt);
    }
    success(`OAuth tokens saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const authType = getAuthType();
    const apiKey = getApiKey();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Auth type: ${authType}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 10)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Main Commands
// ============================================

program
  .command('get <spreadsheetId> <range>')
  .description('Read cell values from a range (e.g., "Sheet1!A1:B10")')
  .option('--raw', 'Return unformatted values')
  .option('--formulas', 'Return formulas instead of calculated values')
  .action(async (spreadsheetId: string, range: string, opts) => {
    try {
      const client = getClient();
      const valueRenderOption = opts.formulas ? 'FORMULA' : opts.raw ? 'UNFORMATTED_VALUE' : 'FORMATTED_VALUE';

      const result = await client.values.get(spreadsheetId, range, {
        valueRenderOption,
      });

      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('set <spreadsheetId> <range> <values>')
  .description('Write cell values to a range. Values can be JSON array or comma-separated.')
  .option('--raw', 'Use RAW input (no formula parsing)')
  .action(async (spreadsheetId: string, range: string, valuesStr: string, opts) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Writing requires OAuth authentication. Use "config set-token" to configure OAuth.');
        process.exit(1);
      }

      const values = parseValues(valuesStr);
      const valueInputOption = opts.raw ? 'RAW' : 'USER_ENTERED';

      const result = await client.values.update(spreadsheetId, range, values, {
        valueInputOption,
      });

      success(`Updated ${result.updatedCells} cells in ${result.updatedRange}`);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('append <spreadsheetId> <range> <values>')
  .description('Append rows to a table. Values can be JSON array or comma-separated.')
  .option('--raw', 'Use RAW input (no formula parsing)')
  .option('--overwrite', 'Overwrite existing data instead of inserting rows')
  .action(async (spreadsheetId: string, range: string, valuesStr: string, opts) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Writing requires OAuth authentication. Use "config set-token" to configure OAuth.');
        process.exit(1);
      }

      const values = parseValues(valuesStr);
      const valueInputOption = opts.raw ? 'RAW' : 'USER_ENTERED';
      const insertDataOption = opts.overwrite ? 'OVERWRITE' : 'INSERT_ROWS';

      const result = await client.values.append(spreadsheetId, range, values, {
        valueInputOption,
        insertDataOption,
      });

      success(`Appended ${result.updates.updatedCells} cells`);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create <title>')
  .description('Create a new spreadsheet')
  .option('--locale <locale>', 'Spreadsheet locale (e.g., "en_US")')
  .option('--timezone <tz>', 'Spreadsheet timezone (e.g., "America/New_York")')
  .action(async (title: string, opts) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Creating spreadsheets requires OAuth authentication. Use "config set-token" to configure OAuth.');
        process.exit(1);
      }

      const result = await client.spreadsheets.create(title, {
        locale: opts.locale,
        timeZone: opts.timezone,
      });

      success(`Created spreadsheet: ${result.properties.title}`);
      info(`ID: ${result.spreadsheetId}`);
      info(`URL: ${result.spreadsheetUrl}`);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-sheets <spreadsheetId>')
  .description('List all sheets in a spreadsheet')
  .action(async (spreadsheetId: string) => {
    try {
      const client = getClient();
      const spreadsheet = await client.spreadsheets.get(spreadsheetId);

      console.log(chalk.bold(`Spreadsheet: ${spreadsheet.properties.title}`));
      console.log(chalk.gray(`ID: ${spreadsheetId}`));
      console.log();

      if (spreadsheet.sheets && spreadsheet.sheets.length > 0) {
        success(`Sheets (${spreadsheet.sheets.length}):`);
        spreadsheet.sheets.forEach((sheet, index) => {
          const props = sheet.properties;
          const hidden = props.hidden ? chalk.gray(' (hidden)') : '';
          const grid = props.gridProperties
            ? chalk.gray(` [${props.gridProperties.rowCount} x ${props.gridProperties.columnCount}]`)
            : '';
          console.log(`  ${index + 1}. ${props.title}${hidden}${grid}`);
          console.log(chalk.gray(`     ID: ${props.sheetId}`));
        });
      } else {
        info('No sheets found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('info <spreadsheetId>')
  .description('Get spreadsheet metadata')
  .action(async (spreadsheetId: string) => {
    try {
      const client = getClient();
      const spreadsheet = await client.spreadsheets.get(spreadsheetId);

      print(spreadsheet, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('clear <spreadsheetId> <range>')
  .description('Clear values from a range')
  .action(async (spreadsheetId: string, range: string) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Clearing values requires OAuth authentication. Use "config set-token" to configure OAuth.');
        process.exit(1);
      }

      const result = await client.values.clear(spreadsheetId, range);

      success(`Cleared range: ${result.clearedRange}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sheet Management Commands
// ============================================
const sheetCmd = program
  .command('sheet')
  .description('Manage individual sheets');

sheetCmd
  .command('add <spreadsheetId> <title>')
  .description('Add a new sheet to a spreadsheet')
  .option('--index <index>', 'Position to insert the sheet')
  .action(async (spreadsheetId: string, title: string, opts) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Adding sheets requires OAuth authentication.');
        process.exit(1);
      }

      const result = await client.sheets.add(spreadsheetId, title, {
        index: opts.index ? parseInt(opts.index) : undefined,
      });

      const addedSheet = result.replies?.[0]?.addSheet;
      if (addedSheet) {
        success(`Added sheet: ${addedSheet.properties.title}`);
        info(`Sheet ID: ${addedSheet.properties.sheetId}`);
      } else {
        success('Sheet added');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetCmd
  .command('delete <spreadsheetId> <sheetId>')
  .description('Delete a sheet from a spreadsheet')
  .action(async (spreadsheetId: string, sheetIdStr: string) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Deleting sheets requires OAuth authentication.');
        process.exit(1);
      }

      const sheetId = parseInt(sheetIdStr);
      await client.sheets.delete(spreadsheetId, sheetId);

      success(`Deleted sheet ID: ${sheetId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetCmd
  .command('rename <spreadsheetId> <sheetId> <newTitle>')
  .description('Rename a sheet')
  .action(async (spreadsheetId: string, sheetIdStr: string, newTitle: string) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Renaming sheets requires OAuth authentication.');
        process.exit(1);
      }

      const sheetId = parseInt(sheetIdStr);
      await client.sheets.rename(spreadsheetId, sheetId, newTitle);

      success(`Renamed sheet to: ${newTitle}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetCmd
  .command('copy <spreadsheetId> <sheetId> <destSpreadsheetId>')
  .description('Copy a sheet to another spreadsheet')
  .action(async (spreadsheetId: string, sheetIdStr: string, destSpreadsheetId: string) => {
    try {
      const client = getClient();

      if (client.isApiKeyAuth()) {
        error('Copying sheets requires OAuth authentication.');
        process.exit(1);
      }

      const sheetId = parseInt(sheetIdStr);
      const result = await client.sheets.copy(spreadsheetId, sheetId, destSpreadsheetId);

      success(`Copied sheet to destination`);
      info(`New sheet ID: ${result.sheetId}`);
      info(`New sheet title: ${result.title}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
