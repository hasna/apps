#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Cloudflare, FilterParser } from '../api';
import type { DNSFilter, BulkProgress } from '../api/bulk';
import {
  getApiToken,
  setCredentials,
  setLegacyCredentials,
  setAccountId,
  getAccountId,
  clearConfig,
  isAuthenticated,
  getAuthType,
  loadConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const program = new Command();

program
  .name('connect-cloudflare')
  .description('Cloudflare API connector CLI - Manage DNS, Workers, Pages, KV, R2, and more')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-cloudflare profiles create ${opts.profile}"`);
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
function requireAuth(): Cloudflare {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-cloudflare config set-token <token>" first.');
    process.exit(1);
  }
  return Cloudflare.create();
}

// Helper to require account ID
function requireAccountId(cf: Cloudflare, providedAccountId?: string): string {
  const accountId = providedAccountId || cf.getAccountId();
  if (!accountId) {
    error('Account ID required. Use --account-id flag or run "connect-cloudflare config set-account <id>"');
    process.exit(1);
  }
  return accountId;
}

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <apiToken>')
  .description('Set Cloudflare API token (recommended)')
  .option('-a, --account-id <accountId>', 'Default account ID')
  .action((apiToken: string, opts) => {
    setCredentials(apiToken, opts.accountId);
    success('API token saved successfully');
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('set-key <apiKey> <email>')
  .description('Set Cloudflare API key + email (legacy auth)')
  .option('-a, --account-id <accountId>', 'Default account ID')
  .action((apiKey: string, email: string, opts) => {
    setLegacyCredentials(apiKey, email, opts.accountId);
    success('API key and email saved successfully');
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('set-account <accountId>')
  .description('Set default account ID')
  .action((accountId: string) => {
    setAccountId(accountId);
    success(`Default account ID set to: ${accountId}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    const authType = getAuthType();

    info(`Config directory: ${getConfigDir()}`);
    info(`Profile: ${getCurrentProfile()}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);

    if (authType === 'token') {
      const token = config.apiToken || '';
      info(`Auth type: API Token`);
      info(`Token: ${token.substring(0, 8)}...${token.substring(token.length - 4)}`);
    } else if (authType === 'key') {
      info(`Auth type: API Key + Email`);
      info(`Email: ${config.email}`);
      info(`API Key: ${config.apiKey?.substring(0, 6)}...`);
    } else {
      info(`Auth type: ${chalk.gray('not configured')}`);
    }

    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear all configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Profiles Commands
// ============================================
const profilesCmd = program
  .command('profiles')
  .description('Manage multiple Cloudflare profiles');

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
          info(`  ${chalk.green('->')} ${p} ${chalk.gray('(current)')}`);
        } else {
          info(`     ${p}`);
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
      info(`Switch to it with: connect-cloudflare profiles switch ${name}`);
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
        const authType = getAuthType();
        info(`Auth: ${authType === 'token' ? 'API Token' : 'API Key'}`);
      } else {
        warn('Profile not authenticated. Run "connect-cloudflare config set-token <token>"');
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
// Me Command (User info)
// ============================================
program
  .command('me')
  .description('Get information about the authenticated user')
  .action(async () => {
    try {
      const cf = requireAuth();
      const user = await cf.accounts.getUser();
      print(user, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Account management commands');

accountsCmd
  .command('list')
  .description('List all accounts')
  .action(async () => {
    try {
      const cf = requireAuth();
      const result = await cf.accounts.list();
      print(result.result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('get <accountId>')
  .description('Get account details')
  .action(async (accountId: string) => {
    try {
      const cf = requireAuth();
      const account = await cf.accounts.get(accountId);
      print(account, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('verify')
  .description('Verify current API token')
  .action(async () => {
    try {
      const cf = requireAuth();
      const result = await cf.accounts.verifyToken();
      success('Token is valid!');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Zones Commands
// ============================================
const zonesCmd = program
  .command('zones')
  .description('DNS zone management commands');

zonesCmd
  .command('list')
  .description('List all zones')
  .option('-n, --name <name>', 'Filter by zone name')
  .option('--page <page>', 'Page number', '1')
  .option('--per-page <perPage>', 'Items per page', '20')
  .action(async (opts) => {
    try {
      const cf = requireAuth();
      const result = await cf.zones.list({
        name: opts.name,
        page: parseInt(opts.page),
        per_page: parseInt(opts.perPage),
      });

      if (!result.result || result.result.length === 0) {
        info('No zones found');
        return;
      }

      const zones = result.result.map(z => ({
        id: z.id,
        name: z.name,
        status: z.status,
        plan: z.plan?.name || 'Free',
        nameservers: z.name_servers?.join(', ') || '',
      }));

      success(`Found ${zones.length} zone(s):`);
      print(zones, getFormat(zonesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

zonesCmd
  .command('get <zoneId>')
  .description('Get zone details')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const zone = await cf.zones.get(zoneId);
      print(zone, getFormat(zonesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

zonesCmd
  .command('create <name>')
  .description('Create a new zone')
  .requiredOption('-a, --account-id <accountId>', 'Account ID')
  .option('-t, --type <type>', 'Zone type (full, partial)', 'full')
  .action(async (name: string, opts) => {
    try {
      const cf = requireAuth();
      const zone = await cf.zones.create({
        name,
        account: { id: opts.accountId },
        type: opts.type,
      });
      success(`Zone "${name}" created!`);
      info(`Zone ID: ${zone.id}`);
      info(`Nameservers: ${zone.name_servers?.join(', ')}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

zonesCmd
  .command('delete <zoneId>')
  .description('Delete a zone')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      await cf.zones.delete(zoneId);
      success(`Zone ${zoneId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

zonesCmd
  .command('settings <zoneId>')
  .description('Get zone settings')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const settings = await cf.zones.getSettings(zoneId);
      print(settings, getFormat(zonesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

zonesCmd
  .command('pause <zoneId>')
  .description('Pause Cloudflare for a zone')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      await cf.zones.pause(zoneId);
      success(`Zone ${zoneId} paused`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

zonesCmd
  .command('unpause <zoneId>')
  .description('Unpause Cloudflare for a zone')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      await cf.zones.unpause(zoneId);
      success(`Zone ${zoneId} unpaused`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// DNS Commands
// ============================================
const dnsCmd = program
  .command('dns')
  .description('DNS record management commands');

dnsCmd
  .command('list <zoneId>')
  .description('List DNS records for a zone')
  .option('-t, --type <type>', 'Filter by record type (A, AAAA, CNAME, TXT, MX, etc.)')
  .option('-n, --name <name>', 'Filter by record name')
  .option('--page <page>', 'Page number', '1')
  .option('--per-page <perPage>', 'Items per page', '50')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const result = await cf.dns.list(zoneId, {
        type: opts.type,
        name: opts.name,
        page: parseInt(opts.page),
        per_page: parseInt(opts.perPage),
      });

      if (!result.result || result.result.length === 0) {
        info('No DNS records found');
        return;
      }

      const records = result.result.map(r => ({
        id: r.id.substring(0, 12) + '...',
        type: r.type,
        name: r.name,
        content: r.content.length > 40 ? r.content.substring(0, 40) + '...' : r.content,
        proxied: r.proxied ? 'Yes' : 'No',
        ttl: r.ttl === 1 ? 'Auto' : r.ttl,
      }));

      success(`Found ${records.length} record(s):`);
      print(records, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('get <zoneId> <recordId>')
  .description('Get a DNS record')
  .action(async (zoneId: string, recordId: string) => {
    try {
      const cf = requireAuth();
      const record = await cf.dns.get(zoneId, recordId);
      print(record, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('create <zoneId>')
  .description('Create a DNS record')
  .requiredOption('-t, --type <type>', 'Record type (A, AAAA, CNAME, TXT, MX, etc.)')
  .requiredOption('-n, --name <name>', 'Record name')
  .requiredOption('-c, --content <content>', 'Record content')
  .option('--ttl <ttl>', 'TTL in seconds (1 for auto)', '1')
  .option('--proxied', 'Enable Cloudflare proxy', false)
  .option('--priority <priority>', 'Priority (for MX records)')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const record = await cf.dns.create(zoneId, {
        type: opts.type.toUpperCase(),
        name: opts.name,
        content: opts.content,
        ttl: parseInt(opts.ttl),
        proxied: opts.proxied,
        priority: opts.priority ? parseInt(opts.priority) : undefined,
      });
      success(`DNS record created!`);
      info(`Record ID: ${record.id}`);
      print(record, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('update <zoneId> <recordId>')
  .description('Update a DNS record')
  .requiredOption('-t, --type <type>', 'Record type')
  .requiredOption('-n, --name <name>', 'Record name')
  .requiredOption('-c, --content <content>', 'Record content')
  .option('--ttl <ttl>', 'TTL in seconds (1 for auto)', '1')
  .option('--proxied', 'Enable Cloudflare proxy', false)
  .action(async (zoneId: string, recordId: string, opts) => {
    try {
      const cf = requireAuth();
      const record = await cf.dns.update(zoneId, recordId, {
        type: opts.type.toUpperCase(),
        name: opts.name,
        content: opts.content,
        ttl: parseInt(opts.ttl),
        proxied: opts.proxied,
      });
      success(`DNS record updated!`);
      print(record, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('delete <zoneId> <recordId>')
  .description('Delete a DNS record')
  .action(async (zoneId: string, recordId: string) => {
    try {
      const cf = requireAuth();
      await cf.dns.delete(zoneId, recordId);
      success(`DNS record ${recordId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('export <zoneId>')
  .description('Export DNS records in BIND format')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const bindFile = await cf.dns.export(zoneId);
      console.log(bindFile);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Workers Commands
// ============================================
const workersCmd = program
  .command('workers')
  .description('Workers management commands');

workersCmd
  .command('list')
  .description('List all Workers')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.workers.list(accountId);

      if (!result.result || result.result.length === 0) {
        info('No Workers found');
        return;
      }

      success(`Found ${result.result.length} Worker(s):`);
      print(result.result, getFormat(workersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workersCmd
  .command('get <scriptName>')
  .description('Get Worker details')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (scriptName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const worker = await cf.workers.get(accountId, scriptName);
      print(worker, getFormat(workersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workersCmd
  .command('download <scriptName>')
  .description('Download Worker script content')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (scriptName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const script = await cf.workers.getContent(accountId, scriptName);
      console.log(script);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workersCmd
  .command('deploy <scriptName> <scriptPath>')
  .description('Deploy a Worker script')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('--compat-date <date>', 'Compatibility date (YYYY-MM-DD)')
  .action(async (scriptName: string, scriptPath: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);

      // Read script file
      const script = await Bun.file(scriptPath).text();

      const worker = await cf.workers.create(accountId, scriptName, {
        script,
        compatibility_date: opts.compatDate,
      });

      success(`Worker "${scriptName}" deployed!`);
      print(worker, getFormat(workersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workersCmd
  .command('delete <scriptName>')
  .description('Delete a Worker')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (scriptName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.workers.delete(accountId, scriptName);
      success(`Worker "${scriptName}" deleted`);
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
  .description('Pages project management commands');

pagesCmd
  .command('list')
  .description('List all Pages projects')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.pages.list(accountId);

      if (!result.result || result.result.length === 0) {
        info('No Pages projects found');
        return;
      }

      const projects = result.result.map(p => ({
        name: p.name,
        subdomain: p.subdomain,
        domains: p.domains?.join(', ') || '',
        productionBranch: p.production_branch,
        created: new Date(p.created_on).toLocaleDateString(),
      }));

      success(`Found ${projects.length} project(s):`);
      print(projects, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('get <projectName>')
  .description('Get Pages project details')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (projectName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const project = await cf.pages.get(accountId, projectName);
      print(project, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('create <projectName>')
  .description('Create a Pages project')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('-b, --branch <branch>', 'Production branch', 'main')
  .action(async (projectName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const project = await cf.pages.create(accountId, {
        name: projectName,
        production_branch: opts.branch,
      });
      success(`Pages project "${projectName}" created!`);
      info(`Subdomain: ${project.subdomain}.pages.dev`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('delete <projectName>')
  .description('Delete a Pages project')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (projectName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.pages.delete(accountId, projectName);
      success(`Pages project "${projectName}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('deployments <projectName>')
  .description('List deployments for a Pages project')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('-e, --env <env>', 'Environment (production, preview)')
  .action(async (projectName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.pages.listDeployments(accountId, projectName, {
        env: opts.env,
      });

      if (!result.result || result.result.length === 0) {
        info('No deployments found');
        return;
      }

      const deployments = result.result.map(d => ({
        id: d.short_id,
        environment: d.environment,
        url: d.url,
        status: d.latest_stage?.status || 'unknown',
        created: new Date(d.created_on).toLocaleString(),
      }));

      success(`Found ${deployments.length} deployment(s):`);
      print(deployments, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// KV Commands
// ============================================
const kvCmd = program
  .command('kv')
  .description('Workers KV management commands');

kvCmd
  .command('namespaces')
  .description('List KV namespaces')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.kv.listNamespaces(accountId);

      if (!result.result || result.result.length === 0) {
        info('No KV namespaces found');
        return;
      }

      success(`Found ${result.result.length} namespace(s):`);
      print(result.result, getFormat(kvCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kvCmd
  .command('create-namespace <title>')
  .description('Create a KV namespace')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (title: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const ns = await cf.kv.createNamespace(accountId, { title });
      success(`KV namespace "${title}" created!`);
      info(`Namespace ID: ${ns.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kvCmd
  .command('delete-namespace <namespaceId>')
  .description('Delete a KV namespace')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (namespaceId: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.kv.deleteNamespace(accountId, namespaceId);
      success(`KV namespace ${namespaceId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kvCmd
  .command('keys <namespaceId>')
  .description('List keys in a KV namespace')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('--prefix <prefix>', 'Key prefix filter')
  .option('--limit <limit>', 'Maximum keys to return', '100')
  .action(async (namespaceId: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.kv.listKeys(accountId, namespaceId, {
        prefix: opts.prefix,
        limit: parseInt(opts.limit),
      });

      if (!result.result || result.result.length === 0) {
        info('No keys found');
        return;
      }

      success(`Found ${result.result.length} key(s):`);
      print(result.result, getFormat(kvCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kvCmd
  .command('get <namespaceId> <key>')
  .description('Get a value from KV')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (namespaceId: string, key: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const value = await cf.kv.get(accountId, namespaceId, key);
      console.log(value);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kvCmd
  .command('put <namespaceId> <key> <value>')
  .description('Put a value to KV')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('--ttl <seconds>', 'TTL in seconds')
  .action(async (namespaceId: string, key: string, value: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.kv.put(accountId, namespaceId, {
        key,
        value,
        expiration_ttl: opts.ttl ? parseInt(opts.ttl) : undefined,
      });
      success(`Key "${key}" saved`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kvCmd
  .command('delete <namespaceId> <key>')
  .description('Delete a key from KV')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (namespaceId: string, key: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.kv.delete(accountId, namespaceId, key);
      success(`Key "${key}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// R2 Commands
// ============================================
const r2Cmd = program
  .command('r2')
  .description('R2 storage management commands');

r2Cmd
  .command('buckets')
  .description('List R2 buckets')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.r2.listBuckets(accountId);

      if (!result.result?.buckets || result.result.buckets.length === 0) {
        info('No R2 buckets found');
        return;
      }

      success(`Found ${result.result.buckets.length} bucket(s):`);
      print(result.result.buckets, getFormat(r2Cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

r2Cmd
  .command('create-bucket <name>')
  .description('Create an R2 bucket')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('-l, --location <hint>', 'Location hint (e.g., wnam, enam, weur, eeur, apac)')
  .action(async (name: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const bucket = await cf.r2.createBucket(accountId, {
        name,
        locationHint: opts.location,
      });
      success(`R2 bucket "${name}" created!`);
      print(bucket, getFormat(r2Cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

r2Cmd
  .command('delete-bucket <name>')
  .description('Delete an R2 bucket')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (name: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.r2.deleteBucket(accountId, name);
      success(`R2 bucket "${name}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

r2Cmd
  .command('objects <bucketName>')
  .description('List objects in an R2 bucket')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('--prefix <prefix>', 'Object prefix filter')
  .option('--limit <limit>', 'Maximum objects to return', '100')
  .action(async (bucketName: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      const result = await cf.r2.listObjects(accountId, bucketName, {
        prefix: opts.prefix,
        limit: parseInt(opts.limit),
      });

      if (!result.objects || result.objects.length === 0) {
        info('No objects found');
        return;
      }

      const objects = result.objects.map(o => ({
        key: o.key,
        size: `${Math.round(o.size / 1024)} KB`,
        uploaded: new Date(o.uploaded).toLocaleString(),
      }));

      success(`Found ${objects.length} object(s):`);
      print(objects, getFormat(r2Cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

r2Cmd
  .command('delete-object <bucketName> <key>')
  .description('Delete an object from R2')
  .option('-a, --account-id <accountId>', 'Account ID')
  .action(async (bucketName: string, key: string, opts) => {
    try {
      const cf = requireAuth();
      const accountId = requireAccountId(cf, opts.accountId);
      await cf.r2.deleteObject(accountId, bucketName, key);
      success(`Object "${key}" deleted from bucket "${bucketName}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Cache Commands
// ============================================
const cacheCmd = program
  .command('cache')
  .description('Cache management commands');

cacheCmd
  .command('purge-all <zoneId>')
  .description('Purge all cached content for a zone')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const result = await cf.cache.purgeAll(zoneId);
      success('Cache purged successfully!');
      info(`Purge ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cacheCmd
  .command('purge <zoneId>')
  .description('Purge specific URLs from cache')
  .requiredOption('-u, --urls <urls>', 'Comma-separated list of URLs to purge')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const urls = opts.urls.split(',').map((u: string) => u.trim());
      const result = await cf.cache.purgeByUrls(zoneId, urls);
      success(`Purged ${urls.length} URL(s) from cache!`);
      info(`Purge ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cacheCmd
  .command('purge-tags <zoneId>')
  .description('Purge cache by tags')
  .requiredOption('-t, --tags <tags>', 'Comma-separated list of cache tags')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const tags = opts.tags.split(',').map((t: string) => t.trim());
      const result = await cf.cache.purgeByTags(zoneId, tags);
      success(`Purged cache for ${tags.length} tag(s)!`);
      info(`Purge ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Analytics Commands
// ============================================
const analyticsCmd = program
  .command('analytics')
  .description('Analytics commands');

analyticsCmd
  .command('dashboard <zoneId>')
  .description('Get zone analytics dashboard')
  .option('--since <date>', 'Start date (ISO format or relative like -7d)')
  .option('--until <date>', 'End date (ISO format or relative)')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const analytics = await cf.analytics.getDashboard(zoneId, {
        since: opts.since,
        until: opts.until,
      });
      print(analytics, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Firewall Commands
// ============================================
const firewallCmd = program
  .command('firewall')
  .description('Firewall management commands');

firewallCmd
  .command('rules <zoneId>')
  .description('List firewall rules')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const result = await cf.firewall.listRules(zoneId);

      if (!result.result || result.result.length === 0) {
        info('No firewall rules found');
        return;
      }

      const rules = result.result.map(r => ({
        id: r.id.substring(0, 12) + '...',
        action: r.action,
        description: r.description || '-',
        paused: r.paused ? 'Yes' : 'No',
        expression: r.filter.expression.substring(0, 40) + '...',
      }));

      success(`Found ${rules.length} rule(s):`);
      print(rules, getFormat(firewallCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

firewallCmd
  .command('create-rule <zoneId>')
  .description('Create a firewall rule')
  .requiredOption('-e, --expression <expression>', 'Filter expression')
  .requiredOption('-a, --action <action>', 'Action (block, challenge, allow, log, bypass)')
  .option('-d, --description <description>', 'Rule description')
  .option('--paused', 'Create rule in paused state', false)
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const rule = await cf.firewall.createRule(zoneId, {
        filter: {
          expression: opts.expression,
          description: opts.description,
        },
        action: opts.action,
        description: opts.description,
        paused: opts.paused,
      });
      success('Firewall rule created!');
      info(`Rule ID: ${rule.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

firewallCmd
  .command('delete-rule <zoneId> <ruleId>')
  .description('Delete a firewall rule')
  .action(async (zoneId: string, ruleId: string) => {
    try {
      const cf = requireAuth();
      await cf.firewall.deleteRule(zoneId, ruleId);
      success(`Firewall rule ${ruleId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// SSL Commands
// ============================================
const sslCmd = program
  .command('ssl')
  .description('SSL/TLS management commands');

sslCmd
  .command('status <zoneId>')
  .description('Get SSL/TLS mode')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const mode = await cf.ssl.getMode(zoneId);
      print(mode, getFormat(sslCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sslCmd
  .command('set-mode <zoneId> <mode>')
  .description('Set SSL/TLS mode (off, flexible, full, strict)')
  .action(async (zoneId: string, mode: string) => {
    try {
      const cf = requireAuth();
      await cf.ssl.setMode(zoneId, mode as 'off' | 'flexible' | 'full' | 'strict');
      success(`SSL mode set to: ${mode}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sslCmd
  .command('certificates <zoneId>')
  .description('List custom SSL certificates')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const result = await cf.ssl.listCertificates(zoneId);

      if (!result.result || result.result.length === 0) {
        info('No custom SSL certificates found');
        return;
      }

      success(`Found ${result.result.length} certificate(s):`);
      print(result.result, getFormat(sslCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sslCmd
  .command('verification <zoneId>')
  .description('Get SSL verification status')
  .action(async (zoneId: string) => {
    try {
      const cf = requireAuth();
      const verification = await cf.ssl.getVerification(zoneId);
      print(verification, getFormat(sslCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Bulk Operations Commands
// ============================================
const bulkCmd = program
  .command('bulk')
  .description('Bulk operations for DNS records, firewall rules, and workers');

// Progress bar helper
function formatProgressBar(progress: BulkProgress): string {
  const percent = Math.round((progress.completed / progress.total) * 100);
  const barWidth = 30;
  const filled = Math.round((percent / 100) * barWidth);
  const bar = '='.repeat(filled) + '-'.repeat(barWidth - filled);
  return `[${bar}] ${percent}% (${progress.succeeded}/${progress.total})`;
}

bulkCmd
  .command('preview <zoneId>')
  .description('Preview DNS records matching a filter')
  .option('-f, --filter <filter>', 'Filter expression (e.g., "type=A", "name=*.example.com")')
  .option('--limit <limit>', 'Maximum records to show', '50')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const filter: DNSFilter = opts.filter ? FilterParser.parse(opts.filter) : {};

      info(`Searching for DNS records${opts.filter ? ` matching: ${opts.filter}` : ''}...`);

      const records = await cf.bulk.previewDNSRecords(zoneId, filter);
      const limit = parseInt(opts.limit);
      const displayRecords = records.slice(0, limit);

      if (records.length === 0) {
        info('No records match the filter');
        return;
      }

      const formatted = displayRecords.map(r => ({
        id: r.id.substring(0, 12) + '...',
        type: r.type,
        name: r.name,
        content: r.content.length > 40 ? r.content.substring(0, 40) + '...' : r.content,
        proxied: r.proxied ? 'Yes' : 'No',
        ttl: r.ttl === 1 ? 'Auto' : r.ttl,
      }));

      success(`Found ${records.length} record(s)${records.length > limit ? ` (showing first ${limit})` : ''}:`);
      print(formatted, getFormat(bulkCmd));

      if (records.length > limit) {
        info(`... and ${records.length - limit} more records`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('dns-export <zoneId>')
  .description('Export all DNS records to a file')
  .option('-o, --output <file>', 'Output file path')
  .option('--format <format>', 'Export format (json, csv, bind)', 'json')
  .option('-f, --filter <filter>', 'Filter expression to export only matching records')
  .option('--include-ids', 'Include record IDs in export', false)
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const filter: DNSFilter = opts.filter ? FilterParser.parse(opts.filter) : {};

      info(`Exporting DNS records${opts.filter ? ` matching: ${opts.filter}` : ''}...`);

      const output = await cf.bulk.exportDNS(zoneId, {
        format: opts.format,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        includeIds: opts.includeIds,
      });

      if (opts.output) {
        await Bun.write(opts.output, output);
        success(`Exported to ${opts.output}`);

        // Count records for summary
        const lines = output.split('\n').length;
        info(`Format: ${opts.format}`);
        if (opts.format === 'json') {
          const records = JSON.parse(output);
          info(`Records: ${records.length}`);
        } else if (opts.format === 'csv') {
          info(`Records: ${lines - 1}`);  // Subtract header row
        }
      } else {
        console.log(output);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('dns-import <zoneId> <file>')
  .description('Import DNS records from a JSON or CSV file')
  .option('--format <format>', 'File format (json, csv)', 'json')
  .option('--dry-run', 'Preview changes without applying them', false)
  .option('--continue-on-error', 'Continue importing even if some records fail', false)
  .option('--concurrency <n>', 'Number of concurrent operations', '5')
  .option('--delay <ms>', 'Delay between batches in milliseconds', '0')
  .action(async (zoneId: string, file: string, opts) => {
    try {
      const cf = requireAuth();

      // Read the file
      const fileContent = await Bun.file(file).text();

      info(`Importing DNS records from ${file}...`);
      if (opts.dryRun) {
        warn('DRY RUN - No changes will be made');
      }

      const result = await cf.bulk.importDNS(zoneId, fileContent, opts.format, {
        dryRun: opts.dryRun,
        continueOnError: opts.continueOnError,
        concurrency: parseInt(opts.concurrency),
        delayMs: parseInt(opts.delay),
        onProgress: (progress) => {
          process.stdout.write(`\r${formatProgressBar(progress)}`);
        },
      });

      console.log('');  // New line after progress bar

      if (result.success) {
        success(`Successfully ${opts.dryRun ? 'would create' : 'created'} ${result.succeeded} record(s)`);
      } else {
        warn(`Completed with errors: ${result.succeeded} succeeded, ${result.failed} failed`);
      }

      if (result.errors.length > 0) {
        error(`Errors:`);
        for (const err of result.errors.slice(0, 10)) {
          console.log(`  - ${err.item}: ${err.error}`);
        }
        if (result.errors.length > 10) {
          info(`  ... and ${result.errors.length - 10} more errors`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('dns-update <zoneId>')
  .description('Update multiple DNS records matching a filter')
  .requiredOption('-f, --filter <filter>', 'Filter expression (e.g., "type=A", "name=*.example.com")')
  .option('--ttl <ttl>', 'New TTL value')
  .option('--proxied <value>', 'Set proxied status (true/false)')
  .option('--content <content>', 'New content value')
  .option('--comment <comment>', 'New comment')
  .option('--dry-run', 'Preview changes without applying them', false)
  .option('--continue-on-error', 'Continue even if some updates fail', false)
  .option('--concurrency <n>', 'Number of concurrent operations', '5')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const filter = FilterParser.parse(opts.filter);

      // Build updates object
      const updates: Record<string, unknown> = {};
      if (opts.ttl) updates.ttl = parseInt(opts.ttl);
      if (opts.proxied !== undefined) updates.proxied = opts.proxied === 'true';
      if (opts.content) updates.content = opts.content;
      if (opts.comment) updates.comment = opts.comment;

      if (Object.keys(updates).length === 0) {
        error('No update options provided. Use --ttl, --proxied, --content, or --comment');
        process.exit(1);
      }

      info(`Updating DNS records matching: ${opts.filter}`);
      info(`Updates: ${JSON.stringify(updates)}`);
      if (opts.dryRun) {
        warn('DRY RUN - No changes will be made');
      }

      // First preview what will be updated
      const preview = await cf.bulk.previewDNSRecords(zoneId, filter);
      if (preview.length === 0) {
        info('No records match the filter');
        return;
      }

      info(`Found ${preview.length} record(s) to update`);

      const result = await cf.bulk.bulkUpdateDNS(zoneId, filter, updates, {
        dryRun: opts.dryRun,
        continueOnError: opts.continueOnError,
        concurrency: parseInt(opts.concurrency),
        onProgress: (progress) => {
          process.stdout.write(`\r${formatProgressBar(progress)}`);
        },
      });

      console.log('');

      if (result.success) {
        success(`Successfully ${opts.dryRun ? 'would update' : 'updated'} ${result.succeeded} record(s)`);
      } else {
        warn(`Completed with errors: ${result.succeeded} succeeded, ${result.failed} failed`);
      }

      if (result.errors.length > 0) {
        error(`Errors:`);
        for (const err of result.errors.slice(0, 10)) {
          console.log(`  - ${err.item}: ${err.error}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('dns-delete <zoneId>')
  .description('Delete multiple DNS records matching a filter')
  .requiredOption('-f, --filter <filter>', 'Filter expression (e.g., "type=A", "name=*.example.com")')
  .option('--dry-run', 'Preview deletions without applying them', false)
  .option('--continue-on-error', 'Continue even if some deletions fail', false)
  .option('--concurrency <n>', 'Number of concurrent operations', '5')
  .option('--yes', 'Skip confirmation prompt', false)
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();
      const filter = FilterParser.parse(opts.filter);

      info(`Finding DNS records matching: ${opts.filter}`);

      // Preview what will be deleted
      const preview = await cf.bulk.previewDNSRecords(zoneId, filter);
      if (preview.length === 0) {
        info('No records match the filter');
        return;
      }

      warn(`Found ${preview.length} record(s) to delete:`);
      const displayRecords = preview.slice(0, 10).map(r => ({
        type: r.type,
        name: r.name,
        content: r.content.length > 30 ? r.content.substring(0, 30) + '...' : r.content,
      }));
      print(displayRecords, 'pretty');

      if (preview.length > 10) {
        info(`... and ${preview.length - 10} more records`);
      }

      if (opts.dryRun) {
        warn('DRY RUN - No changes will be made');
      } else if (!opts.yes) {
        warn(`This will DELETE ${preview.length} record(s). Use --yes to confirm.`);
        process.exit(1);
      }

      const result = await cf.bulk.bulkDeleteDNS(zoneId, filter, {
        dryRun: opts.dryRun,
        continueOnError: opts.continueOnError,
        concurrency: parseInt(opts.concurrency),
        onProgress: (progress) => {
          process.stdout.write(`\r${formatProgressBar(progress)}`);
        },
      });

      console.log('');

      if (result.success) {
        success(`Successfully ${opts.dryRun ? 'would delete' : 'deleted'} ${result.succeeded} record(s)`);
      } else {
        warn(`Completed with errors: ${result.succeeded} succeeded, ${result.failed} failed`);
      }

      if (result.errors.length > 0) {
        error(`Errors:`);
        for (const err of result.errors.slice(0, 10)) {
          console.log(`  - ${err.item}: ${err.error}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('dns-create <zoneId>')
  .description('Bulk create DNS records from inline JSON')
  .requiredOption('-r, --records <json>', 'JSON array of records to create')
  .option('--dry-run', 'Preview changes without applying them', false)
  .option('--continue-on-error', 'Continue even if some creates fail', false)
  .option('--concurrency <n>', 'Number of concurrent operations', '5')
  .action(async (zoneId: string, opts) => {
    try {
      const cf = requireAuth();

      const records = JSON.parse(opts.records);
      if (!Array.isArray(records)) {
        error('Records must be a JSON array');
        process.exit(1);
      }

      info(`Creating ${records.length} DNS record(s)...`);
      if (opts.dryRun) {
        warn('DRY RUN - No changes will be made');
      }

      const result = await cf.bulk.bulkCreateDNS(zoneId, records, {
        dryRun: opts.dryRun,
        continueOnError: opts.continueOnError,
        concurrency: parseInt(opts.concurrency),
        onProgress: (progress) => {
          process.stdout.write(`\r${formatProgressBar(progress)}`);
        },
      });

      console.log('');

      if (result.success) {
        success(`Successfully ${opts.dryRun ? 'would create' : 'created'} ${result.succeeded} record(s)`);
      } else {
        warn(`Completed with errors: ${result.succeeded} succeeded, ${result.failed} failed`);
      }

      if (result.errors.length > 0) {
        error(`Errors:`);
        for (const err of result.errors) {
          console.log(`  - ${err.item}: ${err.error}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
