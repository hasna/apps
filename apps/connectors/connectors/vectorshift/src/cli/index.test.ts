import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { getFormat } from './index';

describe('VectorShift CLI', () => {
  test('reads the root output format option from nested commands', () => {
    const root = new Command();
    root.option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');
    const chatbots = root.command('chatbots');
    const run = chatbots.command('run');

    expect(getFormat(run)).toBe('pretty');

    root.setOptionValue('format', 'json');
    expect(getFormat(run)).toBe('json');
  });
});
