#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SplitIo } from '../api';
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

const CONNECTOR_NAME = 'connect-split-io';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Split.io connector - Feature flags, segments, and experimentation')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Admin API key (overrides config)')
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
      process.env.SPLIT_IO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SplitIo {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set SPLIT_IO_API_KEY.`);
    process.exit(1);
  }
  return new SplitIo({ apiKey });
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

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'Admin API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
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
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-api-key <apiKey>').description('Set Admin API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

program.command('validate').description('Validate API credentials').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.validate();
    if (result.valid) {
      success('API credentials are valid');
    } else {
      error('API credentials are invalid');
      process.exit(1);
    }
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Workspaces
const workspacesCmd = program.command('workspaces').description('Manage workspaces');

workspacesCmd
  .command('list')
  .description('List workspaces')
  .option('--limit <limit>', 'Limit results', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .option('--name <name>', 'Filter by name')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listWorkspaces({
        limit: opts.limit,
        offset: opts.offset,
        name: opts.name,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Environments
const environmentsCmd = program.command('environments').description('Manage environments');

environmentsCmd
  .command('list <workspaceId>')
  .description('List environments in a workspace')
  .action(async function(this: Command, workspaceId: string) {
    try {
      const client = getClient();
      const result = await client.listEnvironments(workspaceId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

environmentsCmd
  .command('create <workspaceId>')
  .description('Create an environment')
  .requiredOption('--name <name>', 'Environment name')
  .option('--production', 'Mark as production environment')
  .option('--type <type>', 'Environment type')
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.createEnvironment(workspaceId, {
        name: opts.name,
        production: opts.production,
        type: opts.type,
      });
      print(result, getFormat(this));
      success(`Environment created: ${opts.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

environmentsCmd
  .command('delete <workspaceId> <environmentName>')
  .description('Delete an environment')
  .action(async function(this: Command, workspaceId: string, environmentName: string) {
    try {
      const client = getClient();
      await client.deleteEnvironment(workspaceId, environmentName);
      success(`Environment ${environmentName} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Traffic types
const trafficTypesCmd = program.command('traffic-types').description('Manage traffic types');

trafficTypesCmd
  .command('list <workspaceId>')
  .description('List traffic types')
  .action(async function(this: Command, workspaceId: string) {
    try {
      const client = getClient();
      const result = await client.listTrafficTypes(workspaceId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trafficTypesCmd
  .command('create <workspaceId>')
  .description('Create a traffic type')
  .requiredOption('--name <name>', 'Traffic type name')
  .option('--display-attribute-id <id>', 'Display attribute ID')
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.createTrafficType(workspaceId, {
        name: opts.name,
        displayAttributeId: opts.displayAttributeId,
      });
      print(result, getFormat(this));
      success(`Traffic type created: ${opts.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trafficTypesCmd
  .command('delete <trafficTypeId>')
  .description('Delete a traffic type')
  .action(async function(this: Command, trafficTypeId: string) {
    try {
      const client = getClient();
      await client.deleteTrafficType(trafficTypeId);
      success(`Traffic type ${trafficTypeId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Splits
const splitsCmd = program.command('splits').description('Manage feature flags (splits)');

splitsCmd
  .command('list <workspaceId>')
  .description('List splits')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .option('--traffic-type <name>', 'Filter by traffic type')
  .option('--tag <tags...>', 'Filter by tags')
  .option('--archived', 'Include archived splits')
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.listSplits(workspaceId, {
        limit: opts.limit,
        offset: opts.offset,
        trafficTypeName: opts.trafficType,
        tags: opts.tag,
        archived: opts.archived,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('get <workspaceId> <splitName>')
  .description('Get a split')
  .action(async function(this: Command, workspaceId: string, splitName: string) {
    try {
      const client = getClient();
      const result = await client.getSplit(workspaceId, splitName);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('create <workspaceId> <trafficTypeId>')
  .description('Create a split')
  .requiredOption('--name <name>', 'Split name')
  .option('--description <description>', 'Description')
  .option('--tag <tags...>', 'Tags')
  .action(async function(this: Command, workspaceId: string, trafficTypeId: string, opts) {
    try {
      const client = getClient();
      const result = await client.createSplit(workspaceId, trafficTypeId, {
        name: opts.name,
        description: opts.description,
        tags: opts.tag,
      });
      print(result, getFormat(this));
      success(`Split created: ${opts.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('update-description <workspaceId> <splitName>')
  .description('Update split description')
  .requiredOption('--description <description>', 'New description')
  .action(async function(this: Command, workspaceId: string, splitName: string, opts) {
    try {
      const client = getClient();
      const result = await client.updateSplitDescription(workspaceId, splitName, opts.description);
      print(result, getFormat(this));
      success(`Split ${splitName} description updated`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('delete <workspaceId> <splitName>')
  .description('Delete a split')
  .action(async function(this: Command, workspaceId: string, splitName: string) {
    try {
      const client = getClient();
      await client.deleteSplit(workspaceId, splitName);
      success(`Split ${splitName} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('definition get <workspaceId> <splitName> <environmentName>')
  .description('Get split definition for an environment')
  .action(async function(this: Command, workspaceId: string, splitName: string, environmentName: string) {
    try {
      const client = getClient();
      const result = await client.getSplitDefinition(workspaceId, splitName, environmentName);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('definition create <workspaceId> <splitName> <environmentName>')
  .description('Create split definition')
  .requiredOption('--default-treatment <name>', 'Default treatment name')
  .option('--body <json>', 'Full definition JSON')
  .action(async function(this: Command, workspaceId: string, splitName: string, environmentName: string, opts) {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : { defaultTreatment: opts.defaultTreatment };
      const result = await client.createSplitDefinition(workspaceId, splitName, environmentName, body);
      print(result, getFormat(this));
      success(`Definition created for ${splitName} in ${environmentName}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('kill <workspaceId> <splitName> <environmentName>')
  .description('Kill a split in an environment')
  .action(async function(this: Command, workspaceId: string, splitName: string, environmentName: string) {
    try {
      const client = getClient();
      await client.killSplit(workspaceId, splitName, environmentName);
      success(`Split ${splitName} killed in ${environmentName}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitsCmd
  .command('restore <workspaceId> <splitName> <environmentName>')
  .description('Restore a killed split')
  .action(async function(this: Command, workspaceId: string, splitName: string, environmentName: string) {
    try {
      const client = getClient();
      await client.restoreSplit(workspaceId, splitName, environmentName);
      success(`Split ${splitName} restored in ${environmentName}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Segments
const segmentsCmd = program.command('segments').description('Manage segments');

segmentsCmd
  .command('list <workspaceId>')
  .description('List segments')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .option('--name <name>', 'Filter by name')
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.listSegments(workspaceId, {
        limit: opts.limit,
        offset: opts.offset,
        name: opts.name,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentsCmd
  .command('create <workspaceId> <trafficTypeName>')
  .description('Create a segment')
  .requiredOption('--name <name>', 'Segment name')
  .option('--description <description>', 'Description')
  .action(async function(this: Command, workspaceId: string, trafficTypeName: string, opts) {
    try {
      const client = getClient();
      const result = await client.createSegment(workspaceId, trafficTypeName, {
        name: opts.name,
        description: opts.description,
      });
      print(result, getFormat(this));
      success(`Segment created: ${opts.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentsCmd
  .command('delete <workspaceId> <segmentName>')
  .description('Delete a segment')
  .action(async function(this: Command, workspaceId: string, segmentName: string) {
    try {
      const client = getClient();
      await client.deleteSegment(workspaceId, segmentName);
      success(`Segment ${segmentName} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentsCmd
  .command('keys <segmentName> <environmentName>')
  .description('List keys in a segment')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .action(async function(this: Command, segmentName: string, environmentName: string, opts) {
    try {
      const client = getClient();
      const result = await client.getSegmentKeys(segmentName, environmentName, {
        limit: opts.limit,
        offset: opts.offset,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentsCmd
  .command('add-keys <segmentName> <environmentName>')
  .description('Add keys to a segment')
  .requiredOption('--keys <keys...>', 'Keys to add')
  .option('--comment <comment>', 'Change comment')
  .action(async function(this: Command, segmentName: string, environmentName: string, opts) {
    try {
      const client = getClient();
      const result = await client.addKeysToSegment(segmentName, environmentName, opts.keys, opts.comment);
      print(result, getFormat(this));
      success(`Added ${opts.keys.length} key(s) to ${segmentName}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentsCmd
  .command('remove-keys <segmentName> <environmentName>')
  .description('Remove keys from a segment')
  .requiredOption('--keys <keys...>', 'Keys to remove')
  .action(async function(this: Command, segmentName: string, environmentName: string, opts) {
    try {
      const client = getClient();
      await client.removeKeysFromSegment(segmentName, environmentName, opts.keys);
      success(`Removed ${opts.keys.length} key(s) from ${segmentName}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Tags
const tagsCmd = program.command('tags').description('Manage tags');

tagsCmd
  .command('list <workspaceId>')
  .description('List tags')
  .option('--tag-name <name>', 'Filter by tag name')
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.listTags(workspaceId, { tagName: opts.tagName });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Metrics
const metricsCmd = program.command('metrics').description('Manage metrics');

metricsCmd
  .command('list <workspaceId>')
  .description('List metrics')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.listMetrics(workspaceId, {
        limit: opts.limit,
        offset: opts.offset,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metricsCmd
  .command('create <workspaceId>')
  .description('Create a metric')
  .requiredOption('--body <json>', 'Metric definition JSON')
  .action(async function(this: Command, workspaceId: string, opts) {
    try {
      const client = getClient();
      const result = await client.createMetric(workspaceId, JSON.parse(opts.body));
      print(result, getFormat(this));
      success('Metric created');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metricsCmd
  .command('delete <workspaceId> <metricId>')
  .description('Delete a metric')
  .action(async function(this: Command, workspaceId: string, metricId: string) {
    try {
      const client = getClient();
      await client.deleteMetric(workspaceId, metricId);
      success(`Metric ${metricId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Change requests
const changeRequestsCmd = program.command('change-requests').description('Manage change requests');

changeRequestsCmd
  .command('list')
  .description('List change requests')
  .option('--workspace-id <id>', 'Filter by workspace')
  .option('--status <status>', 'Filter by status (REQUESTED, SCHEDULE_REQUESTED, APPROVED, REJECTED, WITHDRAWN, PUBLISHED)')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listChangeRequests({
        workspaceId: opts.workspaceId,
        status: opts.status,
        limit: opts.limit,
        offset: opts.offset,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

changeRequestsCmd
  .command('get <id>')
  .description('Get a change request')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getChangeRequest(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

changeRequestsCmd
  .command('approve <id>')
  .description('Approve a change request')
  .option('--comment <comment>', 'Approval comment')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.approveChangeRequest(id, opts.comment);
      print(result, getFormat(this));
      success(`Change request ${id} approved`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

changeRequestsCmd
  .command('decline <id>')
  .description('Decline a change request')
  .option('--comment <comment>', 'Decline comment')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.declineChangeRequest(id, opts.comment);
      print(result, getFormat(this));
      success(`Change request ${id} declined`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Attributes
const attributesCmd = program.command('attributes').description('Manage attribute schemas');

attributesCmd
  .command('list <workspaceId> <trafficTypeId>')
  .description('List attributes for a traffic type')
  .action(async function(this: Command, workspaceId: string, trafficTypeId: string) {
    try {
      const client = getClient();
      const result = await client.listAttributes(workspaceId, trafficTypeId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Groups
program
  .command('groups list')
  .description('List groups')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listGroups({
        limit: opts.limit,
        offset: opts.offset,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Users
program
  .command('users list')
  .description('List users')
  .option('--limit <limit>', 'Limit', parseInt)
  .option('--offset <offset>', 'Offset', parseInt)
  .option('--status <status>', 'Filter by status (ACTIVE, DEACTIVATED, PENDING)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listUsers({
        limit: opts.limit,
        offset: opts.offset,
        status: opts.status,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
