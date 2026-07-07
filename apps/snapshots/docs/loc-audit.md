# LOC Audit — open-snapshots

**Date:** 2026-07-05  
**Task:** SNA-00015  
**Threshold:** 1,000 lines of code (refactor target: under 700 LOC)

## Summary

No source or test file in this repository exceeds the 1,000-LOC threshold. **Zero refactor subtasks** are required from this audit.

`src/restore.ts` (873 LOC) is the largest file but remains under the threshold. Ongoing hygiene for that module is tracked separately under **SNA-00011** (restore.ts refactor).

## Source files (`src/**/*.ts`)

| Lines | File |
|------:|------|
| 873 | `src/restore.ts` |
| 499 | `src/capture/index.ts` |
| 331 | `src/storage.ts` |
| 253 | `src/cli/index.ts` |
| 209 | `src/service.ts` |
| 186 | `src/types.ts` |
| 158 | `src/runtime.ts` |
| 151 | `src/util.ts` |
| 139 | `src/mcp/index.ts` |
| 62 | `src/server/index.ts` |
| 48 | `src/policy.ts` |
| 11 | `src/agent/index.ts` |
| 7 | `src/index.ts` |

**Total:** 2,927 lines across 13 source files.

## Test files (`tests/**/*.ts`)

| Lines | File |
|------:|------|
| 541 | `tests/restore.test.ts` |
| 80 | `tests/runtime.test.ts` |
| 60 | `tests/storage.test.ts` |
| 56 | `tests/capture.test.ts` |

Largest test file: `tests/restore.test.ts` at 541 LOC — under threshold.

## Verification command

```bash
cd /path/to/open-snapshots
find src -name '*.ts' | xargs wc -l | sort -n | tail
```

Full-repo scan (including tests):

```bash
find . -name '*.ts' -not -path './node_modules/*' | xargs wc -l | sort -n | tail
```

## Refactor subtasks created

None — no files exceed 1,000 LOC.
