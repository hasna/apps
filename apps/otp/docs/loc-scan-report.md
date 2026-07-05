# LOC Scan Report — open-otp

**Scan date:** 2026-07-05  
**Repository:** `@hasna/otp` (open-otp)  
**Worktree:** `4d3b38b2-d855-422e-98c7-01a1974e319d-0ccb9351`  
**Branch:** `openloops/open-otp/4d3b38b2-d855-422e-98c7-01a1974e319d-0ccb9351`  
**Base commit:** `42bbbfc`

## Thresholds

| Metric | Value |
|--------|-------|
| Scan threshold (flag for refactor) | 1000 LOC |
| Refactor target (per-file goal) | under 700 LOC |

## Scan command

```bash
find . -type f \( -name '*.ts' -o -name '*.js' \) ! -path '*/node_modules/*' ! -path '*/.git/*' | xargs wc -l | sort -n
```

Verification command (acceptance criteria):

```bash
cd /home/hasna/workspace/hasna/opensource/open-otp && find src -name '*.ts' | xargs wc -l | sort -n | tail
```

## Results

**14 source/test files scanned; 1,158 total lines.**

| File | LOC |
|------|-----|
| `tests/totp.test.ts` | 20 |
| `tests/otpauth.test.ts` | 22 |
| `tests/helpers.ts` | 28 |
| `src/index.ts` | 32 |
| `tests/storage.test.ts` | 48 |
| `src/otpauth.ts` | 55 |
| `tests/cli.test.ts` | 65 |
| `src/types.ts` | 71 |
| `src/crypto.ts` | 84 |
| `src/totp.ts` | 109 |
| `src/mcp/index.ts` | 117 |
| `src/storage.ts` | 233 |
| `src/cli/index.ts` | 274 |

### Largest files (src/ only)

| File | LOC |
|------|-----|
| `src/cli/index.ts` | 274 |
| `src/storage.ts` | 233 |
| `src/mcp/index.ts` | 117 |
| `src/totp.ts` | 109 |

## Conclusion

**0 files exceed the 1000 LOC threshold.**

No refactor subtasks are required. The largest file (`src/cli/index.ts` at 274 LOC) is well under both the scan threshold (1000) and the refactor target (700).

## Refactor subtasks

None filed — no offenders.
