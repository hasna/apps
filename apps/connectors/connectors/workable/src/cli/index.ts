#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getSubdomain,
  setSubdomain,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-workable';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Workable connector CLI - recruiting and applicant tracking (SPI v3)')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-s, --subdomain <subdomain>', 'Workable account subdomain')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.WORKABLE_API_TOKEN = opts.apiKey;
      debug('API token set from command line flag');
    }

    if (opts.subdomain) {
      process.env.WORKABLE_SUBDOMAIN = opts.subdomain;
      debug(`Subdomain set from command line: ${opts.subdomain}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  const subdomain = getSubdomain() || program.opts().subdomain;

  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set WORKABLE_API_TOKEN.`);
    process.exit(1);
  }
  if (!subdomain) {
    error(`Workable subdomain is required. Run "${CONNECTOR_NAME} config set-subdomain <subdomain>" or set WORKABLE_SUBDOMAIN.`);
    process.exit(1);
  }

  return new Connector({ apiKey, subdomain });
}

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
  .option('--api-key <key>', 'API token')
  .option('--subdomain <subdomain>', 'Workable subdomain')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, subdomain: opts.subdomain });
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
  info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Subdomain: ${config.subdomain || chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <token>').description('Set API token').action((token: string) => {
  setApiKey(token);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-subdomain <subdomain>').description('Set Workable subdomain').action((subdomain: string) => {
  setSubdomain(subdomain);
  success(`Subdomain saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  const subdomain = getSubdomain();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Subdomain: ${subdomain || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const jobsCmd = program.command('jobs').description('Manage job postings');

jobsCmd
  .command('list')
  .description('List jobs')
  .option('--state <state>', 'Filter by state (draft, published, archived, closed)')
  .option('-l, --limit <number>', 'Max results', parseInt)
  .option('--since-id <id>', 'Pagination cursor')
  .option('--created-after <iso>', 'Filter by creation date')
  .action(async (opts) => {
    try {
      const result = await getClient().jobs.list({
        state: opts.state,
        limit: opts.limit,
        sinceId: opts.sinceId,
        createdAfter: opts.createdAfter,
      });
      print(result, getFormat(jobsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd.command('get <shortcode>').description('Get a job by shortcode').action(async (shortcode: string) => {
  try {
    print(await getClient().jobs.get(shortcode), getFormat(jobsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

jobsCmd
  .command('create')
  .description('Create a job')
  .requiredOption('-t, --title <title>', 'Job title')
  .option('--description <text>', 'Job description')
  .option('--requirements <text>', 'Requirements')
  .option('--benefits <text>', 'Benefits')
  .option('--department-id <id>', 'Department ID')
  .option('--employment-type <type>', 'Employment type')
  .action(async (opts) => {
    try {
      const result = await getClient().jobs.create({
        title: opts.title,
        description: opts.description,
        requirements: opts.requirements,
        benefits: opts.benefits,
        departmentId: opts.departmentId,
        employment_type: opts.employmentType,
      });
      success('Job created');
      print(result, getFormat(jobsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const candidatesCmd = program.command('candidates').description('Manage candidates');

candidatesCmd
  .command('list <shortcode>')
  .description('List candidates for a job')
  .option('--stage <stage>', 'Filter by stage')
  .option('--state <state>', 'Filter by state')
  .option('-l, --limit <number>', 'Max results', parseInt)
  .option('--since-id <id>', 'Pagination cursor')
  .action(async (shortcode: string, opts) => {
    try {
      print(
        await getClient().candidates.listForJob({
          shortcode,
          stage: opts.stage,
          state: opts.state,
          limit: opts.limit,
          sinceId: opts.sinceId,
        }),
        getFormat(candidatesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('create <shortcode>')
  .description('Create a candidate for a job')
  .requiredOption('-n, --name <name>', 'Candidate name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--headline <text>', 'Headline')
  .action(async (shortcode: string, opts) => {
    try {
      const result = await getClient().candidates.create({
        shortcode,
        candidate: {
          name: opts.name,
          email: opts.email,
          phone: opts.phone,
          headline: opts.headline,
        },
      });
      success('Candidate created');
      print(result, getFormat(candidatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd.command('get <id>').description('Get a candidate').action(async (id: string) => {
  try {
    print(await getClient().candidates.get(id), getFormat(candidatesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

candidatesCmd
  .command('update <id>')
  .description('Update a candidate')
  .option('-n, --name <name>', 'Candidate name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .action(async (id: string, opts) => {
    try {
      print(
        await getClient().candidates.update({
          id,
          candidate: {
            name: opts.name,
            email: opts.email,
            phone: opts.phone,
          },
        }),
        getFormat(candidatesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('move <id>')
  .description('Move candidate to another stage')
  .requiredOption('--target-stage <stage>', 'Target stage slug')
  .action(async (id: string, opts) => {
    try {
      print(
        await getClient().candidates.moveStage({ id, targetStage: opts.targetStage }),
        getFormat(candidatesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('copy <id>')
  .description('Copy candidate to another job')
  .requiredOption('--target-job <shortcode>', 'Target job shortcode')
  .action(async (id: string, opts) => {
    try {
      print(
        await getClient().candidates.copy({ id, targetJobShortcode: opts.targetJob }),
        getFormat(candidatesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('disqualify <id>')
  .description('Disqualify a candidate')
  .option('--reason <reason>', 'Disqualification reason')
  .option('--member-id <id>', 'Member who disqualified')
  .action(async (id: string, opts) => {
    try {
      print(
        await getClient().candidates.disqualify({
          id,
          disqualificationReason: opts.reason,
          disqualifiedBy: opts.memberId,
        }),
        getFormat(candidatesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd.command('revert <id>').description('Revert a disqualified candidate').action(async (id: string) => {
  try {
    print(await getClient().candidates.revert(id), getFormat(candidatesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const commentsCmd = program.command('comments').description('Candidate comments');

commentsCmd.command('list <candidateId>').description('List comments').action(async (candidateId: string) => {
  try {
    print(await getClient().comments.list(candidateId), getFormat(commentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

commentsCmd
  .command('add <candidateId>')
  .description('Add a comment')
  .requiredOption('-b, --body <text>', 'Comment body')
  .option('--member-id <id>', 'Member ID')
  .action(async (candidateId: string, opts) => {
    try {
      print(
        await getClient().comments.add({
          candidateId,
          body: opts.body,
          memberId: opts.memberId,
        }),
        getFormat(commentsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const activitiesCmd = program.command('activities').description('Candidate activities');

activitiesCmd
  .command('list <candidateId>')
  .description('List activities')
  .option('-l, --limit <number>', 'Max results', parseInt)
  .option('--since-id <id>', 'Pagination cursor')
  .action(async (candidateId: string, opts) => {
    try {
      print(
        await getClient().comments.listActivities({
          candidateId,
          limit: opts.limit,
          sinceId: opts.sinceId,
        }),
        getFormat(activitiesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const offersCmd = program.command('offers').description('Candidate offers');

offersCmd.command('get <candidateId>').description('Get offer').action(async (candidateId: string) => {
  try {
    print(await getClient().offers.get(candidateId), getFormat(offersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

offersCmd
  .command('create <candidateId>')
  .description('Create an offer')
  .option('--template-id <id>', 'Offer template ID')
  .option('--start-date <date>', 'Start date (ISO)')
  .option('--salary-amount <amount>', 'Salary amount', parseFloat)
  .option('--salary-currency <code>', 'Salary currency code')
  .action(async (candidateId: string, opts) => {
    try {
      const salary =
        opts.salaryAmount !== undefined && opts.salaryCurrency
          ? { amount: opts.salaryAmount, currency: opts.salaryCurrency }
          : undefined;
      print(
        await getClient().offers.create({
          candidateId,
          templateId: opts.templateId,
          startDate: opts.startDate,
          salary,
        }),
        getFormat(offersCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const membersCmd = program.command('members').description('Team members');

membersCmd.command('list').description('List members').action(async () => {
  try {
    print(await getClient().members.list(), getFormat(membersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const recruitersCmd = program.command('recruiters').description('Recruiters');

recruitersCmd.command('list').description('List recruiters').action(async () => {
  try {
    print(await getClient().members.listRecruiters(), getFormat(recruitersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const stagesCmd = program.command('stages').description('Pipeline stages');

stagesCmd.command('list').description('List stages').action(async () => {
  try {
    print(await getClient().stages.list(), getFormat(stagesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const metadataCmd = program.command('metadata').description('Account metadata');

metadataCmd.command('disqualification-reasons').description('List disqualification reasons').action(async () => {
  try {
    print(await getClient().metadata.listDisqualificationReasons(), getFormat(metadataCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

metadataCmd.command('departments').description('List departments').action(async () => {
  try {
    print(await getClient().metadata.listDepartments(), getFormat(metadataCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

metadataCmd.command('custom-attributes').description('List custom attributes').action(async () => {
  try {
    print(await getClient().metadata.listCustomAttributes(), getFormat(metadataCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const eventsCmd = program.command('events').description('Candidate events');

eventsCmd.command('list <candidateId>').description('List events').action(async (candidateId: string) => {
  try {
    print(await getClient().events.list(candidateId), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

eventsCmd
  .command('schedule <candidateId>')
  .description('Schedule an event')
  .requiredOption('--type <type>', 'Event type')
  .requiredOption('--start-at <iso>', 'Start time (ISO 8601)')
  .option('--duration <minutes>', 'Duration in minutes', parseInt)
  .option('--description <text>', 'Description')
  .option('--agenda <text>', 'Agenda')
  .action(async (candidateId: string, opts) => {
    try {
      print(
        await getClient().events.schedule({
          candidateId,
          type: opts.type,
          startAt: opts.startAt,
          durationMinutes: opts.duration,
          description: opts.description,
          agenda: opts.agenda,
        }),
        getFormat(eventsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
