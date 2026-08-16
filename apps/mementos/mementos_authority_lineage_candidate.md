# Mementos authority lineage candidate

historical_row_exact_one: PASS

historical_row_digest_match: PASS

candidate_identity:

- repository: `hasnaxyz/iapp-mementos`
- branch: `fix/68e77374-authority-lineage`
- base: `3f34e521557840858f10fd8e5df9937e2760915b`
- task: `68e77374-8df0-4a75-843b-c0f840342207`
- authoritative Fleet root task: `5a6e9172-25da-4e89-b1a4-55bd5ddfd9cc`
- live diagnostic artifact SHA-256: `5f4298bbb80c4331772a5fe0c56e4e3141666769f92ba5baea1987a4d4bff00e`
- live diagnostic ECS task: `f40ee5e2e354472c99ce0b6e453be17f`

lookup_only_scope:

- The only added lineage is the exact historical request identity for receipt
  `mmpr_a647f9908a33bb64bf137f584202590f91b72a33`.
- The lookup queries the original `mementos/default/default` namespace and
  returns the original immutable public receipt unchanged.
- The accepted request must match the historical route, package version,
  authority tuple, operation, step, resource kind, forward direction, target
  selector, target ID, and idempotency key.
- Create, compensate/inverse, enumeration, wildcard selection, arbitrary
  historical tuples, and client-selected lineage remain closed.

tenant_isolation:

- Historical lookup is advertised and accepted only when the current
  authenticated authority is
  `mementos/adfd95c7-ee8b-52cb-ae47-4ae65dae3313/mementos:postgresql`.
- Non-root tenants, SQLite authorities, cross-tenant requests, and
  client-selected tenants or corpora fail with capability mismatch.
- No Fleet Resources project row was created, updated, deleted, or otherwise
  mutated by this candidate.

required_gates:

- Package-owned active PostgreSQL diagnostic: PASS.
- Diagnostic transaction mode: `READ ONLY`, repeatable read.
- Exact historical receipt count: `1`.
- Receipt table count: `12` before and `12` after.
- Receipt table aggregate digest:
  `f8a3c9129ab5eb322cfd602e9540d8f7` before and after.
- Identity digest:
  `1108dd972c90e4989036fb6ecec7dde10f54641a697bd53cfcd64017f589ace7`.
- Target digest:
  `72789fcd60668eeb66ee068936d3afa96deadcb007228830c64b6de783b6dcef`.
- Operation digest:
  `d7e37bfb2c0d28f8c4086c53224cd855d14694f32807b74c102b61a99963f3c0`.
- Idempotency digest:
  `b56d8ec37efb818759cdd2ee3b58bc1401ac13384c8d64c1813bb5c198b1e376`.
- Result digest:
  `26fb0dd5c5e20909d3653ab0ddd8fa45e5142728e4e66d595e2419f7ed40b036`.
- Receipt digest:
  `52ce90c5de6817989f107d9d27e06156962a2b9c365e34e16a57aa37886501a2`.
- Response digest:
  `2fa3ed508f5f192c18753b1205ced996340fdf02f735420d32db897fc239805c`.
- Focused lineage and regression matrix: `44 pass`, `0 fail`.
- Full package suite: `2323 pass`, `4 skip`, `0 fail`.
- TypeScript typecheck: PASS.
- Production package build: PASS.
- `git diff --check`: PASS.

staged_secrets_scan: PASS

No credential value, database URL, private payload, or raw unrelated receipt
was printed, stored, or added to the candidate.
