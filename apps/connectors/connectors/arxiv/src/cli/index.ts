#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { Arxiv } from '../api';
import { getDefaultCategory, setDefaultCategory, getMaxResults, setMaxResults, getOutputDir, setOutputDir, clearConfig } from '../utils/config';
import type { OutputFormat } from '../types';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-arxiv';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('arXiv research paper search and retrieval CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || cmd.opts().format || 'pretty') as OutputFormat;
}

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-category <category>')
  .description('Set default arXiv category (e.g., cs.AI, cs.LG)')
  .action((category: string) => {
    setDefaultCategory(category);
    success(`Default category set to: ${category}`);
  });

configCmd.command('set-max-results <n>')
  .description('Set default max results')
  .action((n: string) => {
    setMaxResults(parseInt(n, 10));
    success(`Default max results set to: ${n}`);
  });

configCmd.command('set-output-dir <dir>')
  .description('Set default output directory for PDF downloads')
  .action((dir: string) => {
    setOutputDir(dir);
    success(`Output directory set to: ${dir}`);
  });

configCmd.command('show')
  .description('Show current configuration')
  .action(() => {
    const category = getDefaultCategory();
    const maxResults = getMaxResults();
    const outputDir = getOutputDir();
    console.log(chalk.bold('arXiv Configuration:'));
    info(`Default category: ${category || chalk.gray('not set')}`);
    info(`Max results: ${maxResults}`);
    info(`Output directory: ${outputDir}`);
    info(`Note: arXiv API is free — no API key required.`);
  });

configCmd.command('clear')
  .description('Clear all configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// Search command
program.command('search <query>')
  .description('Search papers by query')
  .option('-c, --category <category>', 'Filter by category (e.g., cs.AI, cs.LG)')
  .option('-n, --max <number>', 'Maximum results')
  .option('--start <number>', 'Start offset for pagination', '0')
  .option('--sort <field>', 'Sort by: relevance, lastUpdatedDate, submittedDate', 'relevance')
  .option('--order <order>', 'Sort order: ascending, descending', 'descending')
  .action(async (query: string, opts) => {
    try {
      const arxiv = new Arxiv();
      const result = await arxiv.search({
        query,
        category: opts.category || getDefaultCategory(),
        maxResults: opts.max ? parseInt(opts.max) : getMaxResults(),
        start: parseInt(opts.start),
        sortBy: opts.sort as 'relevance' | 'lastUpdatedDate' | 'submittedDate',
        sortOrder: opts.order as 'ascending' | 'descending',
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        info(`Found ${result.totalResults} results (showing ${result.papers.length})`);
        for (const paper of result.papers) {
          console.log();
          console.log(chalk.bold(paper.title));
          console.log(chalk.gray(`  ${paper.id} | ${paper.primaryCategory} | ${paper.published.split('T')[0]}`));
          console.log(chalk.cyan(`  Authors: ${paper.authors.join(', ')}`));
          console.log(`  ${paper.abstract.substring(0, 200)}${paper.abstract.length > 200 ? '...' : ''}`);
          console.log(chalk.blue(`  PDF: ${paper.pdfUrl}`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Get command
program.command('get <id>')
  .description('Get paper details by arXiv ID (e.g., 2301.12345)')
  .action(async (id: string) => {
    try {
      const arxiv = new Arxiv();
      const paper = await arxiv.get(id);

      if (getFormat(program) === 'json') {
        print(paper, 'json');
      } else {
        console.log(chalk.bold(paper.title));
        console.log();
        console.log(chalk.cyan(`ID:         ${paper.id}`));
        console.log(chalk.cyan(`Authors:    ${paper.authors.join(', ')}`));
        console.log(chalk.cyan(`Category:   ${paper.primaryCategory} (${paper.categories.join(', ')})`));
        console.log(chalk.cyan(`Published:  ${paper.published.split('T')[0]}`));
        console.log(chalk.cyan(`Updated:    ${paper.updated.split('T')[0]}`));
        if (paper.doi) console.log(chalk.cyan(`DOI:        ${paper.doi}`));
        if (paper.journalRef) console.log(chalk.cyan(`Journal:    ${paper.journalRef}`));
        if (paper.comment) console.log(chalk.cyan(`Comment:    ${paper.comment}`));
        console.log(chalk.blue(`PDF:        ${paper.pdfUrl}`));
        console.log(chalk.blue(`Abstract:   ${paper.absUrl}`));
        console.log();
        console.log(chalk.bold('Abstract:'));
        console.log(paper.abstract);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// List recent command
program.command('list-recent [category]')
  .description('List recent papers in a category (e.g., cs.AI, cs.LG, math.CO)')
  .option('-n, --max <number>', 'Maximum results')
  .option('--start <number>', 'Start offset for pagination', '0')
  .action(async (category: string | undefined, opts) => {
    try {
      const cat = category || getDefaultCategory();
      if (!cat) {
        error('Category required. Pass it as argument or set with "config set-category"');
        process.exit(1);
      }

      const arxiv = new Arxiv();
      const result = await arxiv.listRecent(cat, {
        maxResults: opts.max ? parseInt(opts.max) : getMaxResults(),
        start: parseInt(opts.start),
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        info(`Recent papers in ${chalk.bold(cat)} (${result.totalResults} total, showing ${result.papers.length})`);
        for (const paper of result.papers) {
          console.log();
          console.log(chalk.bold(paper.title));
          console.log(chalk.gray(`  ${paper.id} | ${paper.published.split('T')[0]}`));
          console.log(chalk.cyan(`  ${paper.authors.slice(0, 5).join(', ')}${paper.authors.length > 5 ? ` +${paper.authors.length - 5} more` : ''}`));
          console.log(`  ${paper.abstract.substring(0, 150)}${paper.abstract.length > 150 ? '...' : ''}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search by author
program.command('search-authors <name>')
  .description('Search papers by author name')
  .option('-n, --max <number>', 'Maximum results')
  .option('--start <number>', 'Start offset', '0')
  .action(async (name: string, opts) => {
    try {
      const arxiv = new Arxiv();
      const result = await arxiv.searchAuthors(name, {
        maxResults: opts.max ? parseInt(opts.max) : getMaxResults(),
        start: parseInt(opts.start),
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        info(`Papers by "${name}" (${result.totalResults} total, showing ${result.papers.length})`);
        for (const paper of result.papers) {
          console.log();
          console.log(chalk.bold(paper.title));
          console.log(chalk.gray(`  ${paper.id} | ${paper.primaryCategory} | ${paper.published.split('T')[0]}`));
          console.log(chalk.cyan(`  ${paper.authors.join(', ')}`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Download PDF
program.command('download-pdf <id>')
  .description('Download paper PDF by arXiv ID')
  .option('-o, --output <path>', 'Output file path')
  .action(async (id: string, opts) => {
    try {
      const arxiv = new Arxiv();
      const cleanId = id.replace(/^arxiv:/i, '');
      const filename = `${cleanId.replace(/\//g, '_')}.pdf`;
      const outputPath = opts.output || join(getOutputDir(), filename);

      info(`Downloading PDF for ${cleanId}...`);
      const savedPath = await arxiv.downloadPdf(id, outputPath);
      success(`PDF saved to: ${savedPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
