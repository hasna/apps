---
"@hasna/skills": patch
---

fix(skills): add the oss-app-two-backend-storage recipe to the canonical corpus with schema-valid frontmatter (todos 326538ce). The skill's description previously carried an unquoted colon+space that strict YAML loaders reject — Codewith 0.1.95 failed to load it on every startup. Ships a strict-frontmatter regression over the whole corpus plus the Development Tools catalog entry.
