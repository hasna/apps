#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiToken,
  setApiToken,
  getAccountId,
  setAccountId,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-vwo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('VWO API connector CLI - A/B testing, feature flags, surveys, and conversion optimization')
  .version(VERSION)
  .option('-t, --api-token <token>', 'API token (overrides config)')
  .option('-a, --account-id <id>', 'Account ID (overrides config)')
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
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiToken) {
      process.env.VWO_API_TOKEN = opts.apiToken;
    }
    if (opts.accountId) {
      process.env.VWO_ACCOUNT_ID = opts.accountId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiToken = getApiToken();
  const accountId = getAccountId();

  if (!apiToken || !accountId) {
    error(`Credentials required. Run "${CONNECTOR_NAME} config set --api-token <token> --account-id <id>" or set VWO_API_TOKEN and VWO_ACCOUNT_ID.`);
    process.exit(1);
  }

  return new Connector({ apiToken, accountId });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
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
  .option('--api-token <token>', 'API token')
  .option('--account-id <id>', 'Account ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.apiToken, accountId: opts.accountId });
    if (opts.use) setCurrentProfile(name);
    success(`Created profile: ${name}`);
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Deleted profile: ${name}`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profile = name || getCurrentProfile();
  const config = loadProfile(profile);
  print({ profile, ...config, apiToken: config.apiToken ? '***' : undefined });
});

// Config commands
const configCmd = program.command('config').description('Manage API credentials');

configCmd
  .command('set')
  .option('--api-token <token>', 'API token')
  .option('--account-id <id>', 'Account ID')
  .action((opts) => {
    if (opts.apiToken) setApiToken(opts.apiToken);
    if (opts.accountId) setAccountId(opts.accountId);
    success('Configuration updated');
  });

configCmd.command('show').action(() => {
  print({
    profile: getCurrentProfile(),
    apiToken: getApiToken() ? '***' : undefined,
    accountId: getAccountId(),
    configDir: getConfigDir(),
  });
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Account
program.command('account').description('Account operations').action(async () => {
  const client = getClient();
  print(await client.account.me(), getFormat(program));
});

// Campaigns
const campaignsCmd = program.command('campaigns').description('Campaign operations');

campaignsCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--status <status>', 'Filter by status')
  .option('--type <type>', 'Filter by type')
  .option('-q, --q <query>', 'Search query')
  .action(async (opts, cmd) => {
    print(await getClient().campaigns.list(opts), getFormat(cmd));
  });

campaignsCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().campaigns.get(id), getFormat(cmd));
});

campaignsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .requiredOption('-t, --type <type>', 'Campaign type')
  .requiredOption('--variations <json>', 'Variations JSON array')
  .option('--goals <json>', 'Goals JSON array')
  .option('--description <desc>', 'Description')
  .action(async (opts, cmd) => {
    const variations = JSON.parse(opts.variations);
    const goals = opts.goals ? JSON.parse(opts.goals) : undefined;
    print(await getClient().campaigns.create({ name: opts.name, type: opts.type, variations, goals, description: opts.description }), getFormat(cmd));
  });

campaignsCmd
  .command('update <id>')
  .requiredOption('--data <json>', 'Update payload JSON')
  .action(async (id, opts, cmd) => {
    print(await getClient().campaigns.update(id, JSON.parse(opts.data)), getFormat(cmd));
  });

campaignsCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().campaigns.delete(id), getFormat(cmd));
});

campaignsCmd.command('run <id>').action(async (id, cmd) => {
  print(await getClient().campaigns.run(id), getFormat(cmd));
});

campaignsCmd.command('pause <id>').action(async (id, cmd) => {
  print(await getClient().campaigns.pause(id), getFormat(cmd));
});

campaignsCmd
  .command('report <id>')
  .option('--start-date <date>', 'Start date')
  .option('--end-date <date>', 'End date')
  .option('--metric <metric>', 'Metric')
  .option('--segment-id <id>', 'Segment ID')
  .option('--goal-id <id>', 'Goal ID')
  .action(async (id, opts, cmd) => {
    print(await getClient().campaigns.report(id, opts), getFormat(cmd));
  });

// Goals
const goalsCmd = program.command('goals').description('Goal operations');

goalsCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .action(async (opts, cmd) => {
    print(await getClient().goals.list(opts), getFormat(cmd));
  });

goalsCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().goals.get(id), getFormat(cmd));
});

goalsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Goal name')
  .requiredOption('-t, --type <type>', 'Goal type')
  .option('--rule <json>', 'Rule JSON')
  .action(async (opts, cmd) => {
    print(await getClient().goals.create({ name: opts.name, type: opts.type, rule: parseJsonOption(opts.rule, 'rule') }), getFormat(cmd));
  });

goalsCmd
  .command('update <id>')
  .requiredOption('--data <json>', 'Update payload JSON')
  .action(async (id, opts, cmd) => {
    print(await getClient().goals.update(id, JSON.parse(opts.data)), getFormat(cmd));
  });

goalsCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().goals.delete(id), getFormat(cmd));
});

// Segments
const segmentsCmd = program.command('segments').description('Segment operations');

segmentsCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .action(async (opts, cmd) => {
    print(await getClient().segments.list(opts), getFormat(cmd));
  });

segmentsCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().segments.get(id), getFormat(cmd));
});

segmentsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Segment name')
  .requiredOption('--conditions <json>', 'Conditions JSON')
  .option('--description <desc>', 'Description')
  .action(async (opts, cmd) => {
    print(await getClient().segments.create({ name: opts.name, conditions: JSON.parse(opts.conditions), description: opts.description }), getFormat(cmd));
  });

segmentsCmd
  .command('update <id>')
  .requiredOption('--data <json>', 'Update payload JSON')
  .action(async (id, opts, cmd) => {
    print(await getClient().segments.update(id, JSON.parse(opts.data)), getFormat(cmd));
  });

segmentsCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().segments.delete(id), getFormat(cmd));
});

// Feature flags
const flagsCmd = program.command('feature-flags').description('Feature flag operations');

flagsCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--status <status>', 'Filter by status')
  .action(async (opts, cmd) => {
    print(await getClient().featureFlags.list(opts), getFormat(cmd));
  });

flagsCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().featureFlags.get(id), getFormat(cmd));
});

flagsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Flag name')
  .requiredOption('-k, --key <key>', 'Flag key')
  .option('--description <desc>', 'Description')
  .action(async (opts, cmd) => {
    print(await getClient().featureFlags.create(opts), getFormat(cmd));
  });

flagsCmd
  .command('update <id>')
  .requiredOption('--data <json>', 'Update payload JSON')
  .action(async (id, opts, cmd) => {
    print(await getClient().featureFlags.update(id, JSON.parse(opts.data)), getFormat(cmd));
  });

flagsCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().featureFlags.delete(id), getFormat(cmd));
});

flagsCmd
  .command('toggle <id>')
  .requiredOption('--environment <key>', 'Environment key')
  .requiredOption('--enabled <bool>', 'Enabled (true/false)', (v) => v === 'true')
  .action(async (id, opts, cmd) => {
    print(await getClient().featureFlags.toggle(id, opts.environment, opts.enabled), getFormat(cmd));
  });

// Environments
const envCmd = program.command('environments').description('Environment operations');

envCmd.command('list').action(async (_opts, cmd) => {
  print(await getClient().environments.list(), getFormat(cmd));
});

envCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().environments.get(id), getFormat(cmd));
});

envCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Environment name')
  .requiredOption('-k, --key <key>', 'Environment key')
  .option('--description <desc>', 'Description')
  .action(async (opts, cmd) => {
    print(await getClient().environments.create(opts), getFormat(cmd));
  });

envCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().environments.delete(id), getFormat(cmd));
});

// Metrics
const metricsCmd = program.command('metrics').description('Metric operations');

metricsCmd.command('list').action(async (_opts, cmd) => {
  print(await getClient().metrics.list(), getFormat(cmd));
});

metricsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Metric name')
  .requiredOption('-t, --type <type>', 'Metric type')
  .option('--rule <json>', 'Rule JSON')
  .action(async (opts, cmd) => {
    print(await getClient().metrics.create({ name: opts.name, type: opts.type, rule: parseJsonOption(opts.rule, 'rule') }), getFormat(cmd));
  });

metricsCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().metrics.delete(id), getFormat(cmd));
});

// Surveys
const surveysCmd = program.command('surveys').description('Survey operations');

surveysCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--status <status>', 'Filter by status')
  .action(async (opts, cmd) => {
    print(await getClient().surveys.list(opts), getFormat(cmd));
  });

surveysCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().surveys.get(id), getFormat(cmd));
});

surveysCmd
  .command('responses <id>')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--start-date <date>', 'Start date')
  .option('--end-date <date>', 'End date')
  .action(async (id, opts, cmd) => {
    print(await getClient().surveys.responses(id, opts), getFormat(cmd));
  });

// Heatmaps
const heatmapsCmd = program.command('heatmaps').description('Heatmap operations');

heatmapsCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--status <status>', 'Filter by status')
  .action(async (opts, cmd) => {
    print(await getClient().heatmaps.list(opts), getFormat(cmd));
  });

heatmapsCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().heatmaps.get(id), getFormat(cmd));
});

// Session recordings
const recordingsCmd = program.command('session-recordings').description('Session recording operations');

recordingsCmd
  .command('list')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--start-date <date>', 'Start date')
  .option('--end-date <date>', 'End date')
  .option('--campaign-id <id>', 'Campaign ID')
  .action(async (opts, cmd) => {
    print(await getClient().sessionRecordings.list(opts), getFormat(cmd));
  });

recordingsCmd.command('get <id>').action(async (id, cmd) => {
  print(await getClient().sessionRecordings.get(id), getFormat(cmd));
});

// Webhooks
const webhooksCmd = program.command('webhooks').description('Webhook operations');

webhooksCmd.command('list').action(async (_opts, cmd) => {
  print(await getClient().webhooks.list(), getFormat(cmd));
});

webhooksCmd
  .command('create')
  .requiredOption('-u, --url <url>', 'Webhook URL')
  .requiredOption('--events <json>', 'Event types JSON array')
  .option('--secret <secret>', 'Webhook secret')
  .option('--active', 'Mark as active')
  .action(async (opts, cmd) => {
    print(await getClient().webhooks.create({ url: opts.url, eventTypes: JSON.parse(opts.events), secret: opts.secret, active: opts.active }), getFormat(cmd));
  });

webhooksCmd
  .command('update <id>')
  .requiredOption('--data <json>', 'Update payload JSON')
  .action(async (id, opts, cmd) => {
    print(await getClient().webhooks.update(id, JSON.parse(opts.data)), getFormat(cmd));
  });

webhooksCmd.command('delete <id>').action(async (id, cmd) => {
  print(await getClient().webhooks.delete(id), getFormat(cmd));
});

// Audit log
program
  .command('audit-log')
  .description('List audit log entries')
  .option('-l, --limit <n>', 'Limit', parseInt)
  .option('-o, --offset <n>', 'Offset', parseInt)
  .option('--user <user>', 'Filter by user')
  .option('--action <action>', 'Filter by action')
  .option('--entity <entity>', 'Filter by entity')
  .option('--from <date>', 'From date')
  .option('--to <date>', 'To date')
  .action(async (opts, cmd) => {
    print(await getClient().auditLog.list(opts), getFormat(cmd));
  });

// Users
const usersCmd = program.command('users').description('User operations');

usersCmd.command('list').action(async (_opts, cmd) => {
  print(await getClient().users.list(), getFormat(cmd));
});

usersCmd
  .command('invite')
  .requiredOption('-e, --email <email>', 'User email')
  .requiredOption('-r, --role <role>', 'User role')
  .action(async (opts, cmd) => {
    print(await getClient().users.invite({ email: opts.email, role: opts.role }), getFormat(cmd));
  });

usersCmd.command('remove <id>').action(async (id, cmd) => {
  print(await getClient().users.remove(id), getFormat(cmd));
});

program.parse();
