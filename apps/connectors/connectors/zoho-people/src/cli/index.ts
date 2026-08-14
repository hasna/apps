#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoPeople } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
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

const CONNECTOR_NAME = 'zoho-people';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho People HR API connector — employees, leave, attendance, timesheets')
  .version(VERSION)
  .option('-k, --token <token>', 'OAuth access token (overrides config)')
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

    if (opts.token) {
      process.env.ZOHOPEOPLE_TOKEN = opts.token;
      debug('Token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoPeople {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOPEOPLE_TOKEN.`);
    process.exit(1);
  }
  return new ZohoPeople({
    token,
    dataCenter: getDataCenter(),
    baseUrl: process.env.ZOHOPEOPLE_BASE_URL,
  });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) {
    error(`${label} JSON is required`);
    process.exit(1);
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
  profiles.forEach((p) => {
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
  .option('--token <token>', 'OAuth access token')
  .option('--data-center <dc>', 'Data center (com, eu, in, ...)')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { token: opts.token, dataCenter: opts.dataCenter });
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
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || 'com'}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set OAuth access token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-data-center <dc>').description('Set data center (com, eu, in, ...)').action((dc: string) => {
  setDataCenter(dc);
  success(`Data center saved: ${dc}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter()}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const employeeCmd = program.command('employee').description('Employee operations');

employeeCmd.command('list').description('List employees')
  .option('--s-index <n>', 'Start index', parseInt)
  .option('--limit <n>', 'Page size', parseInt)
  .option('--modified-time <time>', 'Modified time filter')
  .action(async (opts) => {
    try {
      const result = await getClient().listEmployees({
        sIndex: opts.sIndex,
        limit: opts.limit,
        modifiedTime: opts.modifiedTime,
      });
      print(result, getFormat(employeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

employeeCmd.command('get <recordId>').description('Get employee by record ID').action(async (recordId: string) => {
  try {
    print(await getClient().getEmployee(recordId), getFormat(employeeCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

employeeCmd.command('get-by-email <email>').description('Get employee by email').action(async (email: string) => {
  try {
    print(await getClient().getEmployeeByEmail(email), getFormat(employeeCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

employeeCmd.command('add').description('Add employee')
  .requiredOption('--input-data <json>', 'Employee fields JSON (inputData)')
  .action(async (opts) => {
    try {
      print(await getClient().addEmployee(parseJsonOption(opts.inputData, 'inputData')), getFormat(employeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

employeeCmd.command('update <recordId>').description('Update employee')
  .requiredOption('--input-data <json>', 'Employee fields JSON (inputData)')
  .action(async (recordId: string, opts) => {
    try {
      print(await getClient().updateEmployee(recordId, parseJsonOption(opts.inputData, 'inputData')), getFormat(employeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const leaveCmd = program.command('leave').description('Leave operations');

leaveCmd.command('list').description('List leave records')
  .option('--s-index <n>', 'Start index', parseInt)
  .option('--limit <n>', 'Page size', parseInt)
  .option('--modified-time <time>', 'Modified time filter')
  .action(async (opts) => {
    try {
      print(await getClient().listLeaves(opts), getFormat(leaveCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leaveCmd.command('balance <userId>').description('Get leave balance for user').action(async (userId: string) => {
  try {
    print(await getClient().listLeaveBalance(userId), getFormat(leaveCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

leaveCmd.command('apply').description('Apply for leave')
  .requiredOption('--input-data <json>', 'Leave fields JSON (inputData)')
  .action(async (opts) => {
    try {
      print(await getClient().applyLeave(parseJsonOption(opts.inputData, 'inputData')), getFormat(leaveCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leaveCmd.command('approve <recordId>').description('Approve leave request').action(async (recordId: string) => {
  try {
    print(await getClient().approveLeave(recordId), getFormat(leaveCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

leaveCmd.command('cancel <recordId>').description('Cancel leave request')
  .option('--reason <reason>', 'Cancellation reason')
  .action(async (recordId: string, opts) => {
    try {
      print(await getClient().cancelLeave(recordId, opts.reason), getFormat(leaveCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const attendanceCmd = program.command('attendance').description('Attendance operations');

attendanceCmd.command('report').description('Get attendance report')
  .requiredOption('--start <date>', 'Start date (sDate)')
  .requiredOption('--end <date>', 'End date (eDate)')
  .option('--user-id <id>', 'User ID')
  .option('--erecno <erecno>', 'Employee record number')
  .action(async (opts) => {
    try {
      print(await getClient().getAttendance({
        sDate: opts.start,
        eDate: opts.end,
        userId: opts.userId,
        erecno: opts.erecno,
      }), getFormat(attendanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

attendanceCmd.command('check-in').description('Check in')
  .option('--emp-id <id>', 'Employee ID')
  .option('--mode <mode>', 'WEB or MOBILE')
  .action(async (opts) => {
    try {
      print(await getClient().checkIn({ empId: opts.empId, mode: opts.mode }), getFormat(attendanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

attendanceCmd.command('check-out').description('Check out')
  .option('--emp-id <id>', 'Employee ID')
  .option('--mode <mode>', 'WEB or MOBILE')
  .action(async (opts) => {
    try {
      print(await getClient().checkOut({ empId: opts.empId, mode: opts.mode }), getFormat(attendanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

attendanceCmd.command('on-duty').description('List on-duty records')
  .requiredOption('--start <date>', 'Start date')
  .requiredOption('--end <date>', 'End date')
  .option('--user-id <id>', 'User ID')
  .action(async (opts) => {
    try {
      print(await getClient().listOnDuty({ sDate: opts.start, eDate: opts.end, userId: opts.userId }), getFormat(attendanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const timesheetCmd = program.command('timesheet').description('Timesheet operations');

timesheetCmd.command('list').description('List timesheet entries')
  .option('--s-index <n>', 'Start index', parseInt)
  .option('--limit <n>', 'Page size', parseInt)
  .action(async (opts) => {
    try {
      print(await getClient().listTimesheets(opts), getFormat(timesheetCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timesheetCmd.command('add').description('Add timesheet entry')
  .requiredOption('--job-id <id>', 'Job ID')
  .requiredOption('--work-date <date>', 'Work date')
  .requiredOption('--hours <hours>', 'Hours worked')
  .option('--billing-status <status>', 'Billable or Non Billable')
  .option('--description <text>', 'Description')
  .action(async (opts) => {
    try {
      print(await getClient().addTimesheet({
        jobId: opts.jobId,
        workDate: opts.workDate,
        hours: opts.hours,
        billingStatus: opts.billingStatus,
        description: opts.description,
      }), getFormat(timesheetCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timesheetCmd.command('jobs').description('List jobs').action(async () => {
  try {
    print(await getClient().listJobs(), getFormat(timesheetCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

timesheetCmd.command('clients').description('List clients').action(async () => {
  try {
    print(await getClient().listClients(), getFormat(timesheetCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const orgCmd = program.command('org').description('Organization operations');

orgCmd.command('details').description('Get organization details').action(async () => {
  try {
    print(await getClient().getOrganizationDetails(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('departments').description('List departments').action(async () => {
  try {
    print(await getClient().listDepartments(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('designations').description('List designations').action(async () => {
  try {
    print(await getClient().listDesignations(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('locations').description('List locations').action(async () => {
  try {
    print(await getClient().listLocations(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('forms').description('List forms').action(async () => {
  try {
    print(await getClient().listForms(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('form-fields <formName>').description('Get form field definitions').action(async (formName: string) => {
  try {
    print(await getClient().getFormFields(formName), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('announcements').description('List announcements').action(async () => {
  try {
    print(await getClient().listAnnouncements(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
