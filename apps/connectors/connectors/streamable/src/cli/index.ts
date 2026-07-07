#!/usr/bin/env bun
import { Command } from 'commander';
import { Streamable } from '../api';
import type { OutputFormat } from '../utils/output';
import { debug, error, print, setVerboseMode } from '../utils/output';

const CONNECTOR_NAME = 'streamable';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Streamable read-only video metadata and oEmbed connector')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

async function runAction(cmd: Command, fn: (client: Streamable) => Promise<unknown>): Promise<void> {
  try {
    const result = await fn(new Streamable());
    print(result, getFormat(cmd));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

program
  .command('video <shortcode>')
  .description('Get video metadata by shortcode')
  .action(function (this: Command, shortcode: string) {
    return runAction(this, (client) => client.getVideo(shortcode));
  });

program
  .command('oembed <url>')
  .description('Get oEmbed data for a Streamable video URL')
  .action(function (this: Command, url: string) {
    return runAction(this, (client) => client.getOEmbed(url));
  });

program.parse();
