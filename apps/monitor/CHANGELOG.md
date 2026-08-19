# @hasna/monitor

## 0.1.28

### Patch Changes

- 2ce7807: feat(monitor): MON-V2-11 hooks native adapter — src/integrations/hooks.ts invokes named hooks through the exact `@hasna/hooks` SDK `runHook` surface (no event-bus API), classifies outcomes (confirmed / failed with not_found, execution_error, invalid_input / unknown with timeout), and persists each event receipt plus failure classification under the stable effect key (hash of slug, run_id, action_index, target, operation) into a bounded mode-600 effect store (src/integrations/effects.ts), matching the design §4/§5 slug_effects vocabulary.
- 8c11987: feat(monitor): monitor-v2 ship wave release — MON-V2-11 hooks native adapter invokes named hooks through the exact `@hasna/hooks` SDK `runHook` surface with classified outcomes and persisted effect receipts (#495, reviewed GO at merged sha de4cb5389); MON-V2-14 contract manifest aligned to contracts kit 0.11.1 with truthful storage/envPrefix declarations and real ./sdk export (#486, reviewed GO at merged sha 3e644f52). Version bump for the release; candidate reviewed and merged per the release gate before publish.
- Updated dependencies [b630c48]
- Updated dependencies [38c7d92]
- Updated dependencies [4e6f158]
  - @hasna/events@0.1.16
  - @hasna/hooks@0.6.9
