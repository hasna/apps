#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StackExchange } from '../api';
import { resolveClientConfig, getSite, setSite, getPageSize, setPageSize, clearConfig } from '../utils/config';
import { success, error, info, print, fmtDate } from '../utils/output';
import type { OutputFormat, Question, Answer, User, Tag } from '../types';

const CONNECTOR_NAME = 'connect-stackexchange';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stack Exchange Q&A search and retrieval CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-s, --site <site>', 'Stack Exchange site (e.g. stackoverflow, superuser)');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || cmd.opts().format || 'pretty') as OutputFormat;
}

function connector(cmd: Command): StackExchange {
  const site = (cmd.parent?.opts().site || program.opts().site) as string | undefined;
  return new StackExchange({ ...resolveClientConfig(), ...(site ? { site } : {}) });
}

function pageOpts(opts: { page?: string; size?: string; sort?: string; order?: string }) {
  return {
    page: opts.page ? parseInt(opts.page, 10) : undefined,
    pageSize: opts.size ? parseInt(opts.size, 10) : getPageSize(),
    sort: opts.sort,
    order: opts.order as 'asc' | 'desc' | undefined,
  };
}

function quotaLine(quotaRemaining: number, quotaMax: number): void {
  console.log(chalk.gray(`  quota: ${quotaRemaining}/${quotaMax} remaining`));
}

function printQuestions(items: Question[]): void {
  for (const q of items) {
    console.log();
    console.log(chalk.bold(q.title));
    console.log(chalk.gray(`  #${q.question_id} | score ${q.score} | ${q.answer_count} answers | ${q.view_count} views | ${fmtDate(q.creation_date)}`));
    if (q.tags?.length) console.log(chalk.cyan(`  tags: ${q.tags.join(', ')}`));
    console.log(chalk.gray(`  ${q.is_answered ? '✓ answered' : '○ unanswered'}${q.accepted_answer_id ? ' (accepted)' : ''} | by ${q.owner?.display_name || 'unknown'}`));
    console.log(chalk.blue(`  ${q.link}`));
  }
}

function printAnswers(items: Answer[]): void {
  for (const a of items) {
    console.log();
    console.log(chalk.bold(`Answer #${a.answer_id}${a.title ? ` — ${a.title}` : ''}`));
    console.log(chalk.gray(`  question #${a.question_id} | score ${a.score}${a.is_accepted ? ' | ✓ accepted' : ''} | ${fmtDate(a.creation_date)}`));
    console.log(chalk.cyan(`  by ${a.owner?.display_name || 'unknown'}`));
    if (a.link) console.log(chalk.blue(`  ${a.link}`));
  }
}

function printUsers(items: User[]): void {
  for (const u of items) {
    console.log();
    console.log(chalk.bold(u.display_name));
    console.log(chalk.gray(`  #${u.user_id} | reputation ${u.reputation}${u.location ? ` | ${u.location}` : ''} | joined ${fmtDate(u.creation_date)}`));
    if (u.badge_counts) console.log(chalk.yellow(`  badges: ${u.badge_counts.gold}🥇 ${u.badge_counts.silver}🥈 ${u.badge_counts.bronze}🥉`));
    console.log(chalk.blue(`  ${u.link}`));
  }
}

function printTags(items: Tag[]): void {
  for (const t of items) {
    console.log(`${chalk.bold(t.name.padEnd(24))} ${chalk.gray(`${t.count} questions`)}`);
  }
}

function handleErr(err: unknown): never {
  error(String(err));
  process.exit(1);
}

// --- Config commands ---
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-site <site>')
  .description('Set default Stack Exchange site (e.g. stackoverflow)')
  .action((site: string) => {
    setSite(site);
    success(`Default site set to: ${site}`);
  });

configCmd.command('set-page-size <n>')
  .description('Set default page size')
  .action((n: string) => {
    setPageSize(parseInt(n, 10));
    success(`Default page size set to: ${n}`);
  });

configCmd.command('show')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.bold('Stack Exchange Configuration:'));
    info(`Site: ${getSite()}`);
    info(`Page size: ${getPageSize()}`);
    info(`App key: ${process.env.STACKEXCHANGE_KEY ? chalk.green('set (env)') : chalk.gray('not set')}`);
    info(`Access token: ${process.env.STACKEXCHANGE_ACCESS_TOKEN ? chalk.green('set (env)') : chalk.gray('not set')}`);
    info('Read endpoints work without a key; a key raises the daily quota.');
  });

configCmd.command('clear')
  .description('Clear all local configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// --- Questions ---
program.command('questions')
  .description('List questions on the site')
  .option('-p, --page <n>', 'Page number')
  .option('-n, --size <n>', 'Page size')
  .option('--sort <field>', 'Sort by: activity, votes, creation, hot, week, month', 'activity')
  .option('--order <order>', 'Sort order: asc, desc', 'desc')
  .action(async (opts, cmd) => {
    try {
      const res = await connector(cmd).listQuestions(pageOpts(opts));
      if (getFormat(program) === 'json') return print(res, 'json');
      info(`Questions (page ${res.page ?? 1}, ${res.items.length} shown, has_more=${res.has_more})`);
      printQuestions(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

program.command('get-question <id>')
  .description('Get one or more questions by id (semicolon-separated)')
  .action(async (id: string, cmd) => {
    try {
      const res = await connector(cmd).getQuestions(id.split(';'));
      if (getFormat(program) === 'json') return print(res, 'json');
      if (!res.items.length) return info('No questions found');
      printQuestions(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

program.command('search <query>')
  .description('Full-text search for questions')
  .option('-t, --title <text>', 'Match text in the title only')
  .option('--tagged <tags>', 'Comma-separated tags (all required)')
  .option('--accepted', 'Only questions with an accepted answer')
  .option('--no-answers', 'Only questions with zero answers')
  .option('-p, --page <n>', 'Page number')
  .option('-n, --size <n>', 'Page size')
  .option('--sort <field>', 'Sort by: relevance, activity, votes, creation', 'relevance')
  .option('--order <order>', 'Sort order: asc, desc', 'desc')
  .action(async (query: string, opts, cmd) => {
    try {
      const res = await connector(cmd).searchQuestions({
        ...pageOpts(opts),
        query,
        inTitle: opts.title,
        tagged: opts.tagged ? String(opts.tagged).split(',').map((t: string) => t.trim()).filter(Boolean) : undefined,
        accepted: opts.accepted || undefined,
        // commander sets opts.answers=false when --no-answers is passed
        noAnswers: opts.answers === false || undefined,
      });
      if (getFormat(program) === 'json') return print(res, 'json');
      info(`Search results for "${query}" (${res.items.length} shown, has_more=${res.has_more})`);
      printQuestions(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

// --- Answers ---
program.command('answers')
  .description('List answers on the site')
  .option('-p, --page <n>', 'Page number')
  .option('-n, --size <n>', 'Page size')
  .option('--sort <field>', 'Sort by: activity, votes, creation', 'activity')
  .option('--order <order>', 'Sort order: asc, desc', 'desc')
  .action(async (opts, cmd) => {
    try {
      const res = await connector(cmd).listAnswers(pageOpts(opts));
      if (getFormat(program) === 'json') return print(res, 'json');
      info(`Answers (${res.items.length} shown, has_more=${res.has_more})`);
      printAnswers(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

program.command('question-answers <id>')
  .description('List answers for a given question id')
  .option('-p, --page <n>', 'Page number')
  .option('-n, --size <n>', 'Page size')
  .option('--sort <field>', 'Sort by: votes, activity, creation', 'votes')
  .option('--order <order>', 'Sort order: asc, desc', 'desc')
  .action(async (id: string, opts, cmd) => {
    try {
      const res = await connector(cmd).getQuestionAnswers(id, pageOpts(opts));
      if (getFormat(program) === 'json') return print(res, 'json');
      info(`Answers for question #${id} (${res.items.length} shown)`);
      printAnswers(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

// --- Users ---
program.command('users')
  .description('List users on the site')
  .option('--name <text>', 'Filter by (partial) display name')
  .option('-p, --page <n>', 'Page number')
  .option('-n, --size <n>', 'Page size')
  .option('--sort <field>', 'Sort by: reputation, creation, name, modified', 'reputation')
  .option('--order <order>', 'Sort order: asc, desc', 'desc')
  .action(async (opts, cmd) => {
    try {
      const res = await connector(cmd).listUsers({ ...pageOpts(opts), inName: opts.name });
      if (getFormat(program) === 'json') return print(res, 'json');
      info(`Users (${res.items.length} shown, has_more=${res.has_more})`);
      printUsers(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

program.command('get-user <id>')
  .description('Get one or more users by id (semicolon-separated)')
  .action(async (id: string, cmd) => {
    try {
      const res = await connector(cmd).getUsers(id.split(';'));
      if (getFormat(program) === 'json') return print(res, 'json');
      if (!res.items.length) return info('No users found');
      printUsers(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

// --- Tags ---
program.command('tags')
  .description('List tags on the site')
  .option('--name <text>', 'Filter by (partial) tag name')
  .option('-p, --page <n>', 'Page number')
  .option('-n, --size <n>', 'Page size')
  .option('--sort <field>', 'Sort by: popular, activity, name', 'popular')
  .option('--order <order>', 'Sort order: asc, desc', 'desc')
  .action(async (opts, cmd) => {
    try {
      const res = await connector(cmd).listTags({ ...pageOpts(opts), inName: opts.name });
      if (getFormat(program) === 'json') return print(res, 'json');
      info(`Tags (${res.items.length} shown, has_more=${res.has_more})`);
      printTags(res.items);
      quotaLine(res.quota_remaining, res.quota_max);
    } catch (err) { handleErr(err); }
  });

program.parse();
