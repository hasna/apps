#!/usr/bin/env node
// Deprecated alias: delegates 100% (same args, stdio, exit codes) to `personalnotes`.
process.stderr.write('hasna-notes is deprecated; use personalnotes instead (this alias will be removed in the next release).\n');
await import('./personalnotes.mjs');
