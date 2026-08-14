import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { getFormat } from './index';

describe('Zoho CLI format handling', () => {
  test('reads the root format option when callers pass the root command', () => {
    const command = new Command().option('-f, --format <format>', 'Output format', 'pretty');

    command.setOptionValue('format', 'json');

    expect(getFormat(command)).toBe('json');
  });

  test('falls back to a parent format option for subcommands', () => {
    const root = new Command().option('-f, --format <format>', 'Output format', 'pretty');
    const child = root.command('list-contacts');

    root.setOptionValue('format', 'json');

    expect(getFormat(child)).toBe('json');
  });
});
