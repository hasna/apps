---
"@hasna/skills": patch
---

Honor source, agent and skill-name selectors in `sync --check` and its `render`
alias. Refuse unknown selections instead of reporting a misleading clean census,
while preserving read-only checks and nonzero drift status in human and JSON output.
