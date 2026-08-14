#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoBookings } from '../api';
import {
  getToken,
  setToken,
  getBaseUrl,
  setBaseUrl,
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

const CONNECTOR_NAME = 'zohobookings';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Bookings connector — workspaces, services, appointments, customers')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
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
    if (opts.token) process.env.ZOHOBOOKINGS_TOKEN = opts.token;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoBookings {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOBOOKINGS_TOKEN.`);
    process.exit(1);
  }
  return new ZohoBookings({ token, baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--token <token>', 'OAuth token').option('--use', 'Switch after create').action((name: string, opts: { token?: string; use?: boolean }) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { token: opts.token });
  success(`Profile "${name}" created`);
  if (opts.use) setCurrentProfile(name);
});

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token: ${config.token ? `${config.token.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const token = getToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://www.zohoapis.com)')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const workspacesCmd = program.command('workspaces').description('Workspace commands');

workspacesCmd.command('list').option('--workspace-id <id>', 'Filter by workspace ID').action(async (opts: { workspaceId?: string }) => {
  try {
    const result = await getClient().listWorkspaces(opts.workspaceId);
    print(result, getFormat(workspacesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const servicesCmd = program.command('services').description('Service commands');

servicesCmd
  .command('list')
  .requiredOption('--workspace-id <id>', 'Workspace ID')
  .option('--service-id <id>', 'Filter by service ID')
  .option('--staff-id <id>', 'Filter by staff ID')
  .action(async (opts: { workspaceId: string; serviceId?: string; staffId?: string }) => {
    try {
      const result = await getClient().listServices({
        workspace_id: opts.workspaceId,
        service_id: opts.serviceId,
        staff_id: opts.staffId,
      });
      print(result, getFormat(servicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const staffCmd = program.command('staff').description('Staff commands');

staffCmd
  .command('list')
  .requiredOption('--workspace-id <id>', 'Workspace ID')
  .option('--staff-id <id>', 'Filter by staff ID')
  .option('--service-id <id>', 'Filter by service ID')
  .action(async (opts: { workspaceId: string; staffId?: string; serviceId?: string }) => {
    try {
      const result = await getClient().listStaff({
        workspace_id: opts.workspaceId,
        staff_id: opts.staffId,
        service_id: opts.serviceId,
      });
      print(result, getFormat(staffCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const appointmentsCmd = program.command('appointments').description('Appointment commands');

appointmentsCmd
  .command('list')
  .requiredOption('--from <time>', 'Start time (dd-MMM-yyyy HH:mm:ss)')
  .requiredOption('--to <time>', 'End time (dd-MMM-yyyy HH:mm:ss)')
  .option('--status <status>', 'UPCOMING, CANCEL, COMPLETED, etc.')
  .option('--service-id <id>', 'Filter by service')
  .option('--staff-id <id>', 'Filter by staff')
  .action(async (opts: { from: string; to: string; status?: string; serviceId?: string; staffId?: string }) => {
    try {
      const result = await getClient().fetchAppointments({
        from_time: opts.from,
        to_time: opts.to,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.serviceId ? { service_id: opts.serviceId } : {}),
        ...(opts.staffId ? { staff_id: opts.staffId } : {}),
      });
      print(result, getFormat(appointmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

appointmentsCmd.command('get <bookingId>').action(async (bookingId: string) => {
  try {
    const result = await getClient().getAppointment(bookingId);
    print(result, getFormat(appointmentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

appointmentsCmd
  .command('book')
  .requiredOption('--service-id <id>', 'Service ID')
  .requiredOption('--staff-id <id>', 'Staff ID')
  .requiredOption('--from-time <time>', 'Start time (dd-MMM-yyyy HH:mm:ss)')
  .requiredOption('--name <name>', 'Customer name')
  .option('--email <email>', 'Customer email')
  .option('--phone <phone>', 'Customer phone')
  .option('--timezone <tz>', 'Timezone')
  .option('--notes <notes>', 'Appointment notes')
  .action(async (opts: { serviceId: string; staffId: string; fromTime: string; name: string; email?: string; phone?: string; timezone?: string; notes?: string }) => {
    try {
      const result = await getClient().bookAppointment({
        service_id: opts.serviceId,
        staff_id: opts.staffId,
        from_time: opts.fromTime,
        time_zone: opts.timezone,
        notes: opts.notes,
        customer_details: {
          name: opts.name,
          ...(opts.email ? { email: opts.email } : {}),
          ...(opts.phone ? { phone_number: opts.phone } : {}),
        },
      });
      success('Appointment booked');
      print(result, getFormat(appointmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

appointmentsCmd.command('cancel <bookingId>').action(async (bookingId: string) => {
  try {
    const result = await getClient().cancelAppointment(bookingId);
    success('Appointment cancelled');
    print(result, getFormat(appointmentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const customersCmd = program.command('customers').description('Customer commands');

customersCmd.command('list').action(async () => {
  try {
    const result = await getClient().listCustomers();
    print(result, getFormat(customersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

customersCmd
  .command('create')
  .requiredOption('--name <name>', 'Customer name')
  .option('--email <email>', 'Customer email')
  .option('--phone <phone>', 'Customer phone')
  .action(async (opts: { name: string; email?: string; phone?: string }) => {
    try {
      const result = await getClient().createCustomer([
        {
          name: opts.name,
          ...(opts.email ? { email: opts.email } : {}),
          ...(opts.phone ? { contact_number: opts.phone } : {}),
        },
      ]);
      success('Customer created');
      print(result, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
