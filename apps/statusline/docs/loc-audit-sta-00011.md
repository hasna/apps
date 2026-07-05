# LOC Audit — STA-00011

**Task:** Scan `src/**/*.ts` for files exceeding 1000 lines of code; create per-file refactor subtasks (target ≤700 LOC) when found.

**Date:** 2026-07-05  
**Worktree:** `/home/hasna/.hasna/loops/worktrees/open-statusline/607ec477-385d-438b-a867-cb19ff1bbbd3-46167550`  
**Branch:** `openloops/open-statusline/607ec477-385d-438b-a867-cb19ff1bbbd3-46167550`  
**Verify command:** `find src -name '*.ts' | xargs wc -l | sort -n`

## Thresholds

| Metric | Value |
|--------|-------|
| Scan threshold | 1000 LOC |
| Refactor target | ≤700 LOC |

## Results (sorted descending)

| LOC | File |
|-----|------|
| 268 | `src/mcp/index.ts` |
| 187 | `src/segments/index.ts` |
| 175 | `src/cli.ts` |
| 113 | `src/index.ts` |
| 55 | `src/git.ts` |
| 52 | `src/config.ts` |
| 51 | `src/context-window.ts` |
| 36 | `src/format.ts` |
| 35 | `src/providers/claude.ts` |
| 23 | `src/providers/types.ts` |
| 20 | `src/install.ts` |
| 19 | `src/render.ts |

**Files scanned:** 12  
**Total LOC:** 1034  
**Files ≥1000 LOC:** 0

## Conclusion

No source files exceed the 1000 LOC threshold. **No per-file refactor subtasks are required.**

The largest file is `src/mcp/index.ts` at 268 LOC — well under both the scan threshold (1000) and the refactor target (700).
