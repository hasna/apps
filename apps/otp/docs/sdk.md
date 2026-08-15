# SDK Reference

The package supports Bun and TypeScript ESM:

```ts
import {
  addOtpEntry,
  generateOtpCode,
  listOtpEntries,
} from "@hasna/otp";

const entry = addOtpEntry({
  issuer: "Example",
  account: "agent@example.com",
  secret: process.env.OTP_SEED!,
});
const code = generateOtpCode(entry.id);
const entries = listOtpEntries();
```

Storage functions accept an optional `{ home }` argument. An explicit `home`
takes precedence over `HASNA_OTP_HOME`, which takes precedence over
`~/.hasna/otp/`.

## Storage exports

| Export | Behavior |
|--------|----------|
| `bootstrapOtpStorage(options?)` | Create the directory, key, and store when missing; return full status. |
| `getOtpStorageStatus(options?)` | Return paths, existence flags, entry count, storage type, and encryption flag. Does not create the key or store file. |
| `getDefaultOtpHome()` | Resolve the environment-selected or default home. |
| `getOtpStorePath(options?)` | Resolve `entries.json`, creating or securing the parent directory. |
| `addOtpEntry(input, options?)` | Validate, encrypt, and store a seed; return public entry metadata. |
| `importOtpAuthUri(input, options?)` | Parse and store an `otpauth://totp` URI, with optional id/label overrides. |
| `listOtpEntries(options?)` | Return all public entries. |
| `getOtpEntry(target, options?)` | Return one public entry or `undefined`. |
| `generateOtpCode(target, options?)` | Decrypt in-process and return a code plus public metadata. `options.at` accepts a `Date` or millisecond timestamp. |
| `removeOtpEntry(target, options?)` | Remove and return one public entry, or return `undefined`. |

Targets match id, label, `issuer:account`, or account case-insensitively. An
account must be unique; ambiguous targets throw. Labels are unique
case-insensitively.

## URI and TOTP exports

| Export | Behavior |
|--------|----------|
| `parseOtpAuthUri(uri)` | Parse a TOTP authenticator URI into `AddOtpEntryInput`. HOTP is rejected. |
| `generateTotp(secret, options?)` | Generate RFC 6238 TOTP. `options.at` accepts a `Date` or millisecond timestamp. |
| `decodeBase32(secret)` | Normalize and decode an RFC 4648 base32 seed. |
| `normalizeBase32Secret(secret)` | Uppercase base32 and remove spaces, hyphens, and `=` padding. |
| `normalizeAlgorithm(value?)` | Normalize `SHA1`, `SHA256`, or `SHA512`; defaults to `SHA1`. |
| `normalizeDigits(value?)` | Validate an integer from 6 through 8; defaults to 6. |
| `normalizePeriod(value?)` | Validate an integer from 1 through 300 seconds; defaults to 30. |
| `codesEqual(left, right)` | Timing-safe comparison for equal-length code strings. |

`generateTotp()` returns `code`, `period`, `expires_at`, `expires_in`, and
`counter`. `expires_in` is relative to the current wall clock even when
`options.at` selects a different generation time.

## Types

The root package exports `AddOtpEntryInput`, `GeneratedOtpCode`,
`GeneratedTotp`, `ImportOtpUriInput`, `OtpEntry`, `OtpStorageOptions`,
`OtpStorageStatus`, and `TotpAlgorithm`.

`AddOtpEntryInput.secret` and `ImportOtpUriInput.uri` are input-only enrollment
fields. Public result types never include plaintext seeds or
`encrypted_secret`. The internal `StoredOtpEntry` type is not exported from the
root package.

## Subpath exports

The same implementation modules are available at `@hasna/otp/otpauth`,
`@hasna/otp/storage`, and `@hasna/otp/totp`. Prefer the root package unless a
narrow import is useful.
