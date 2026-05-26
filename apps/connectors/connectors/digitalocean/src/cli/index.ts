#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { DigitalOcean } from '../api';
import {
  getApiKey,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-digitalocean';
const VERSION = '0.0.2';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('DigitalOcean connector - Manage droplets, volumes, databases, domains, and more')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    if (opts.apiKey) {
      process.env.DIGITALOCEAN_TOKEN = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): DigitalOcean {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set DIGITALOCEAN_TOKEN environment variable.`);
    process.exit(1);
  }
  return new DigitalOcean({ apiKey });
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Account Commands
// ============================================
program
  .command('account')
  .description('Get account info')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getAccount();
      print(result.account, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Region Commands
// ============================================
program
  .command('regions')
  .description('List regions')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listRegions();
      print(result.regions, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Size Commands
// ============================================
program
  .command('sizes')
  .description('List sizes')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listSizes();
      print(result.sizes, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Droplet Commands
// ============================================
const dropletCmd = program
  .command('droplet')
  .description('Droplet operations');

dropletCmd
  .command('list')
  .description('List droplets')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .option('--tag <tag>', 'Filter by tag')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listDroplets({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        tag_name: opts.tag,
      });
      print(result.droplets, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dropletCmd
  .command('get <dropletId>')
  .description('Get droplet details')
  .action(async function(this: Command, dropletId: string) {
    try {
      const client = getClient();
      const result = await client.getDroplet(parseInt(dropletId));
      print(result.droplet, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dropletCmd
  .command('create')
  .description('Create a droplet')
  .requiredOption('-n, --name <name>', 'Droplet name')
  .requiredOption('-r, --region <region>', 'Region slug')
  .requiredOption('-s, --size <size>', 'Size slug')
  .requiredOption('-i, --image <image>', 'Image ID or slug')
  .option('--ssh-keys <keys>', 'SSH key IDs (comma-separated)')
  .option('--backups', 'Enable backups')
  .option('--ipv6', 'Enable IPv6')
  .option('--monitoring', 'Enable monitoring')
  .option('--tags <tags>', 'Tags (comma-separated)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createDroplet({
        name: opts.name,
        region: opts.region,
        size: opts.size,
        image: opts.image,
        ssh_keys: opts.sshKeys ? opts.sshKeys.split(',') : undefined,
        backups: opts.backups,
        ipv6: opts.ipv6,
        monitoring: opts.monitoring,
        tags: opts.tags ? opts.tags.split(',') : undefined,
      });
      success('Droplet created!');
      print(result.droplet, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dropletCmd
  .command('delete <dropletId>')
  .description('Delete a droplet')
  .action(async function(this: Command, dropletId: string) {
    try {
      const client = getClient();
      await client.deleteDroplet(parseInt(dropletId));
      success('Droplet deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dropletCmd
  .command('action <dropletId>')
  .description('Perform a droplet action')
  .requiredOption('-t, --type <type>', 'Action type (reboot, power_cycle, shutdown, power_off, power_on, etc.)')
  .option('--size <size>', 'Size for resize action')
  .option('--image <image>', 'Image for rebuild action')
  .option('--name <name>', 'Name for rename action')
  .action(async function(this: Command, dropletId: string, opts) {
    try {
      const client = getClient();
      const result = await client.performDropletAction(parseInt(dropletId), {
        type: opts.type,
        size: opts.size,
        image: opts.image,
        name: opts.name,
      });
      success('Action initiated!');
      print(result.action, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Image Commands
// ============================================
const imageCmd = program
  .command('image')
  .description('Image operations');

imageCmd
  .command('list')
  .description('List images')
  .option('--type <type>', 'Image type (distribution, application, backup, snapshot)')
  .option('--private', 'Show only private images')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listImages({
        type: opts.type,
        private: opts.private,
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result.images, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('get <imageId>')
  .description('Get image details')
  .action(async function(this: Command, imageId: string) {
    try {
      const client = getClient();
      const result = await client.getImage(imageId);
      print(result.image, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('delete <imageId>')
  .description('Delete an image')
  .action(async function(this: Command, imageId: string) {
    try {
      const client = getClient();
      await client.deleteImage(parseInt(imageId));
      success('Image deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// SSH Key Commands
// ============================================
const sshKeyCmd = program
  .command('ssh-key')
  .description('SSH key operations');

sshKeyCmd
  .command('list')
  .description('List SSH keys')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listSSHKeys();
      print(result.ssh_keys, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sshKeyCmd
  .command('get <keyId>')
  .description('Get SSH key details')
  .action(async function(this: Command, keyId: string) {
    try {
      const client = getClient();
      const result = await client.getSSHKey(keyId);
      print(result.ssh_key, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sshKeyCmd
  .command('create')
  .description('Create an SSH key')
  .requiredOption('-n, --name <name>', 'Key name')
  .requiredOption('--public-key <key>', 'Public key content')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createSSHKey({
        name: opts.name,
        public_key: opts.publicKey,
      });
      success('SSH key created!');
      print(result.ssh_key, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sshKeyCmd
  .command('delete <keyId>')
  .description('Delete an SSH key')
  .action(async function(this: Command, keyId: string) {
    try {
      const client = getClient();
      await client.deleteSSHKey(keyId);
      success('SSH key deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Volume Commands
// ============================================
const volumeCmd = program
  .command('volume')
  .description('Volume operations');

volumeCmd
  .command('list')
  .description('List volumes')
  .option('--region <region>', 'Filter by region')
  .option('--name <name>', 'Filter by name')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listVolumes({
        region: opts.region,
        name: opts.name,
      });
      print(result.volumes, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

volumeCmd
  .command('get <volumeId>')
  .description('Get volume details')
  .action(async function(this: Command, volumeId: string) {
    try {
      const client = getClient();
      const result = await client.getVolume(volumeId);
      print(result.volume, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

volumeCmd
  .command('create')
  .description('Create a volume')
  .requiredOption('-n, --name <name>', 'Volume name')
  .requiredOption('-s, --size <size>', 'Size in GB')
  .requiredOption('-r, --region <region>', 'Region slug')
  .option('-d, --description <description>', 'Description')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createVolume({
        name: opts.name,
        size_gigabytes: parseInt(opts.size),
        region: opts.region,
        description: opts.description,
      });
      success('Volume created!');
      print(result.volume, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

volumeCmd
  .command('delete <volumeId>')
  .description('Delete a volume')
  .action(async function(this: Command, volumeId: string) {
    try {
      const client = getClient();
      await client.deleteVolume(volumeId);
      success('Volume deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

volumeCmd
  .command('attach <volumeId> <dropletId>')
  .description('Attach volume to droplet')
  .option('-r, --region <region>', 'Region')
  .action(async function(this: Command, volumeId: string, dropletId: string, opts) {
    try {
      const client = getClient();
      const result = await client.attachVolume(volumeId, parseInt(dropletId), opts.region);
      success('Volume attached!');
      print(result.action, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

volumeCmd
  .command('detach <volumeId> <dropletId>')
  .description('Detach volume from droplet')
  .option('-r, --region <region>', 'Region')
  .action(async function(this: Command, volumeId: string, dropletId: string, opts) {
    try {
      const client = getClient();
      const result = await client.detachVolume(volumeId, parseInt(dropletId), opts.region);
      success('Volume detached!');
      print(result.action, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Domain Commands
// ============================================
const domainCmd = program
  .command('domain')
  .description('Domain operations');

domainCmd
  .command('list')
  .description('List domains')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listDomains();
      print(result.domains, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('get <domain>')
  .description('Get domain details')
  .action(async function(this: Command, domain: string) {
    try {
      const client = getClient();
      const result = await client.getDomain(domain);
      print(result.domain, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('create <domain>')
  .description('Create a domain')
  .option('--ip <ip>', 'IP address')
  .action(async function(this: Command, domain: string, opts) {
    try {
      const client = getClient();
      const result = await client.createDomain(domain, opts.ip);
      success('Domain created!');
      print(result.domain, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('delete <domain>')
  .description('Delete a domain')
  .action(async function(this: Command, domain: string) {
    try {
      const client = getClient();
      await client.deleteDomain(domain);
      success('Domain deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('records <domain>')
  .description('List domain records')
  .action(async function(this: Command, domain: string) {
    try {
      const client = getClient();
      const result = await client.listDomainRecords(domain);
      print(result.domain_records, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('record-create <domain>')
  .description('Create a domain record')
  .requiredOption('-t, --type <type>', 'Record type (A, AAAA, CNAME, MX, TXT, etc.)')
  .requiredOption('-n, --name <name>', 'Record name')
  .requiredOption('-d, --data <data>', 'Record data')
  .option('--ttl <ttl>', 'TTL')
  .option('--priority <priority>', 'Priority (for MX)')
  .action(async function(this: Command, domain: string, opts) {
    try {
      const client = getClient();
      const result = await client.createDomainRecord(domain, {
        type: opts.type,
        name: opts.name,
        data: opts.data,
        ttl: opts.ttl ? parseInt(opts.ttl) : undefined,
        priority: opts.priority ? parseInt(opts.priority) : undefined,
      });
      success('Record created!');
      print(result.domain_record, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('record-delete <domain> <recordId>')
  .description('Delete a domain record')
  .action(async function(this: Command, domain: string, recordId: string) {
    try {
      const client = getClient();
      await client.deleteDomainRecord(domain, parseInt(recordId));
      success('Record deleted!');
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
  .description('Firewall operations');

firewallCmd
  .command('list')
  .description('List firewalls')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listFirewalls();
      print(result.firewalls, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

firewallCmd
  .command('get <firewallId>')
  .description('Get firewall details')
  .action(async function(this: Command, firewallId: string) {
    try {
      const client = getClient();
      const result = await client.getFirewall(firewallId);
      print(result.firewall, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

firewallCmd
  .command('delete <firewallId>')
  .description('Delete a firewall')
  .action(async function(this: Command, firewallId: string) {
    try {
      const client = getClient();
      await client.deleteFirewall(firewallId);
      success('Firewall deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Load Balancer Commands
// ============================================
const lbCmd = program
  .command('load-balancer')
  .description('Load balancer operations');

lbCmd
  .command('list')
  .description('List load balancers')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listLoadBalancers();
      print(result.load_balancers, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lbCmd
  .command('get <loadBalancerId>')
  .description('Get load balancer details')
  .action(async function(this: Command, loadBalancerId: string) {
    try {
      const client = getClient();
      const result = await client.getLoadBalancer(loadBalancerId);
      print(result.load_balancer, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lbCmd
  .command('delete <loadBalancerId>')
  .description('Delete a load balancer')
  .action(async function(this: Command, loadBalancerId: string) {
    try {
      const client = getClient();
      await client.deleteLoadBalancer(loadBalancerId);
      success('Load balancer deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Database Commands
// ============================================
const dbCmd = program
  .command('database')
  .description('Database operations');

dbCmd
  .command('list')
  .description('List databases')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listDatabases();
      print(result.databases, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dbCmd
  .command('get <databaseId>')
  .description('Get database details')
  .action(async function(this: Command, databaseId: string) {
    try {
      const client = getClient();
      const result = await client.getDatabase(databaseId);
      print(result.database, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dbCmd
  .command('create')
  .description('Create a database cluster')
  .requiredOption('-n, --name <name>', 'Database name')
  .requiredOption('-e, --engine <engine>', 'Engine (pg, mysql, redis, mongodb)')
  .requiredOption('-s, --size <size>', 'Size slug')
  .requiredOption('-r, --region <region>', 'Region slug')
  .requiredOption('--nodes <nodes>', 'Number of nodes')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createDatabase({
        name: opts.name,
        engine: opts.engine,
        size: opts.size,
        region: opts.region,
        num_nodes: parseInt(opts.nodes),
      });
      success('Database cluster created!');
      print(result.database, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dbCmd
  .command('delete <databaseId>')
  .description('Delete a database cluster')
  .action(async function(this: Command, databaseId: string) {
    try {
      const client = getClient();
      await client.deleteDatabase(databaseId);
      success('Database cluster deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Kubernetes Commands
// ============================================
const k8sCmd = program
  .command('kubernetes')
  .description('Kubernetes operations');

k8sCmd
  .command('list')
  .description('List Kubernetes clusters')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listKubernetesClusters();
      print(result.kubernetes_clusters, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

k8sCmd
  .command('get <clusterId>')
  .description('Get Kubernetes cluster details')
  .action(async function(this: Command, clusterId: string) {
    try {
      const client = getClient();
      const result = await client.getKubernetesCluster(clusterId);
      print(result.kubernetes_cluster, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

k8sCmd
  .command('delete <clusterId>')
  .description('Delete a Kubernetes cluster')
  .action(async function(this: Command, clusterId: string) {
    try {
      const client = getClient();
      await client.deleteKubernetesCluster(clusterId);
      success('Kubernetes cluster deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

k8sCmd
  .command('kubeconfig <clusterId>')
  .description('Get kubeconfig for a cluster')
  .action(async function(this: Command, clusterId: string) {
    try {
      const client = getClient();
      const kubeconfig = await client.getKubeconfig(clusterId);
      console.log(kubeconfig);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Project Commands
// ============================================
const projectCmd = program
  .command('project')
  .description('Project operations');

projectCmd
  .command('list')
  .description('List projects')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listProjects();
      print(result.projects, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('get <projectId>')
  .description('Get project details')
  .action(async function(this: Command, projectId: string) {
    try {
      const client = getClient();
      const result = await client.getProject(projectId);
      print(result.project, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('create')
  .description('Create a project')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('-d, --description <description>', 'Description')
  .option('--purpose <purpose>', 'Purpose')
  .option('-e, --environment <environment>', 'Environment (Development, Staging, Production)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createProject({
        name: opts.name,
        description: opts.description,
        purpose: opts.purpose,
        environment: opts.environment,
      });
      success('Project created!');
      print(result.project, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('delete <projectId>')
  .description('Delete a project')
  .action(async function(this: Command, projectId: string) {
    try {
      const client = getClient();
      await client.deleteProject(projectId);
      success('Project deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('default')
  .description('Get the default project')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getDefaultProject();
      print(result.project, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Snapshot Commands
// ============================================
const snapshotCmd = program
  .command('snapshot')
  .description('Snapshot operations');

snapshotCmd
  .command('list')
  .description('List snapshots')
  .option('--resource-type <type>', 'Resource type (droplet, volume)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listSnapshots({
        resource_type: opts.resourceType,
      });
      print(result.snapshots, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snapshotCmd
  .command('get <snapshotId>')
  .description('Get snapshot details')
  .action(async function(this: Command, snapshotId: string) {
    try {
      const client = getClient();
      const result = await client.getSnapshot(snapshotId);
      print(result.snapshot, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snapshotCmd
  .command('delete <snapshotId>')
  .description('Delete a snapshot')
  .action(async function(this: Command, snapshotId: string) {
    try {
      const client = getClient();
      await client.deleteSnapshot(snapshotId);
      success('Snapshot deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Floating IP Commands
// ============================================
const floatingIpCmd = program
  .command('floating-ip')
  .description('Floating IP operations');

floatingIpCmd
  .command('list')
  .description('List floating IPs')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listFloatingIPs();
      print(result.floating_ips, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

floatingIpCmd
  .command('get <ip>')
  .description('Get floating IP details')
  .action(async function(this: Command, ip: string) {
    try {
      const client = getClient();
      const result = await client.getFloatingIP(ip);
      print(result.floating_ip, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

floatingIpCmd
  .command('create')
  .description('Create a floating IP')
  .option('-r, --region <region>', 'Region slug')
  .option('-d, --droplet-id <dropletId>', 'Droplet ID')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createFloatingIP({
        region: opts.region,
        droplet_id: opts.dropletId ? parseInt(opts.dropletId) : undefined,
      });
      success('Floating IP created!');
      print(result.floating_ip, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

floatingIpCmd
  .command('delete <ip>')
  .description('Delete a floating IP')
  .action(async function(this: Command, ip: string) {
    try {
      const client = getClient();
      await client.deleteFloatingIP(ip);
      success('Floating IP deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// VPC Commands
// ============================================
const vpcCmd = program
  .command('vpc')
  .description('VPC operations');

vpcCmd
  .command('list')
  .description('List VPCs')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listVPCs();
      print(result.vpcs, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

vpcCmd
  .command('get <vpcId>')
  .description('Get VPC details')
  .action(async function(this: Command, vpcId: string) {
    try {
      const client = getClient();
      const result = await client.getVPC(vpcId);
      print(result.vpc, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

vpcCmd
  .command('create')
  .description('Create a VPC')
  .requiredOption('-n, --name <name>', 'VPC name')
  .requiredOption('-r, --region <region>', 'Region slug')
  .option('-d, --description <description>', 'Description')
  .option('--ip-range <range>', 'IP range')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createVPC({
        name: opts.name,
        region: opts.region,
        description: opts.description,
        ip_range: opts.ipRange,
      });
      success('VPC created!');
      print(result.vpc, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

vpcCmd
  .command('delete <vpcId>')
  .description('Delete a VPC')
  .action(async function(this: Command, vpcId: string) {
    try {
      const client = getClient();
      await client.deleteVPC(vpcId);
      success('VPC deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Action Commands
// ============================================
const actionCmd = program
  .command('action')
  .description('Action operations');

actionCmd
  .command('list')
  .description('List all actions')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listActions({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result.actions, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('get <actionId>')
  .description('Get action details')
  .action(async function(this: Command, actionId: string) {
    try {
      const client = getClient();
      const result = await client.getAction(parseInt(actionId));
      print(result.action, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
