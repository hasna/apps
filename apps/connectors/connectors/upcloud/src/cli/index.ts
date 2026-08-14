#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { UpCloud } from '../api';
import {
  getCredentials,
  setUsername,
  setPassword,
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

const CONNECTOR_NAME = 'connect-upcloud';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('UpCloud connector - Manage cloud servers, storage, and networking')
  .version(VERSION)
  .option('-u, --username <username>', 'API username (overrides config)')
  .option('-w, --password <password>', 'API password (overrides config)')
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
    if (opts.username) {
      process.env.UPCLOUD_USERNAME = opts.username;
    }
    if (opts.password) {
      process.env.UPCLOUD_PASSWORD = opts.password;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): UpCloud {
  const { username, password } = getCredentials();
  if (!username || !password) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-username <user>" and "${CONNECTOR_NAME} config set-password <pass>" or set UPCLOUD_USERNAME and UPCLOUD_PASSWORD.`);
    process.exit(1);
  }
  return new UpCloud({ apiKey: username, apiSecret: password });
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
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--username <username>', 'API username')
  .option('--password <password>', 'API password')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.username, apiSecret: opts.password });
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
  info(`Username: ${config.apiKey ? `${config.apiKey.substring(0, 4)}...` : chalk.gray('not set')}`);
  info(`Password: ${config.apiSecret ? chalk.gray('(set)') : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-username <username>').description('Set API username').action((username: string) => {
  setUsername(username);
  success(`Username saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-password <password>').description('Set API password').action((password: string) => {
  setPassword(password);
  success(`Password saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const { username, password } = getCredentials();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Username: ${username ? `${username.substring(0, 4)}...` : chalk.gray('not set')}`);
  info(`Password: ${password ? chalk.gray('(set)') : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Account commands
program.command('account').description('Get account info').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.account.getAccount();
    print(result.account, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('plans').description('List server plans').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.account.listPlans();
    print(result.plans?.plan ?? result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('zones').description('List zones').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.account.listZones();
    print(result.zones?.zone ?? result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('prices').description('List prices').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.account.listPrices();
    print(result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Server commands
const serverCmd = program.command('server').description('Server operations');

serverCmd.command('list').description('List servers').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.servers.listServers();
    print(result.servers?.server ?? result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

serverCmd.command('get <uuid>').description('Get server details').action(async function(this: Command, uuid: string) {
  try {
    const client = getClient();
    const result = await client.servers.getServer(uuid);
    print(result.server, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

serverCmd.command('create').description('Create a server')
  .requiredOption('-n, --hostname <hostname>', 'Server hostname')
  .requiredOption('-z, --zone <zone>', 'Zone ID')
  .option('-t, --title <title>', 'Server title')
  .option('--plan <plan>', 'Plan name')
  .option('--cores <cores>', 'Core count')
  .option('--memory <memory>', 'Memory in MB')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.servers.createServer({
        hostname: opts.hostname,
        zone: opts.zone,
        title: opts.title,
        plan: opts.plan,
        core_number: opts.cores ? parseInt(opts.cores) : undefined,
        memory_amount: opts.memory ? parseInt(opts.memory) : undefined,
      });
      success('Server created!');
      print(result.server, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

serverCmd.command('modify <uuid>').description('Modify a server')
  .option('-n, --hostname <hostname>', 'New hostname')
  .option('-t, --title <title>', 'New title')
  .option('--plan <plan>', 'Plan name')
  .action(async function(this: Command, uuid: string, opts) {
    try {
      const client = getClient();
      const result = await client.servers.modifyServer(uuid, {
        hostname: opts.hostname,
        title: opts.title,
        plan: opts.plan,
      });
      success('Server modified!');
      print(result.server, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

serverCmd.command('delete <uuid>').description('Delete a server')
  .option('--storages <storages>', 'Delete storages (0 or 1)')
  .option('--backups <backups>', 'Backup handling (keep, keep_latest, delete)')
  .action(async function(this: Command, uuid: string, opts) {
    try {
      const client = getClient();
      await client.servers.deleteServer(uuid, {
        storages: opts.storages !== undefined ? parseInt(opts.storages) as 0 | 1 : undefined,
        backups: opts.backups,
      });
      success('Server deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

serverCmd.command('start <uuid>').description('Start a server').action(async function(this: Command, uuid: string) {
  try {
    const client = getClient();
    const result = await client.servers.startServer(uuid);
    success('Server start initiated!');
    print(result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

serverCmd.command('stop <uuid>').description('Stop a server')
  .option('--type <type>', 'Stop type (soft or hard)', 'soft')
  .action(async function(this: Command, uuid: string, opts) {
    try {
      const client = getClient();
      const result = await client.servers.stopServer(uuid, { stop_type: opts.type });
      success('Server stop initiated!');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

serverCmd.command('restart <uuid>').description('Restart a server')
  .option('--type <type>', 'Stop type (soft or hard)', 'soft')
  .action(async function(this: Command, uuid: string, opts) {
    try {
      const client = getClient();
      const result = await client.servers.restartServer(uuid, { stop_type: opts.type });
      success('Server restart initiated!');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Storage commands
const storageCmd = program.command('storage').description('Storage operations');

storageCmd.command('list').description('List storages')
  .option('--type <type>', 'Storage type filter')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.storage.listStorages(opts.type);
      print(result.storages?.storage ?? result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storageCmd.command('get <uuid>').description('Get storage details').action(async function(this: Command, uuid: string) {
  try {
    const client = getClient();
    const result = await client.storage.getStorage(uuid);
    print(result.storage, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

storageCmd.command('create').description('Create storage')
  .requiredOption('-n, --title <title>', 'Storage title')
  .requiredOption('-s, --size <size>', 'Size in GB')
  .requiredOption('-z, --zone <zone>', 'Zone ID')
  .option('--tier <tier>', 'Storage tier (hdd, maxiops, standard, archive)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.storage.createStorage({
        title: opts.title,
        size: parseInt(opts.size),
        zone: opts.zone,
        tier: opts.tier,
      });
      success('Storage created!');
      print(result.storage, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storageCmd.command('delete <uuid>').description('Delete storage')
  .option('--backups <backups>', 'Backup handling (keep, keep_latest, delete)')
  .action(async function(this: Command, uuid: string, opts) {
    try {
      const client = getClient();
      await client.storage.deleteStorage(uuid, opts.backups);
      success('Storage deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storageCmd.command('attach <serverUuid> <storageUuid>').description('Attach storage to server')
  .option('--type <type>', 'Device type (disk or cdrom)')
  .action(async function(this: Command, serverUuid: string, storageUuid: string, opts) {
    try {
      const client = getClient();
      const result = await client.storage.attachStorage(serverUuid, storageUuid, { type: opts.type });
      success('Storage attached!');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storageCmd.command('detach <serverUuid> <address>').description('Detach storage from server').action(async function(this: Command, serverUuid: string, address: string) {
  try {
    const client = getClient();
    const result = await client.storage.detachStorage(serverUuid, address);
    success('Storage detached!');
    print(result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Network commands
const networkCmd = program.command('network').description('Network operations');

networkCmd.command('ip-list').description('List IP addresses').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.network.listIpAddresses();
    print(result.ip_addresses?.ip_address ?? result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkCmd.command('ip-get <ip>').description('Get IP address details').action(async function(this: Command, ip: string) {
  try {
    const client = getClient();
    const result = await client.network.getIpAddress(ip);
    print(result.ip_address, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkCmd.command('firewall-list <serverUuid>').description('List firewall rules').action(async function(this: Command, serverUuid: string) {
  try {
    const client = getClient();
    const result = await client.network.listFirewallRules(serverUuid);
    print(result.firewall_rules?.firewall_rule ?? result, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkCmd.command('list').description('List networks')
  .option('-z, --zone <zone>', 'Filter by zone')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.network.listNetworks(opts.zone);
      print(result.networks?.network ?? result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
