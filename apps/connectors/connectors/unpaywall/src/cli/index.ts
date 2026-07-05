#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Unpaywall } from '../api';
import { getEmail, setEmail, clearConfig, getEmailPreview } from '../utils/config';
import type { OutputFormat } from '../types';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-unpaywall';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Unpaywall open-access DOI lookup and search CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || cmd.opts().format || 'pretty') as OutputFormat;
}

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-email <email>')
  .description('Set email for Unpaywall API authentication')
  .action((email: string) => {
    setEmail(email);
    success(`Email set to: ${getEmailPreview()}`);
  });

configCmd.command('show')
  .description('Show current configuration')
  .action(() => {
    const preview = getEmailPreview();
    console.log(chalk.bold('Unpaywall Configuration:'));
    info(`Email: ${preview || chalk.gray('not set')}`);
    info(`Set via UNPAYWALL_EMAIL env var or "config set-email <email>"`);
  });

configCmd.command('clear')
  .description('Clear saved configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

program.command('get <doi>')
  .description('Get OA status and bibliographic info for a DOI (e.g., 10.1038/nature12373)')
  .action(async (doi: string) => {
    try {
      const unpaywall = new Unpaywall();
      const result = await unpaywall.getDoi(doi);

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(result.title || result.doi));
        console.log();
        console.log(chalk.cyan(`DOI:        ${result.doi}`));
        console.log(chalk.cyan(`OA Status:  ${result.oa_status} (is_oa: ${result.is_oa})`));
        if (result.journal_name) console.log(chalk.cyan(`Journal:    ${result.journal_name}`));
        if (result.publisher) console.log(chalk.cyan(`Publisher:  ${result.publisher}`));
        if (result.published_date) console.log(chalk.cyan(`Published:  ${result.published_date}`));
        if (result.year) console.log(chalk.cyan(`Year:       ${result.year}`));
        if (result.best_oa_location?.url) {
          console.log(chalk.blue(`Best OA:    ${result.best_oa_location.url}`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('search <query>')
  .description('Search articles by title query')
  .option('--oa <value>', 'Filter by OA status (true or false)')
  .option('--page <number>', 'Page number (50 results per page)', '1')
  .action(async (query: string, opts) => {
    try {
      const unpaywall = new Unpaywall();
      const isOa = opts.oa !== undefined ? opts.oa === 'true' : undefined;
      const page = parseInt(opts.page, 10);

      const result = await unpaywall.search(query, { isOa, page });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        info(`Found ${result.results.length} results (page ${page})`);
        for (const match of result.results) {
          console.log();
          const title = match.response.title || match.response.doi;
          console.log(chalk.bold(title));
          console.log(chalk.gray(`  score: ${match.score.toFixed(2)} | ${match.response.oa_status} | ${match.response.doi}`));
          if (match.response.best_oa_location?.url) {
            console.log(chalk.blue(`  ${match.response.best_oa_location.url}`));
          }
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
