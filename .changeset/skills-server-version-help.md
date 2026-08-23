---
"@hasna/skills": patch
---

skills-server answers --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `skills-server --version`/`--help` fell through to resolveServerConfig()/startSkillsServer() and bound :8787 with no output.
