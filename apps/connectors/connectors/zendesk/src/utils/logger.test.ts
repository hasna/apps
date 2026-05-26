import { describe, expect, test } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from './logger';

describe('Zendesk logger', () => {
  test('uses the shared connector home for log storage', () => {
    expect(logger.getLogPath()).toBe(
      join(homedir(), '.hasna', 'connectors', 'connect-zendesk', 'connect-zendesk.log')
    );
  });
});
