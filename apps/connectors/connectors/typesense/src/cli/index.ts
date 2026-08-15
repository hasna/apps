#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Typesense } from '../api';
import {
  getApiKey,
  setApiKey,
  getHost,
  setHost,
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

const CONNECTOR_NAME = 'connect-typesense';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Typesense search engine API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('--host <host>', 'Typesense host URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) process.env.TYPESENSE_API_KEY = opts.apiKey;
    if (opts.host) process.env.TYPESENSE_HOST = opts.host;
  });

async function run(fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    print(result, (program.opts().format || 'pretty') as OutputFormat);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

function getClient(): Typesense {
  const apiKey = getApiKey();
  const host = getHost();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TYPESENSE_API_KEY.`);
    process.exit(1);
  }
  if (!host) {
    error(`No host configured. Run "${CONNECTOR_NAME} config set-host <url>" or set TYPESENSE_HOST.`);
    process.exit(1);
  }
  return new Typesense({ apiKey, host });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid JSON for ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function parseJsonArrayOption(value: string, label: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`${label} must be a non-empty JSON array`);
    }
    return parsed as Array<Record<string, unknown>>;
  } catch (err) {
    error(`Invalid JSON for ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  });
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .option('--api-key <key>', 'API key')
  .option('--host <host>', 'Typesense host URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, host: opts.host });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Host: ${config.host || chalk.gray('not set')}`);
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-host <host>').action((host: string) => {
  setHost(host);
  success(`Host saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const apiKey = getApiKey();
  const host = getHost();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Host: ${host || chalk.gray('not set')}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const healthCmd = program.command('health').description('Health and cluster operations');

healthCmd.command('check').action(async function () {
  await run( () => getClient().getHealth());
});

healthCmd.command('debug').action(async function () {
  await run( () => getClient().getDebug());
});

healthCmd.command('stats').action(async function () {
  await run( () => getClient().getStats());
});

healthCmd.command('metrics').action(async function () {
  await run( () => getClient().getMetrics());
});

const collectionsCmd = program.command('collections').description('Collection management');

collectionsCmd.command('list').action(async function () {
  await run( () => getClient().listCollections());
});

collectionsCmd.command('get <name>').action(async function (name: string) {
  await run( () => getClient().getCollection(name));
});

collectionsCmd
  .command('create')
  .requiredOption('--schema <json>', 'Collection schema JSON')
  .action(async function (opts) {
    await run( () => getClient().createCollection(parseJsonOption(opts.schema, 'schema')));
  });

collectionsCmd
  .command('update <name>')
  .requiredOption('--schema <json>', 'Collection schema patch JSON')
  .action(async function (name: string, opts) {
    await run( () => getClient().updateCollection(name, parseJsonOption(opts.schema, 'schema')));
  });

collectionsCmd
  .command('drop <name>')
  .option('--compact-store', 'Compact store on drop')
  .action(async function (name: string, opts) {
    await run( () => getClient().dropCollection(name, opts.compactStore));
  });

collectionsCmd.command('truncate <name>').action(async function (name: string) {
  await run( () => getClient().truncateCollection(name));
});

collectionsCmd.command('schema-changes').action(async function () {
  await run( () => getClient().getSchemaChanges());
});

const documentsCmd = program.command('documents').description('Document operations');

documentsCmd
  .command('create <collection>')
  .requiredOption('--document <json>', 'Document JSON')
  .option('--action <action>', 'create|upsert|update|emplace')
  .action(async function (collection: string, opts) {
    await run( () =>
      getClient().createDocument(collection, parseJsonOption(opts.document, 'document'), opts.action),
    );
  });

documentsCmd.command('get <collection> <id>').action(async function (collection: string, id: string) {
  await run( () => getClient().getDocument(collection, id));
});

documentsCmd
  .command('update <collection> <id>')
  .requiredOption('--document <json>', 'Document patch JSON')
  .action(async function (collection: string, id: string, opts) {
    await run( () => getClient().updateDocument(collection, id, parseJsonOption(opts.document, 'document')));
  });

documentsCmd.command('delete <collection> <id>').action(async function (collection: string, id: string) {
  await run( () => getClient().deleteDocument(collection, id));
});

documentsCmd
  .command('import <collection>')
  .requiredOption('--jsonl <text>', 'JSONL body')
  .option('--action <action>', 'create|upsert|update|emplace')
  .option('--batch-size <n>', 'Batch size', (v) => parseInt(v, 10))
  .option('--return-id', 'Return document IDs')
  .action(async function (collection: string, opts) {
    await run( () =>
      getClient().importDocuments(collection, opts.jsonl, {
        action: opts.action,
        batchSize: opts.batchSize,
        returnId: opts.returnId,
      }),
    );
  });

documentsCmd
  .command('export <collection>')
  .option('--filter-by <expr>', 'Filter expression')
  .option('--include-fields <fields>', 'Include fields')
  .option('--exclude-fields <fields>', 'Exclude fields')
  .action(async function (collection: string, opts) {
    await run( () =>
      getClient().exportDocuments(collection, {
        filterBy: opts.filterBy,
        includeFields: opts.includeFields,
        excludeFields: opts.excludeFields,
      }),
    );
  });

const searchCmd = program.command('search').description('Search operations');

searchCmd
  .command('query <collection>')
  .requiredOption('-q, --q <query>', 'Search query')
  .requiredOption('--query-by <fields>', 'Fields to query')
  .option('--filter-by <expr>', 'Filter expression')
  .option('--sort-by <expr>', 'Sort expression')
  .option('--facet-by <fields>', 'Facet fields')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--per-page <n>', 'Results per page', (v) => parseInt(v, 10))
  .option('--include-fields <fields>', 'Include fields')
  .option('--exclude-fields <fields>', 'Exclude fields')
  .option('--vector-query <expr>', 'Vector query')
  .action(async function (collection: string, opts) {
    await run( () =>
      getClient().search(collection, {
        q: opts.q,
        queryBy: opts.queryBy,
        filterBy: opts.filterBy,
        sortBy: opts.sortBy,
        facetBy: opts.facetBy,
        page: opts.page,
        perPage: opts.perPage,
        includeFields: opts.includeFields,
        excludeFields: opts.excludeFields,
        vectorQuery: opts.vectorQuery,
      }),
    );
  });

searchCmd
  .command('multi')
  .requiredOption('--searches <json>', 'Searches JSON array')
  .option('--common-params <json>', 'Common params JSON object')
  .action(async function (opts) {
    const searches = parseJsonArrayOption(opts.searches, 'searches');
    const commonParams = opts.commonParams ? parseJsonOption(opts.commonParams, 'commonParams') : undefined;
    await run( () => getClient().multiSearch(searches, commonParams));
  });

const keysCmd = program.command('keys').description('API key management');

keysCmd.command('list').action(async function () {
  await run( () => getClient().listApiKeys());
});

keysCmd
  .command('create')
  .requiredOption('--description <text>', 'Key description')
  .requiredOption('--actions <csv>', 'Comma-separated actions')
  .requiredOption('--collections <csv>', 'Comma-separated collections')
  .option('--expires-at <unix>', 'Expiry unix timestamp', (v) => parseInt(v, 10))
  .action(async function (opts) {
    await run( () =>
      getClient().createApiKey({
        description: opts.description,
        actions: opts.actions.split(',').map((s: string) => s.trim()),
        collections: opts.collections.split(',').map((s: string) => s.trim()),
        expiresAt: opts.expiresAt,
      }),
    );
  });

keysCmd.command('get <id>').action(async function (id: string) {
  await run( () => getClient().getApiKey(parseInt(id, 10)));
});

keysCmd.command('delete <id>').action(async function (id: string) {
  await run( () => getClient().deleteApiKey(parseInt(id, 10)));
});

const aliasesCmd = program.command('aliases').description('Collection alias management');

aliasesCmd.command('list').action(async function () {
  await run( () => getClient().listAliases());
});

aliasesCmd
  .command('upsert <alias>')
  .requiredOption('--collection <name>', 'Target collection name')
  .action(async function (alias: string, opts) {
    await run( () => getClient().upsertAlias(alias, opts.collection));
  });

aliasesCmd.command('get <alias>').action(async function (alias: string) {
  await run( () => getClient().getAlias(alias));
});

aliasesCmd.command('delete <alias>').action(async function (alias: string) {
  await run( () => getClient().deleteAlias(alias));
});

const synonymsCmd = program.command('synonyms').description('Synonym management');

synonymsCmd.command('list <collection>').action(async function (collection: string) {
  await run( () => getClient().listSynonyms(collection));
});

synonymsCmd
  .command('upsert <collection> <synonymId>')
  .requiredOption('--synonyms <csv>', 'Comma-separated synonyms')
  .option('--root <word>', 'Root word for one-way synonym')
  .action(async function (collection: string, synonymId: string, opts) {
    await run( () =>
      getClient().upsertSynonym(
        collection,
        synonymId,
        opts.synonyms.split(',').map((s: string) => s.trim()),
        opts.root,
      ),
    );
  });

synonymsCmd.command('delete <collection> <synonymId>').action(async function (collection: string, synonymId: string) {
  await run( () => getClient().deleteSynonym(collection, synonymId));
});

const overridesCmd = program.command('overrides').description('Search override management');

overridesCmd.command('list <collection>').action(async function (collection: string) {
  await run( () => getClient().listOverrides(collection));
});

overridesCmd
  .command('upsert <collection> <overrideId>')
  .requiredOption('--rule <json>', 'Override rule JSON')
  .action(async function (collection: string, overrideId: string, opts) {
    await run( () => getClient().upsertOverride(collection, overrideId, parseJsonOption(opts.rule, 'rule')));
  });

program.parse();
