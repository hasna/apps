# LOC Scan Report — open-otp

**Scan date:** 2026-07-29  
**Repository:** `@hasna/otp` (open-otp)  

## Thresholds

| Metric | Value |
|--------|-------|
| Scan threshold (flag for refactor) | 1000 LOC |
| Refactor target (per-file goal) | under 700 LOC |

## Scan command

```bash
git ls-files 'src/**/*.ts' 'src/*.ts' 'tests/*.ts' | sort -u | xargs wc -l | sort -n
```

Verification command (acceptance criteria):

```bash
git ls-files 'src/**/*.ts' 'src/*.ts' | sort -u | xargs wc -l | sort -n
```

## Results

**14 source/test files scanned; 1,529 total lines.**

| File | LOC |
|------|-----|
| `tests/helpers.ts` | 28 |
| `src/index.ts` | 32 |
| `src/otpauth.ts` | 55 |
| `tests/cli.test.ts` | 65 |
| `tests/otpauth.test.ts` | 69 |
| `src/types.ts` | 71 |
| `src/crypto.ts` | 84 |
| `src/totp.ts` | 109 |
| `src/mcp/index.ts` | 117 |
| `tests/crypto.test.ts` | 124 |
| `tests/totp.test.ts` | 129 |
| `tests/storage.test.ts` | 139 |
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
