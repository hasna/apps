---
"@hasna/skills": patch
---

Keep schedule run JSON parseable when local skills write output. Stream child stdout and stderr to stderr in JSON mode, preserving human output, actual execution exits and schedule history. Add an optional stderr streaming mode to runSkill without changing existing inherit or pipe callers.
