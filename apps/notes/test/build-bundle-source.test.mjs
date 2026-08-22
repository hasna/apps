import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

// Regression guard for the macOS bundle build's @hasna/events resolution.
//
// scripts/build_notes.sh bundles @hasna/events into
// Resources/node_modules/@hasna/events for the AI sidecar. It previously
// resolved that package from a root-hoisted node_modules/@hasna/events
// directory that bun never creates: on a fresh `bun install`, bun links
// workspace deps into the CONSUMING package's scope
// (apps/notes/node_modules/@hasna/events -> ../../../events) and keeps only a
// partial copy under node_modules/.bun whose dist lacks durable-spool.js, so
// the presence gate failed with "error: missing @hasna/events; run bun install
// at the repository root" on any clean checkout. The bundle source must be the
// git-tracked workspace member apps/events (whose dist/ is committed), never a
// hoisted node_modules path.
//
// This is a source-level guard because the script is macOS-only (swift build,
// codesign, PlistBuddy) and cannot execute on Linux; the macOS bundle build is
// the live test. This test fails on the old code, which gated and copied from
// "$REPO_ROOT/node_modules/@hasna/events".

const SCRIPT = new URL('../scripts/build_notes.sh', import.meta.url).pathname;

describe('macOS bundle build (@hasna/events source resolution)', () => {
  test('resolves @hasna/events from the workspace member, never a hoisted root path', async () => {
    const src = await readFile(SCRIPT, 'utf8');

    // The bundle source is the git-tracked workspace member.
    expect(src).toContain('EVENTS_SRC="$REPO_ROOT/apps/events"');

    // The presence gate tests the member's tracked dist artifact...
    expect(src).toContain('-f "$EVENTS_SRC/dist/durable-spool.js"');

    // ...and the bundle copy comes from the member.
    expect(src).toContain('cp "$EVENTS_SRC/package.json" "$RESOURCES/node_modules/@hasna/events/"');
    expect(src).toContain('cp -RL "$EVENTS_SRC/dist" "$RESOURCES/node_modules/@hasna/events/dist"');

    // The old root-hoist assumption must not return: bun never creates a
    // root-level node_modules/@hasna directory, so any gate or copy resolving
    // @hasna/events through "$REPO_ROOT/node_modules/@hasna/events" breaks
    // every fresh checkout.
    expect(src).not.toContain('"$REPO_ROOT/node_modules/@hasna/events/dist/durable-spool.js"');
    expect(src).not.toContain('cp "$REPO_ROOT/node_modules/@hasna/events/package.json"');
    expect(src).not.toContain('cp -RL "$REPO_ROOT/node_modules/@hasna/events/dist"');
  });
});
