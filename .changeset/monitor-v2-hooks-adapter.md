---
"@hasna/monitor": patch
---

feat(monitor): MON-V2-11 hooks native adapter — src/integrations/hooks.ts invokes named hooks through the exact `@hasna/hooks` SDK `runHook` surface (no event-bus API), classifies outcomes (confirmed / failed with not_found, execution_error, invalid_input / unknown with timeout), and persists each event receipt plus failure classification under the stable effect key (hash of slug, run_id, action_index, target, operation) into a bounded mode-600 effect store (src/integrations/effects.ts), matching the design §4/§5 slug_effects vocabulary.
