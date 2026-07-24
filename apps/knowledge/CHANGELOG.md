# Changelog

## 0.2.88

Security/hygiene: stop shipping the internal infra host `knowledge.hasna.xyz` as the
default hosted API URL in the published package. The default now resolves to the public
product domain `https://knowledge.md`.

- `DEFAULT_KNOWLEDGE_API_URL` (`src/auth.ts`), `defaultKnowledgeConfig()` hosted default
  (`src/workspace.ts`), the `normalizeMode` alias (`src/service.ts`), and doc comments in
  `src/cli.ts` / `src/cloud-store.ts` now use `knowledge.md` instead of the internal host.
- Propagated to README, `docs/examples`, `docs/migration`, and `tests/cloud-store.test.ts`.
- Rebuilt `dist/` and `bin/` (shipped artifacts) so the leaked default is gone from what
  installs actually run, not just source.
- Known residual (out of scope, needs a `@hasna/contracts` fix): when hosted mode is set
  with a key but no URL, `defaultCloudBaseUrl()` in `@hasna/contracts` still templates
  `https://<app>.hasna.xyz`. `createClientTransport` exposes no base-URL override, so this
  repo cannot close that path alone. Documented explicitly in `tests/cloud-store.test.ts`.

## 0.2.87

Reconcile `main` with the published npm line (`npm/knowledge/v0.2.86`), which had
diverged: the deployed runtime carried a Store-unification + cloud-routing refactor
that never landed on `main`, while `main` carried two CLI fixes the published line
lacked. This release re-converges both histories.

- Merge the published release tag `npm/knowledge/v0.2.86` into `main` (merge commit,
  preserving full ancestry so future `merge-base --is-ancestor` checks pass). Brings in:
  - refactor(store): unify knowledge-item CRUD behind one Store (LocalStore + ApiStore) (1506111)
  - refactor(knowledge): remove dead raw-fetch RemoteKnowledgeClient, make registry descriptor truthful (2b6bd21)
  - fix(knowledge): close residual cloud-mode routing gaps for catalog commands (2d235a9)
  - fix(knowledge): route SDK item CRUD + inventory through the unified Store in all 3 modes (92c3fcc)
  - fix(knowledge): close split-brain read + drop dead API client and client DSN surface (5213a51)
  - fix(knowledge): stop context-pack hang, repair cloud project-panel, drop dead remote command (8daa0ea)
- Retains the two `main`-only CLI fixes on top of the refactor:
  - fix(cli): don't leak internal Error stack on usage/validation errors (#23)
  - fix(cli): make `<sub> --help` print per-command usage (#24)
- Version bumped to 0.2.87 (strictly above published 0.2.86) so npm and `main` reconverge on publish.
