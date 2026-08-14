#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TensorBoard } from '../api';
import { getBaseUrl, setBaseUrl, clearConfig, DEFAULT_BASE_URL } from '../utils/config';
import type { OutputFormat } from '../types';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-tensorboard';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TensorBoard training-run metrics and scalars CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || cmd.opts().format || 'pretty') as OutputFormat;
}

function connector(): TensorBoard {
  return new TensorBoard({ baseUrl: getBaseUrl() });
}

// ── Config ────────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-base-url <url>')
  .description('Set the TensorBoard server base URL (e.g. http://localhost:6006)')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to: ${url}`);
  });

configCmd.command('show')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.bold('TensorBoard Configuration:'));
    info(`Base URL: ${getBaseUrl()}`);
    info(`Default:  ${DEFAULT_BASE_URL}`);
    info('Note: TensorBoard\'s data API is read-only and requires no authentication.');
  });

configCmd.command('clear')
  .description('Clear saved configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ── Runs ──────────────────────────────────────────────────────────────────
program.command('runs')
  .description('List training runs on the TensorBoard server')
  .action(async (opts, cmd: Command) => {
    try {
      const runs = await connector().listRuns();
      if (getFormat(program) === 'json') {
        print(runs, 'json');
      } else {
        info(`${runs.length} run(s) at ${getBaseUrl()}`);
        for (const run of runs) {
          console.log(`  ${chalk.cyan(run.name)}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ── Tags ──────────────────────────────────────────────────────────────────
program.command('tags')
  .description('List scalar tags, optionally filtered to a run')
  .option('-r, --run <run>', 'Restrict to a single run')
  .action(async (opts) => {
    try {
      const tags = await connector().listScalarTags(opts.run);
      if (getFormat(program) === 'json') {
        print(tags, 'json');
      } else {
        info(`${tags.length} scalar tag(s)${opts.run ? ` for run "${opts.run}"` : ''}`);
        for (const tag of tags) {
          const label = tag.displayName && tag.displayName !== tag.tag ? ` (${tag.displayName})` : '';
          console.log(`  ${chalk.cyan(tag.run)} ${chalk.gray('·')} ${chalk.bold(tag.tag)}${label}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ── Scalars ───────────────────────────────────────────────────────────────
program.command('scalars')
  .description('Fetch a scalar time series for a run/tag pair')
  .requiredOption('-r, --run <run>', 'Run name')
  .requiredOption('-t, --tag <tag>', 'Scalar tag (e.g. loss, accuracy)')
  .action(async (opts) => {
    try {
      const points = await connector().getScalars(opts.run, opts.tag);
      if (getFormat(program) === 'json') {
        print(points, 'json');
      } else {
        info(`${points.length} point(s) for ${chalk.bold(opts.tag)} in run ${chalk.cyan(opts.run)}`);
        console.log(chalk.gray('  step        value            wall_time'));
        for (const p of points) {
          const step = String(p.step).padEnd(10);
          const value = String(p.value).padEnd(16);
          const when = new Date(p.wallTime * 1000).toISOString();
          console.log(`  ${step}  ${value}  ${chalk.gray(when)}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ── Environment ───────────────────────────────────────────────────────────
program.command('env')
  .description('Show TensorBoard server/experiment metadata')
  .action(async () => {
    try {
      const env = await connector().environment();
      print(env, getFormat(program) === 'json' ? 'json' : 'pretty');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
