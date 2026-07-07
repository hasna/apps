#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Vault } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getBaseUrl,
  getConfigDir,
  getCurrentProfile,
  getNamespace,
  getToken,
  listProfiles,
  loadProfile,
  loadVaultConfig,
  profileExists,
  setBaseUrl,
  setCurrentProfile,
  setNamespace,
  setProfileOverride,
  setToken,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { debug, error, info, print, setVerboseMode, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-vault';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('HashiCorp Vault HTTP API connector CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setVerboseMode(true);
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }
  });

function getFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vault {
  return new Vault(loadVaultConfig());
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  for (const name of profiles) {
    const marker = name === current ? chalk.green(' (active)') : '';
    console.log(`  ${name}${marker}`);
  }
});

profileCmd.command('use <name>').description('Switch active profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a profile')
  .option('--base-url <url>', 'Vault base URL')
  .option('--token <token>', 'Vault token')
  .option('--namespace <namespace>', 'Vault namespace')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      baseUrl: opts.baseUrl,
      token: opts.token,
      namespace: opts.namespace,
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
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Base URL: ${config.baseUrl ?? chalk.gray('not set')}`);
  info(`Token: ${config.token ? `${config.token.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Namespace: ${config.namespace ?? chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage active profile configuration');

configCmd.command('set-base-url <url>').description('Set Vault base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-token <token>').description('Set Vault token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-namespace <namespace>').description('Set Vault namespace').action((namespace: string) => {
  setNamespace(namespace);
  success(`Namespace saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show active configuration').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Base URL: ${getBaseUrl() ?? chalk.gray('not set')}`);
  info(`Token: ${getToken() ? `${getToken()!.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Namespace: ${getNamespace() ?? chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear active profile configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const sysCmd = program.command('sys').description('System endpoints');

sysCmd.command('health').description('Check Vault health').action(async function () {
  await run(() => getClient().getHealth());
});

sysCmd.command('seal-status').description('Get seal status').action(async function () {
  await run(() => getClient().getSealStatus());
});

sysCmd
  .command('unseal')
  .description('Unseal Vault')
  .requiredOption('-k, --key <key>', 'Unseal key share')
  .option('--reset', 'Reset unseal progress')
  .action(async function (opts) {
    await run(() => getClient().unseal({ key: opts.key, reset: opts.reset }));
  });

sysCmd.command('seal').description('Seal Vault').action(async function () {
  await run(() => getClient().seal());
});

const tokenCmd = program.command('token').description('Token auth endpoints');

tokenCmd.command('lookup-self').description('Lookup the current token').action(async function () {
  await run(() => getClient().lookupSelfToken());
});

tokenCmd
  .command('create')
  .description('Create a token')
  .option('--policies <policies>', 'Comma-separated policies')
  .option('--ttl <ttl>', 'Token TTL')
  .option('--display-name <name>', 'Display name')
  .action(async function (opts) {
    await run(() =>
      getClient().createToken({
        policies: opts.policies ? String(opts.policies).split(',').map((p: string) => p.trim()) : undefined,
        ttl: opts.ttl,
        displayName: opts.displayName,
      }),
    );
  });

tokenCmd
  .command('revoke <token>')
  .description('Revoke a token')
  .option('--orphan', 'Revoke as orphan')
  .action(async function (token: string, opts) {
    await run(() => getClient().revokeToken({ token, orphan: opts.orphan }));
  });

tokenCmd
  .command('renew <token>')
  .description('Renew a token')
  .option('--increment <ttl>', 'Renewal increment')
  .action(async function (token: string, opts) {
    await run(() => getClient().renewToken({ token, increment: opts.increment }));
  });

const mountsCmd = program.command('mounts').description('Secret engine mounts');

mountsCmd.command('list').description('List mounts').action(async function () {
  await run(() => getClient().listMounts());
});

mountsCmd
  .command('enable <path>')
  .description('Enable a mount')
  .requiredOption('-t, --type <type>', 'Engine type')
  .option('--description <description>', 'Description')
  .action(async function (path: string, opts) {
    await run(() => getClient().enableMount({ path, type: opts.type, description: opts.description }));
  });

mountsCmd.command('disable <path>').description('Disable a mount').action(async function (path: string) {
  await run(() => getClient().disableMount({ path }));
});

const authCmd = program.command('auth').description('Auth method mounts');

authCmd.command('list').description('List auth methods').action(async function () {
  await run(() => getClient().listAuthMethods());
});

authCmd
  .command('enable <path>')
  .description('Enable an auth method')
  .requiredOption('-t, --type <type>', 'Auth method type')
  .action(async function (path: string, opts) {
    await run(() => getClient().enableAuthMethod({ path, type: opts.type }));
  });

authCmd.command('disable <path>').description('Disable an auth method').action(async function (path: string) {
  await run(() => getClient().disableAuthMethod({ path }));
});

const policiesCmd = program.command('policies').description('ACL policies');

policiesCmd.command('list').description('List ACL policies').action(async function () {
  await run(() => getClient().listPolicies());
});

policiesCmd.command('get <name>').description('Get a policy').action(async function (name: string) {
  await run(() => getClient().getPolicy({ name }));
});

policiesCmd
  .command('create <name>')
  .description('Create or update a policy')
  .requiredOption('-p, --policy <policy>', 'HCL policy document')
  .action(async function (name: string, opts) {
    await run(() => getClient().createPolicy({ name, policy: opts.policy }));
  });

policiesCmd.command('delete <name>').description('Delete a policy').action(async function (name: string) {
  await run(() => getClient().deletePolicy({ name }));
});

const kvCmd = program.command('kv').description('KV secrets engine (v2)');

kvCmd
  .command('read <path>')
  .description('Read a secret')
  .option('-m, --mount <mount>', 'KV mount', 'secret')
  .option('--version <version>', 'Secret version', (v) => parseInt(v, 10))
  .action(async function (path: string, opts) {
    await run(() => getClient().readKvSecret({ mount: opts.mount, path, version: opts.version }));
  });

kvCmd
  .command('write <path>')
  .description('Write a secret')
  .requiredOption('-d, --data <json>', 'Secret data JSON object')
  .option('-m, --mount <mount>', 'KV mount', 'secret')
  .option('--cas <cas>', 'Check-and-set version', (v) => parseInt(v, 10))
  .action(async function (path: string, opts) {
    await run(() =>
      getClient().writeKvSecret({
        mount: opts.mount,
        path,
        data: JSON.parse(opts.data),
        cas: opts.cas,
      }),
    );
  });

kvCmd
  .command('delete <path>')
  .description('Delete a secret')
  .option('-m, --mount <mount>', 'KV mount', 'secret')
  .action(async function (path: string, opts) {
    await run(() => getClient().deleteKvSecret({ mount: opts.mount, path }));
  });

kvCmd
  .command('list <path>')
  .description('List secrets under a path')
  .option('-m, --mount <mount>', 'KV mount', 'secret')
  .action(async function (path: string, opts) {
    await run(() => getClient().listKvSecrets({ mount: opts.mount, path }));
  });

kvCmd
  .command('metadata <path>')
  .description('Read secret metadata')
  .option('-m, --mount <mount>', 'KV mount', 'secret')
  .action(async function (path: string, opts) {
    await run(() => getClient().getKvMetadata({ mount: opts.mount, path }));
  });

const transitCmd = program.command('transit').description('Transit secrets engine');

transitCmd
  .command('encrypt <key>')
  .description('Encrypt plaintext')
  .requiredOption('-p, --plaintext <plaintext>', 'Base64-encoded plaintext')
  .option('-m, --mount <mount>', 'Transit mount', 'transit')
  .action(async function (key: string, opts) {
    await run(() => getClient().encrypt({ mount: opts.mount, key, plaintext: opts.plaintext }));
  });

transitCmd
  .command('decrypt <key>')
  .description('Decrypt ciphertext')
  .requiredOption('-c, --ciphertext <ciphertext>', 'Ciphertext')
  .option('-m, --mount <mount>', 'Transit mount', 'transit')
  .action(async function (key: string, opts) {
    await run(() => getClient().decrypt({ mount: opts.mount, key, ciphertext: opts.ciphertext }));
  });

const leasesCmd = program.command('leases').description('Lease management');

leasesCmd.command('list <prefix>').description('List leases by prefix').action(async function (prefix: string) {
  await run(() => getClient().listLeases({ prefix }));
});

leasesCmd.command('revoke <leaseId>').description('Revoke a lease').action(async function (leaseId: string) {
  await run(() => getClient().revokeLease({ leaseId }));
});

const identityCmd = program.command('identity').description('Identity entities');

identityCmd.command('list').description('List entities').action(async function () {
  await run(() => getClient().listEntities());
});

identityCmd
  .command('create')
  .description('Create an entity')
  .requiredOption('-n, --name <name>', 'Entity name')
  .action(async function (opts) {
    await run(() => getClient().createEntity({ name: opts.name }));
  });

identityCmd.command('get <id>').description('Get an entity').action(async function (id: string) {
  await run(() => getClient().getEntity({ id }));
});

const wrapCmd = program.command('wrap').description('Response wrapping');

wrapCmd
  .command('wrap')
  .description('Wrap data')
  .requiredOption('-d, --data <json>', 'JSON payload to wrap')
  .option('--ttl <ttl>', 'Wrap TTL')
  .action(async function (opts) {
    await run(() => getClient().wrap({ data: JSON.parse(opts.data), ttl: opts.ttl }));
  });

wrapCmd
  .command('unwrap')
  .description('Unwrap a response')
  .option('-t, --token <token>', 'Wrapping token')
  .action(async function (opts) {
    await run(() => getClient().unwrap({ token: opts.token }));
  });

const auditCmd = program.command('audit').description('Audit devices');

auditCmd.command('list').description('List audit devices').action(async function () {
  await run(() => getClient().listAuditDevices());
});

auditCmd
  .command('enable <path>')
  .description('Enable an audit device')
  .requiredOption('-t, --type <type>', 'Audit device type')
  .action(async function (path: string, opts) {
    await run(() => getClient().enableAuditDevice({ path, type: opts.type }));
  });

program.parse();
