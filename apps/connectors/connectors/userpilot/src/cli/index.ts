#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Userpilot } from '../api';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setProfileOverride,
  getConfigDir,
} from '../utils/config';
import { printOutput } from '../utils/output';

const program = new Command();

function getClient(): Userpilot {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(chalk.red('Error: Not authenticated. Run "connect-userpilot auth set-key <key>" first.'));
    process.exit(1);
  }
  return new Userpilot({ apiKey });
}

function parseJson(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    console.error(chalk.red(`Error: Invalid JSON for ${label}`));
    process.exit(1);
  }
}

function runAction(action: () => Promise<unknown>): void {
  action()
    .then((result) => printOutput(result))
    .catch((error: unknown) => {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

program
  .name('connect-userpilot')
  .description('Userpilot connector - Product onboarding and in-app analytics')
  .version('0.0.1')
  .option('--profile <name>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('set-key')
  .description('Set API key for the current profile')
  .argument('<key>', 'Userpilot API key')
  .action((key: string) => {
    setApiKey(key);
    console.log(chalk.green(`API key saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(() => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow('Not authenticated'));
      console.log(chalk.gray('Run "connect-userpilot auth set-key <key>" to authenticate'));
      return;
    }
    console.log(chalk.green('Authenticated'));
    console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`  API Key: ${chalk.white(apiKey.substring(0, 8) + '...')}`);
  });

authCmd
  .command('clear')
  .description('Clear stored credentials')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Credentials cleared'));
  });

const profileCmd = program.command('profile').description('Profile management');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    console.log(chalk.gray('No profiles configured'));
    return;
  }
  console.log(chalk.bold('Profiles:'));
  for (const profile of profiles) {
    const marker = profile === current ? chalk.green(' (active)') : '';
    console.log(`  ${profile}${marker}`);
  }
});

profileCmd
  .command('use')
  .argument('<name>')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      console.log(chalk.green(`Switched to profile "${name}"`));
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('create')
  .argument('<name>')
  .action((name: string) => {
    if (createProfile(name)) {
      console.log(chalk.green(`Profile "${name}" created`));
    } else {
      console.log(chalk.yellow(`Profile "${name}" already exists`));
    }
  });

profileCmd
  .command('delete')
  .argument('<name>')
  .action((name: string) => {
    if (deleteProfile(name)) {
      console.log(chalk.green(`Profile "${name}" deleted`));
    } else {
      console.log(chalk.yellow(`Cannot delete profile "${name}"`));
    }
  });

profileCmd.command('show').action(() => {
  console.log(`Current profile: ${chalk.cyan(getCurrentProfile())}`);
  console.log(`Config directory: ${chalk.gray(getConfigDir())}`);
});

const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('identify')
  .requiredOption('-u, --user <id>', 'User ID')
  .option('-m, --metadata <json>', 'User metadata JSON')
  .option('-c, --company <json>', 'Company metadata JSON')
  .action((options) => {
    runAction(() =>
      getClient().users.identify({
        user_id: options.user,
        metadata: options.metadata ? parseJson(options.metadata, 'metadata') : undefined,
        company: options.company ? parseJson(options.company, 'company') : undefined,
      }),
    );
  });

usersCmd
  .command('track')
  .requiredOption('-u, --user <id>', 'User ID')
  .requiredOption('-e, --event <name>', 'Event name')
  .option('-m, --metadata <json>', 'Event metadata JSON')
  .action((options) => {
    runAction(() =>
      getClient().users.track({
        user_id: options.user,
        event_name: options.event,
        metadata: options.metadata ? parseJson(options.metadata, 'metadata') : undefined,
      }),
    );
  });

usersCmd
  .command('group')
  .requiredOption('-u, --user <id>', 'User ID')
  .requiredOption('-c, --company <id>', 'Company ID')
  .option('-m, --metadata <json>', 'Metadata JSON')
  .action((options) => {
    runAction(() =>
      getClient().users.group({
        user_id: options.user,
        company_id: options.company,
        metadata: options.metadata ? parseJson(options.metadata, 'metadata') : undefined,
      }),
    );
  });

usersCmd
  .command('list')
  .option('-p, --page <n>', 'Page number')
  .option('--per-page <n>', 'Results per page')
  .option('-q, --query <text>', 'Search query')
  .action((options) => {
    runAction(() =>
      getClient().users.list({
        page: options.page ? Number(options.page) : undefined,
        per_page: options.perPage ? Number(options.perPage) : undefined,
        q: options.query,
      }),
    );
  });

usersCmd
  .command('get')
  .argument('<userId>')
  .action((userId: string) => {
    runAction(() => getClient().users.get(userId));
  });

usersCmd
  .command('delete')
  .argument('<userId>')
  .action((userId: string) => {
    runAction(() => getClient().users.delete(userId));
  });

const companiesCmd = program.command('companies').description('Company operations');

companiesCmd
  .command('list')
  .option('-p, --page <n>', 'Page number')
  .option('--per-page <n>', 'Results per page')
  .option('-q, --query <text>', 'Search query')
  .action((options) => {
    runAction(() =>
      getClient().companies.list({
        page: options.page ? Number(options.page) : undefined,
        per_page: options.perPage ? Number(options.perPage) : undefined,
        q: options.query,
      }),
    );
  });

companiesCmd
  .command('get')
  .argument('<companyId>')
  .action((companyId: string) => {
    runAction(() => getClient().companies.get(companyId));
  });

companiesCmd
  .command('delete')
  .argument('<companyId>')
  .action((companyId: string) => {
    runAction(() => getClient().companies.delete(companyId));
  });

const experiencesCmd = program.command('experiences').description('Experience operations');

experiencesCmd
  .command('list')
  .option('--type <type>', 'Experience type')
  .option('--status <status>', 'Status filter')
  .option('-p, --page <n>', 'Page number')
  .action((options) => {
    runAction(() =>
      getClient().experiences.list({
        type: options.type,
        status: options.status,
        page: options.page ? Number(options.page) : undefined,
      }),
    );
  });

experiencesCmd
  .command('get')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().experiences.get(id));
  });

experiencesCmd
  .command('analytics')
  .argument('<id>')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--segment <id>', 'Segment ID')
  .action((id: string, options) => {
    runAction(() =>
      getClient().experiences.analytics(id, {
        from: options.from,
        to: options.to,
        segment_id: options.segment,
      }),
    );
  });

program
  .command('flows')
  .description('List flows')
  .option('--status <status>', 'Status filter')
  .option('-p, --page <n>', 'Page number')
  .action((options) => {
    runAction(() =>
      getClient().flows.list({
        status: options.status,
        page: options.page ? Number(options.page) : undefined,
      }),
    );
  });

program
  .command('flow')
  .argument('<id>')
  .description('Get a flow by ID')
  .action((id: string) => {
    runAction(() => getClient().flows.get(id));
  });

program
  .command('checklists')
  .description('List checklists')
  .option('--status <status>', 'Status filter')
  .action((options) => {
    runAction(() => getClient().checklists.list({ status: options.status }));
  });

program
  .command('checklist')
  .argument('<id>')
  .description('Get checklist by ID')
  .action((id: string) => {
    runAction(() => getClient().checklists.get(id));
  });

program
  .command('resource-centers')
  .description('List resource centers')
  .action(() => {
    runAction(() => getClient().resourceCenters.list());
  });

const surveysCmd = program.command('surveys').description('Survey operations');

surveysCmd.command('list').option('--status <status>', 'Status filter').action((options) => {
  runAction(() => getClient().surveys.list({ status: options.status }));
});

surveysCmd
  .command('get')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().surveys.get(id));
  });

surveysCmd
  .command('responses')
  .argument('<id>')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .action((id: string, options) => {
    runAction(() => getClient().surveys.responses(id, { from: options.from, to: options.to }));
  });

const segmentsCmd = program.command('segments').description('Segment operations');

segmentsCmd
  .command('list')
  .option('--type <type>', 'user or company')
  .action((options) => {
    runAction(() => getClient().segments.list({ type: options.type }));
  });

segmentsCmd
  .command('get')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().segments.get(id));
  });

segmentsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Segment name')
  .requiredOption('-t, --type <type>', 'user or company')
  .requiredOption('-c, --conditions <json>', 'Conditions JSON')
  .action((options) => {
    runAction(() =>
      getClient().segments.create({
        name: options.name,
        type: options.type,
        conditions: parseJson(options.conditions, 'conditions'),
      }),
    );
  });

segmentsCmd
  .command('delete')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().segments.delete(id));
  });

const goalsCmd = program.command('goals').description('Goal operations');

goalsCmd.command('list').action(() => {
  runAction(() => getClient().goals.list());
});

goalsCmd
  .command('get')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().goals.get(id));
  });

goalsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Goal name')
  .requiredOption('-r, --rule <json>', 'Rule JSON')
  .option('-d, --description <text>', 'Description')
  .action((options) => {
    runAction(() =>
      getClient().goals.create({
        name: options.name,
        rule: parseJson(options.rule, 'rule'),
        description: options.description,
      }),
    );
  });

goalsCmd
  .command('delete')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().goals.delete(id));
  });

program
  .command('events')
  .description('List tracked events')
  .option('-q, --query <text>', 'Search query')
  .action((options) => {
    runAction(() => getClient().events.list({ q: options.query }));
  });

program
  .command('event')
  .argument('<id>')
  .description('Get event by ID')
  .action((id: string) => {
    runAction(() => getClient().events.get(id));
  });

program
  .command('feature-tags')
  .description('List feature tags')
  .action(() => {
    runAction(() => getClient().featureTags.list());
  });

program
  .command('attributes')
  .description('List attributes')
  .option('--type <type>', 'user or company')
  .action((options) => {
    runAction(() => getClient().attributes.list({ type: options.type }));
  });

const webhooksCmd = program.command('webhooks').description('Webhook operations');

webhooksCmd.command('list').action(() => {
  runAction(() => getClient().webhooks.list());
});

webhooksCmd
  .command('create')
  .requiredOption('-u, --url <url>', 'Webhook URL')
  .requiredOption('-e, --events <types>', 'Comma-separated event types')
  .option('--secret <secret>', 'Webhook secret')
  .action((options) => {
    runAction(() =>
      getClient().webhooks.create({
        url: options.url,
        event_types: options.events.split(',').map((s: string) => s.trim()),
        secret: options.secret,
      }),
    );
  });

webhooksCmd
  .command('delete')
  .argument('<id>')
  .action((id: string) => {
    runAction(() => getClient().webhooks.delete(id));
  });

program.parse();
