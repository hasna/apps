#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zenodo } from '../api';
import {
  buildConnectorConfig,
  clearConfig,
  createProfile,
  deleteProfile,
  getAccessToken,
  getActiveProfileName,
  getBaseUrl,
  getCurrentProfile,
  isSelectableProfile,
  listProfiles,
  loadProfile,
  profileExists,
  setAccessToken,
  setBaseUrl,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import type { OutputFormat, ZenodoMetadata } from '../types';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-zenodo';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zenodo research data repository CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!isSelectableProfile(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || cmd.opts().format || 'pretty') as OutputFormat;
}

function getZenodo(): Zenodo {
  return new Zenodo(buildConnectorConfig());
}

function parseMetadataJson(raw?: string): ZenodoMetadata | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ZenodoMetadata;
  } catch {
    throw new Error('Invalid JSON metadata');
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const active = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }

    profiles.forEach((p) => {
      const marker = p === active ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!isSelectableProfile(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'Personal access token')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { token?: string; baseUrl?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      baseUrl: opts.baseUrl,
    });

    success(`Created profile: ${name}`);

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

    if (!deleteProfile(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }

    success(`Deleted profile: ${name}`);
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getActiveProfileName();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Base URL: ${config.baseUrl || getBaseUrl()}`);
    info(`Access token: ${config.accessToken ? chalk.green('configured') : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Save personal access token for the active profile')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL (e.g. https://sandbox.zenodo.org/api)')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getAccessToken();

    console.log(chalk.bold('Zenodo Configuration:'));
    info(`Active profile: ${profileName}`);
    info(`Base URL: ${getBaseUrl()}`);
    info(`Access token: ${token ? chalk.green('configured') : chalk.gray('not set (required for deposit commands)')}`);
  });

configCmd
  .command('clear')
  .description('Clear active profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

program
  .command('search <query>')
  .description('Search published Zenodo records')
  .option('-n, --size <number>', 'Results per page', '10')
  .option('--page <number>', 'Page number', '1')
  .option('--type <type>', 'Record type filter (e.g. Publication, Dataset)')
  .option('--sort <sort>', 'Sort order (bestmatch, mostrecent, -mostrecent)')
  .action(async (query: string, opts) => {
    try {
      const zenodo = getZenodo();
      const result = await zenodo.searchRecords({
        q: query,
        size: parseInt(opts.size, 10),
        page: parseInt(opts.page, 10),
        type: opts.type,
        sort: opts.sort,
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
        return;
      }

      info(`Found ${result.total} records (showing ${result.hits.length})`);
      for (const record of result.hits) {
        console.log();
        const title = record.metadata?.title || `Record ${record.id}`;
        console.log(chalk.bold(title));
        console.log(chalk.gray(`  ID: ${record.id}${record.doi ? ` | DOI: ${record.doi}` : ''}`));
        if (record.metadata?.creators?.length) {
          console.log(chalk.cyan(`  Creators: ${record.metadata.creators.map((c) => c.name).join(', ')}`));
        }
        if (record.links?.self) {
          console.log(chalk.blue(`  ${record.links.self}`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get <recordId>')
  .description('Get a published record by ID')
  .action(async (recordId: string) => {
    try {
      const zenodo = getZenodo();
      const record = await zenodo.getRecord(recordId);

      if (getFormat(program) === 'json') {
        print(record, 'json');
        return;
      }

      console.log(chalk.bold(record.metadata?.title || `Record ${record.id}`));
      console.log();
      console.log(chalk.cyan(`ID: ${record.id}`));
      if (record.doi) console.log(chalk.cyan(`DOI: ${record.doi}`));
      if (record.metadata?.upload_type) console.log(chalk.cyan(`Type: ${record.metadata.upload_type}`));
      if (record.metadata?.description) {
        console.log();
        console.log(chalk.bold('Description:'));
        console.log(record.metadata.description);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const depositionCmd = program.command('deposition').alias('depositions').description('Manage deposit depositions');

depositionCmd
  .command('list')
  .description('List your depositions')
  .action(async () => {
    try {
      const zenodo = getZenodo();
      const depositions = await zenodo.listDepositions();

      if (getFormat(program) === 'json') {
        print(depositions, 'json');
        return;
      }

      if (depositions.length === 0) {
        info('No depositions found.');
        return;
      }

      for (const dep of depositions) {
        console.log();
        console.log(chalk.bold(dep.metadata?.title || `Deposition ${dep.id}`));
        console.log(chalk.gray(`  ID: ${dep.id} | State: ${dep.state || 'unknown'}`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

depositionCmd
  .command('get <id>')
  .description('Get a deposition by ID')
  .action(async (id: string) => {
    try {
      const zenodo = getZenodo();
      const deposition = await zenodo.getDeposition(id);
      print(deposition, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

depositionCmd
  .command('create')
  .description('Create a new deposition draft')
  .option('--metadata <json>', 'Deposition metadata JSON')
  .option('--title <title>', 'Shortcut: set metadata title')
  .option('--description <text>', 'Shortcut: set metadata description')
  .option('--upload-type <type>', 'Shortcut: set upload_type (e.g. publication, dataset)')
  .action(async (opts: { metadata?: string; title?: string; description?: string; uploadType?: string }) => {
    try {
      const zenodo = getZenodo();
      const metadata = parseMetadataJson(opts.metadata) || {};

      if (opts.title) metadata.title = opts.title;
      if (opts.description) metadata.description = opts.description;
      if (opts.uploadType) metadata.upload_type = opts.uploadType;

      const deposition = await zenodo.createDeposition(
        Object.keys(metadata).length > 0 ? { metadata } : {},
      );

      if (getFormat(program) === 'json') {
        print(deposition, 'json');
      } else {
        success(`Created deposition ${deposition.id}`);
        if (deposition.links?.html) {
          info(`Edit at: ${deposition.links.html}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

depositionCmd
  .command('publish <id>')
  .description('Publish a deposition')
  .action(async (id: string) => {
    try {
      const zenodo = getZenodo();
      const deposition = await zenodo.publishDeposition(id);

      if (getFormat(program) === 'json') {
        print(deposition, 'json');
      } else {
        success(`Published deposition ${id}`);
        if (deposition.doi) {
          info(`DOI: ${deposition.doi}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
