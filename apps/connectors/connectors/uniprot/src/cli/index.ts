#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { UniProt } from '../api';
import { getDefaultSize, setDefaultSize, clearConfig } from '../utils/config';
import type { OutputFormat } from '../types';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-uniprot';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('UniProt protein and proteome search CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || cmd.opts().format || 'pretty') as OutputFormat;
}

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-size <n>')
  .description('Set default page size for search results')
  .action((n: string) => {
    setDefaultSize(parseInt(n, 10));
    success(`Default size set to: ${n}`);
  });

configCmd.command('show')
  .description('Show current configuration')
  .action(() => {
    const size = getDefaultSize();
    console.log(chalk.bold('UniProt Configuration:'));
    info(`Default size: ${size}`);
    info('Note: UniProt API is free — no API key required.');
    info('Rate limit: be respectful; avoid rapid repeated requests.');
  });

configCmd.command('clear')
  .description('Clear all configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

program.command('search-proteins <query>')
  .description('Search UniProtKB proteins by query (e.g., insulin, gene:INS)')
  .option('-n, --size <number>', 'Number of results')
  .option('--from <number>', 'Start offset for pagination', '0')
  .option('--fields <fields>', 'Comma-separated fields to return')
  .action(async (query: string, opts) => {
    try {
      const uniprot = new UniProt();
      const result = await uniprot.searchProteins({
        query,
        size: opts.size ? parseInt(opts.size, 10) : getDefaultSize(),
        from: parseInt(opts.from, 10),
        fields: opts.fields,
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        info(`Found ${result.total} results (showing ${result.results.length})`);
        for (const protein of result.results) {
          console.log();
          console.log(chalk.bold(protein.proteinName));
          console.log(chalk.gray(`  ${protein.accession} | ${protein.id} | ${protein.entryType}`));
          console.log(chalk.cyan(`  Organism: ${protein.organism}`));
          if (protein.geneNames.length > 0) {
            console.log(chalk.cyan(`  Genes: ${protein.geneNames.join(', ')}`));
          }
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('get-protein <accession>')
  .description('Get protein entry by UniProt accession (e.g., P01308)')
  .action(async (accession: string) => {
    try {
      const uniprot = new UniProt();
      const protein = await uniprot.getProtein(accession);

      if (getFormat(program) === 'json') {
        print(protein, 'json');
      } else {
        console.log(chalk.bold(protein.proteinName));
        console.log();
        console.log(chalk.cyan(`Accession:  ${protein.accession}`));
        console.log(chalk.cyan(`ID:         ${protein.id}`));
        console.log(chalk.cyan(`Type:       ${protein.entryType}`));
        console.log(chalk.cyan(`Organism:   ${protein.organism.scientificName}${protein.organism.commonName ? ` (${protein.organism.commonName})` : ''}`));
        if (protein.geneNames.length > 0) {
          console.log(chalk.cyan(`Genes:      ${protein.geneNames.join(', ')}`));
        }
        if (protein.sequence) {
          console.log(chalk.cyan(`Sequence:   ${protein.sequence.length} aa`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('search-proteomes <query>')
  .description('Search proteomes by query (e.g., human, taxon:9606)')
  .option('-n, --size <number>', 'Number of results')
  .option('--from <number>', 'Start offset for pagination', '0')
  .action(async (query: string, opts) => {
    try {
      const uniprot = new UniProt();
      const result = await uniprot.searchProteomes({
        query,
        size: opts.size ? parseInt(opts.size, 10) : getDefaultSize(),
        from: parseInt(opts.from, 10),
      });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        info(`Found ${result.total} proteomes (showing ${result.results.length})`);
        for (const proteome of result.results) {
          console.log();
          console.log(chalk.bold(`${proteome.scientificName}${proteome.commonName ? ` (${proteome.commonName})` : ''}`));
          console.log(chalk.gray(`  ${proteome.id} | ${proteome.proteomeType} | ${proteome.modified}`));
          console.log(`  ${proteome.description}${proteome.description.length >= 200 ? '...' : ''}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
