#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Pipedrive } from '../api';
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-pipedrive';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Pipedrive connector - CRM persons, organizations, deals, and activities')
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
      process.env.PIPEDRIVE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Pipedrive {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set PIPEDRIVE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Pipedrive({ apiKey });
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
  .description('Manage CLI configuration (for active profile)');

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
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Person Commands
// ============================================
const personCmd = program
  .command('person')
  .description('Person management');

personCmd
  .command('list')
  .description('List all persons')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPersons({ limit: parseInt(opts.limit) });
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('get <id>')
  .description('Get a person by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getPerson(parseInt(id));
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('create')
  .description('Create a new person')
  .requiredOption('--name <name>', 'Person name')
  .option('--email <email>', 'Email')
  .option('--phone <phone>', 'Phone')
  .option('--org-id <id>', 'Organization ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createPerson({
        name: opts.name,
        email: opts.email,
        phone: opts.phone,
        org_id: opts.orgId ? parseInt(opts.orgId) : undefined,
      });
      success('Person created!');
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('delete <id>')
  .description('Delete a person')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deletePerson(parseInt(id));
      success(`Person ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('search <term>')
  .description('Search persons')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const result = await client.searchPersons(term, { limit: parseInt(opts.limit) });
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Organization Commands
// ============================================
const orgCmd = program
  .command('organization')
  .alias('org')
  .description('Organization management');

orgCmd
  .command('list')
  .description('List all organizations')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listOrganizations({ limit: parseInt(opts.limit) });
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('get <id>')
  .description('Get an organization by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOrganization(parseInt(id));
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('create')
  .description('Create a new organization')
  .requiredOption('--name <name>', 'Organization name')
  .option('--address <address>', 'Address')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createOrganization({
        name: opts.name,
        address: opts.address,
      });
      success('Organization created!');
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('delete <id>')
  .description('Delete an organization')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteOrganization(parseInt(id));
      success(`Organization ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('search <term>')
  .description('Search organizations')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const result = await client.searchOrganizations(term, { limit: parseInt(opts.limit) });
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deal Commands
// ============================================
const dealCmd = program
  .command('deal')
  .description('Deal management');

dealCmd
  .command('list')
  .description('List all deals')
  .option('--limit <number>', 'Maximum results', '100')
  .option('--status <status>', 'Filter by status (open, won, lost)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDeals({
        limit: parseInt(opts.limit),
        status: opts.status,
      });
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('get <id>')
  .description('Get a deal by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getDeal(parseInt(id));
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('create')
  .description('Create a new deal')
  .requiredOption('--title <title>', 'Deal title')
  .option('--value <value>', 'Deal value')
  .option('--currency <currency>', 'Currency')
  .option('--person-id <id>', 'Person ID')
  .option('--org-id <id>', 'Organization ID')
  .option('--stage-id <id>', 'Stage ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createDeal({
        title: opts.title,
        value: opts.value ? parseFloat(opts.value) : undefined,
        currency: opts.currency,
        person_id: opts.personId ? parseInt(opts.personId) : undefined,
        org_id: opts.orgId ? parseInt(opts.orgId) : undefined,
        stage_id: opts.stageId ? parseInt(opts.stageId) : undefined,
      });
      success('Deal created!');
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('delete <id>')
  .description('Delete a deal')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteDeal(parseInt(id));
      success(`Deal ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('search <term>')
  .description('Search deals')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const result = await client.searchDeals(term, { limit: parseInt(opts.limit) });
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Lead Commands
// ============================================
const leadCmd = program
  .command('lead')
  .description('Lead management');

leadCmd
  .command('list')
  .description('List all leads')
  .option('--limit <number>', 'Maximum results', '100')
  .option('--archived', 'Show archived leads')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listLeads({
        limit: parseInt(opts.limit),
        archived: opts.archived,
      });
      print(result, getFormat(leadCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadCmd
  .command('get <id>')
  .description('Get a lead by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getLead(id);
      print(result, getFormat(leadCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadCmd
  .command('create')
  .description('Create a new lead')
  .requiredOption('--title <title>', 'Lead title')
  .option('--person-id <id>', 'Person ID')
  .option('--org-id <id>', 'Organization ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createLead({
        title: opts.title,
        person_id: opts.personId ? parseInt(opts.personId) : undefined,
        organization_id: opts.orgId ? parseInt(opts.orgId) : undefined,
      });
      success('Lead created!');
      print(result, getFormat(leadCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadCmd
  .command('delete <id>')
  .description('Delete a lead')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteLead(id);
      success(`Lead ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Activity Commands
// ============================================
const activityCmd = program
  .command('activity')
  .description('Activity management');

activityCmd
  .command('list')
  .description('List all activities')
  .option('--limit <number>', 'Maximum results', '100')
  .option('--done', 'Show only done activities')
  .option('--type <type>', 'Filter by type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listActivities({
        limit: parseInt(opts.limit),
        done: opts.done,
        type: opts.type,
      });
      print(result, getFormat(activityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

activityCmd
  .command('get <id>')
  .description('Get an activity by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getActivity(parseInt(id));
      print(result, getFormat(activityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

activityCmd
  .command('create')
  .description('Create a new activity')
  .requiredOption('--type <type>', 'Activity type (call, meeting, task, deadline, email, lunch)')
  .option('--subject <subject>', 'Subject')
  .option('--due-date <date>', 'Due date (YYYY-MM-DD)')
  .option('--due-time <time>', 'Due time (HH:MM)')
  .option('--deal-id <id>', 'Deal ID')
  .option('--person-id <id>', 'Person ID')
  .option('--org-id <id>', 'Organization ID')
  .option('--note <note>', 'Note')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createActivity({
        type: opts.type,
        subject: opts.subject,
        due_date: opts.dueDate,
        due_time: opts.dueTime,
        deal_id: opts.dealId ? parseInt(opts.dealId) : undefined,
        person_id: opts.personId ? parseInt(opts.personId) : undefined,
        org_id: opts.orgId ? parseInt(opts.orgId) : undefined,
        note: opts.note,
      });
      success('Activity created!');
      print(result, getFormat(activityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

activityCmd
  .command('delete <id>')
  .description('Delete an activity')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteActivity(parseInt(id));
      success(`Activity ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pipeline Commands
// ============================================
const pipelineCmd = program
  .command('pipeline')
  .description('Pipeline management');

pipelineCmd
  .command('list')
  .description('List all pipelines')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listPipelines();
      print(result, getFormat(pipelineCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelineCmd
  .command('get <id>')
  .description('Get a pipeline by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getPipeline(parseInt(id));
      print(result, getFormat(pipelineCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stage Commands
// ============================================
const stageCmd = program
  .command('stage')
  .description('Stage management');

stageCmd
  .command('list')
  .description('List all stages')
  .option('--pipeline-id <id>', 'Filter by pipeline ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listStages(opts.pipelineId ? parseInt(opts.pipelineId) : undefined);
      print(result, getFormat(stageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stageCmd
  .command('get <id>')
  .description('Get a stage by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getStage(parseInt(id));
      print(result, getFormat(stageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Note Commands
// ============================================
const noteCmd = program
  .command('note')
  .description('Note management');

noteCmd
  .command('list')
  .description('List all notes')
  .option('--limit <number>', 'Maximum results', '100')
  .option('--deal-id <id>', 'Filter by deal ID')
  .option('--person-id <id>', 'Filter by person ID')
  .option('--org-id <id>', 'Filter by organization ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listNotes({
        limit: parseInt(opts.limit),
        deal_id: opts.dealId ? parseInt(opts.dealId) : undefined,
        person_id: opts.personId ? parseInt(opts.personId) : undefined,
        org_id: opts.orgId ? parseInt(opts.orgId) : undefined,
      });
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('get <id>')
  .description('Get a note by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getNote(parseInt(id));
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('create')
  .description('Create a new note')
  .requiredOption('--content <content>', 'Note content')
  .option('--deal-id <id>', 'Deal ID')
  .option('--person-id <id>', 'Person ID')
  .option('--org-id <id>', 'Organization ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createNote({
        content: opts.content,
        deal_id: opts.dealId ? parseInt(opts.dealId) : undefined,
        person_id: opts.personId ? parseInt(opts.personId) : undefined,
        org_id: opts.orgId ? parseInt(opts.orgId) : undefined,
      });
      success('Note created!');
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('delete <id>')
  .description('Delete a note')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteNote(parseInt(id));
      success(`Note ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User management');

userCmd
  .command('list')
  .description('List all users')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listUsers();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('get <id>')
  .description('Get a user by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getUser(parseInt(id));
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('me')
  .description('Get current user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getCurrentUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
