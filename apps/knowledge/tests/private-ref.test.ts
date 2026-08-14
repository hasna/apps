import { describe, expect, test } from 'bun:test';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactPrivateRefs } from '../src/private-ref';

/**
 * Local filesystem path shapes, one per OS family, planted verbatim so that these
 * assertions hold whichever OS is running the suite. The values are synthetic
 * fixtures — they must never be replaced with a real host's paths, and failures
 * report the CATEGORY LABEL rather than the offending value, because a guard that
 * prints what it caught publishes it.
 *
 * Before platform-agnostic redaction, only the /home/... and /tmp/... forms were
 * matched. Every other shape survived export untouched, which is why the leak
 * reproduced on the macOS CI runners (temp dirs live under /var/folders) and never
 * on Linux.
 */
const PLANTED_LOCAL_PATHS: Record<string, string> = {
  linux_home: '/home/fixture-user/workspace/private-notes.md',
  linux_temp: '/tmp/fixture-export-staging/private-notes.md',
  macos_home: '/Users/fixture-user/workspace/private-notes.md',
  macos_temp: '/var/folders/1a/fixturehash0000gn/T/fixture-export/private-notes.md',
  macos_private_temp: '/private/var/folders/1a/fixturehash0000gn/T/fixture-export/private-notes.md',
  macos_var_temp: '/var/tmp/fixture-export-staging/private-notes.md',
  windows_drive_backslash: 'C:\\Users\\fixture-user\\AppData\\Local\\Temp\\fixture-export\\private-notes.md',
  windows_drive_forwardslash: 'D:/fixture-user/workspace/private-notes.md',
  windows_unc: '\\\\fixture-host\\share\\fixture-export\\private-notes.md',
};

/** Category labels whose planted value survived redaction. Never returns values. */
function survivingCategories(redacted: string): string[] {
  return Object.entries(PLANTED_LOCAL_PATHS)
    .filter(([, value]) => redacted.includes(value))
    .map(([label]) => label)
    .sort();
}

describe('private ref redaction is platform-agnostic', () => {
  test('redacts local filesystem paths from every OS family, not just Linux roots', () => {
    const planted = Object.entries(PLANTED_LOCAL_PATHS)
      .map(([label, value]) => `${label} cites ${value}`)
      .join('\n');

    const redacted = redactPrivateRefs(planted);

    expect(survivingCategories(redacted)).toEqual([]);
    expect(redacted).toContain('[REDACTED:');
  });

  test('redacts local paths nested in objects, arrays, and JSON-in-string columns', () => {
    // Mirrors how the sync exporter actually carries paths: metadata_json is a
    // JSON document stored as a TEXT column, so the path is nested inside a string.
    const row = {
      id: 'src_fixture',
      metadata_json: JSON.stringify({
        metadata: { path: PLANTED_LOCAL_PATHS.macos_temp },
        path: PLANTED_LOCAL_PATHS.windows_drive_backslash,
      }),
      nested: [{ deep: { path: PLANTED_LOCAL_PATHS.macos_home } }],
    };

    const redacted = redactPrivateRefs(row);

    expect(survivingCategories(JSON.stringify(redacted))).toEqual([]);
    expect(redacted.id).toBe('src_fixture');
  });

  test("redacts this host's own home and temp roots whatever they happen to be", () => {
    // The running host's roots are the authoritative answer to "is this local",
    // so redaction must read them from the OS instead of assuming Linux defaults.
    const hostPaths = [join(homedir(), 'fixture-export', 'private-notes.md'), join(tmpdir(), 'fixture-export', 'private-notes.md')];

    for (const hostPath of hostPaths) {
      const redacted = redactPrivateRefs(`generated artifact cites ${hostPath}`);
      expect(redacted).not.toContain(hostPath);
      expect(redacted).toContain('[REDACTED:');
    }
  });

  test('leaves portable, non-filesystem references intact', () => {
    // Over-redaction is its own defect: relative artifact keys, content hashes,
    // media types, and remote URIs must survive so bundles stay importable.
    const portable = [
      'wiki/README.md',
      'logs/2026/07/27.jsonl',
      'sha256:e3ae2867534c78201b653940ad2f55bd0ff67b27f25f0c8181fc34d555717c69',
      'text/markdown',
      'application/x-ndjson',
      's3://fixture-bucket/org/project/knowledge/wiki/README.md',
      'open-files://source/src_fixture/path/wiki/README.md',
    ];

    for (const value of portable) {
      expect(redactPrivateRefs(value)).toBe(value);
    }
  });
});
