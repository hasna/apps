#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Yousign } from '../api';
import {
  getApiKey,
  setApiKey,
  getEnvironment,
  setEnvironment,
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
import type { YousignEnvironment } from '../types';

const CONNECTOR_NAME = 'connect-yousign';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Yousign connector CLI — electronic signature API v3')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-e, --environment <env>', 'API environment (production|sandbox)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.YOUSIGN_API_KEY = opts.apiKey;
    }
    if (opts.environment) {
      process.env.YOUSIGN_ENVIRONMENT = opts.environment;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Yousign {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set YOUSIGN_API_KEY.`);
    process.exit(1);
  }
  return new Yousign({ apiKey, environment: getEnvironment() });
}

function runAction(cmd: Command, fn: () => Promise<unknown>): void {
  fn()
    .then((result) => {
      if (result !== undefined) print(result, getFormat(cmd));
    })
    .catch((err) => {
      error(String(err));
      process.exit(1);
    });
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
  profiles.forEach((p) => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--environment <env>', 'production or sandbox')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      apiKey: opts.apiKey,
      environment: opts.environment as YousignEnvironment | undefined,
    });
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
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Environment: ${config.environment ?? 'production'}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd
  .command('set-environment <env>')
  .description('Set API environment (production|sandbox)')
  .action((env: string) => {
    if (env !== 'production' && env !== 'sandbox') {
      error('Environment must be production or sandbox');
      process.exit(1);
    }
    setEnvironment(env);
    success(`Environment set to ${env}`);
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Environment: ${getEnvironment()}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Signature request commands
const requestCmd = program.command('request').description('Signature request commands');

requestCmd
  .command('list')
  .description('List signature requests')
  .option('--limit <n>', 'Max results')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--status <status>', 'Filter by status')
  .option('--search <q>', 'Search query')
  .action((opts, cmd) => {
    runAction(cmd, async () => getClient().listSignatureRequests({
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      after: opts.after,
      status: opts.status,
      search: opts.search,
    }));
  });

requestCmd.command('get <id>').description('Get a signature request').action((id, _opts, cmd) => {
  runAction(cmd, () => getClient().getSignatureRequest(id));
});

requestCmd
  .command('create')
  .description('Create a signature request')
  .requiredOption('--name <name>', 'Request name')
  .requiredOption('--delivery-mode <mode>', 'email or none')
  .action((opts, cmd) => {
    runAction(cmd, () =>
      getClient().createSignatureRequest({
        name: opts.name,
        delivery_mode: opts.deliveryMode,
      }),
    );
  });

requestCmd
  .command('update <id>')
  .description('Update a signature request')
  .option('--name <name>', 'New name')
  .action((id, opts, cmd) => {
    runAction(cmd, () => getClient().updateSignatureRequest(id, { name: opts.name }));
  });

requestCmd.command('delete <id>').description('Delete a signature request').action((id, _opts, cmd) => {
  runAction(cmd, async () => {
    await getClient().deleteSignatureRequest(id);
    success(`Deleted signature request: ${id}`);
  });
});

requestCmd.command('activate <id>').description('Activate a signature request').action((id, _opts, cmd) => {
  runAction(cmd, () => getClient().activateSignatureRequest(id));
});

requestCmd
  .command('cancel <id>')
  .description('Cancel a signature request')
  .option('--reason <reason>', 'Cancellation reason')
  .action((id, opts, cmd) => {
    runAction(cmd, () => getClient().cancelSignatureRequest(id, opts.reason));
  });

requestCmd.command('audit-trails <id>').description('Get audit trails').action((id, _opts, cmd) => {
  runAction(cmd, () => getClient().getAuditTrails(id));
});

requestCmd
  .command('remind <id>')
  .description('Send reminders to signers')
  .option('--signer-ids <ids>', 'Comma-separated signer IDs')
  .action((id, opts, cmd) => {
    const signerIds = opts.signerIds ? opts.signerIds.split(',').map((s: string) => s.trim()) : undefined;
    runAction(cmd, () => getClient().sendReminder(id, signerIds));
  });

// Signer commands
const signerCmd = program.command('signer').description('Signer commands');

signerCmd.command('list <requestId>').description('List signers').action((requestId, _opts, cmd) => {
  runAction(cmd, () => getClient().listSigners(requestId));
});

signerCmd.command('get <requestId> <signerId>').description('Get a signer').action((requestId, signerId, _opts, cmd) => {
  runAction(cmd, () => getClient().getSigner(requestId, signerId));
});

signerCmd
  .command('add <requestId>')
  .description('Add a signer')
  .requiredOption('--first-name <name>', 'First name')
  .requiredOption('--last-name <name>', 'Last name')
  .requiredOption('--email <email>', 'Email')
  .requiredOption('--signature-level <level>', 'Signature level')
  .action((requestId, opts, cmd) => {
    runAction(cmd, () =>
      getClient().addSigner(requestId, {
        info: { first_name: opts.firstName, last_name: opts.lastName, email: opts.email },
        signature_level: opts.signatureLevel,
      }),
    );
  });

signerCmd
  .command('update <requestId> <signerId>')
  .description('Update a signer')
  .option('--email <email>', 'Email')
  .action((requestId, signerId, opts, cmd) => {
    runAction(cmd, () =>
      getClient().updateSigner(requestId, signerId, {
        info: opts.email ? { email: opts.email } : undefined,
      }),
    );
  });

signerCmd.command('delete <requestId> <signerId>').description('Delete a signer').action((requestId, signerId, _opts, cmd) => {
  runAction(cmd, async () => {
    await getClient().deleteSigner(requestId, signerId);
    success(`Deleted signer: ${signerId}`);
  });
});

// Document commands
const documentCmd = program.command('document').description('Document commands');

documentCmd.command('list <requestId>').description('List documents').action((requestId, _opts, cmd) => {
  runAction(cmd, () => getClient().listDocuments(requestId));
});

documentCmd.command('get <requestId> <documentId>').description('Get a document').action((requestId, documentId, _opts, cmd) => {
  runAction(cmd, () => getClient().getDocument(requestId, documentId));
});

documentCmd.command('delete <requestId> <documentId>').description('Delete a document').action((requestId, documentId, _opts, cmd) => {
  runAction(cmd, async () => {
    await getClient().deleteDocument(requestId, documentId);
    success(`Deleted document: ${documentId}`);
  });
});

documentCmd
  .command('download <requestId> <documentId>')
  .description('Download a document')
  .option('--version <version>', 'completed or current')
  .action((requestId, documentId, opts, cmd) => {
    runAction(cmd, () => getClient().downloadDocument(requestId, documentId, opts.version));
  });

// Field commands
const fieldCmd = program.command('field').description('Document field commands');

fieldCmd.command('list <requestId> <documentId>').description('List fields').action((requestId, documentId, _opts, cmd) => {
  runAction(cmd, () => getClient().listFields(requestId, documentId));
});

fieldCmd
  .command('add <requestId> <documentId>')
  .description('Add a field')
  .requiredOption('--type <type>', 'Field type')
  .requiredOption('--page <n>', 'Page number')
  .requiredOption('--x <n>', 'X position')
  .requiredOption('--y <n>', 'Y position')
  .option('--signer-id <id>', 'Signer ID')
  .action((requestId, documentId, opts, cmd) => {
    runAction(cmd, () =>
      getClient().addField(requestId, documentId, {
        type: opts.type,
        page: parseInt(opts.page, 10),
        x: parseInt(opts.x, 10),
        y: parseInt(opts.y, 10),
        signer_id: opts.signerId,
      }),
    );
  });

fieldCmd.command('delete <requestId> <documentId> <fieldId>').description('Delete a field').action((requestId, documentId, fieldId, _opts, cmd) => {
  runAction(cmd, async () => {
    await getClient().deleteField(requestId, documentId, fieldId);
    success(`Deleted field: ${fieldId}`);
  });
});

// Template commands
const templateCmd = program.command('template').description('Template commands');

templateCmd
  .command('list')
  .description('List templates')
  .option('--limit <n>', 'Max results')
  .option('--after <cursor>', 'Pagination cursor')
  .option('-q, --search <q>', 'Search query')
  .action((opts, cmd) => {
    runAction(cmd, () =>
      getClient().listTemplates({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        after: opts.after,
        q: opts.search,
      }),
    );
  });

templateCmd.command('get <id>').description('Get a template').action((id, _opts, cmd) => {
  runAction(cmd, () => getClient().getTemplate(id));
});

templateCmd.command('delete <id>').description('Delete a template').action((id, _opts, cmd) => {
  runAction(cmd, async () => {
    await getClient().deleteTemplate(id);
    success(`Deleted template: ${id}`);
  });
});

// Webhook commands
const webhookCmd = program.command('webhook').description('Webhook commands');

webhookCmd.command('list').description('List webhooks').action((_opts, cmd) => {
  runAction(cmd, () => getClient().listWebhooks());
});

webhookCmd
  .command('create')
  .description('Create a webhook')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--events <events>', 'Comma-separated subscribed events')
  .option('--description <desc>', 'Description')
  .action((opts, cmd) => {
    runAction(cmd, () =>
      getClient().createWebhook({
        url: opts.url,
        subscribed_events: opts.events.split(',').map((s: string) => s.trim()),
        description: opts.description,
      }),
    );
  });

webhookCmd.command('delete <id>').description('Delete a webhook').action((id, _opts, cmd) => {
  runAction(cmd, async () => {
    await getClient().deleteWebhook(id);
    success(`Deleted webhook: ${id}`);
  });
});

// User commands
const userCmd = program.command('user').description('User commands');

userCmd
  .command('list')
  .description('List users')
  .option('--limit <n>', 'Max results')
  .option('--after <cursor>', 'Pagination cursor')
  .action((opts, cmd) => {
    runAction(cmd, () =>
      getClient().listUsers({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        after: opts.after,
      }),
    );
  });

// Consent request commands
const consentCmd = program.command('consent').description('Consent request commands');

consentCmd
  .command('list')
  .description('List consent requests')
  .option('--limit <n>', 'Max results')
  .option('--after <cursor>', 'Pagination cursor')
  .action((opts, cmd) => {
    runAction(cmd, () =>
      getClient().listConsentRequests({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        after: opts.after,
      }),
    );
  });

program.parse();
