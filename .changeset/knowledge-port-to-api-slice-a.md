---
"@hasna/knowledge": patch
---

Hosted-path evidence for the 15 surfaces the audit calls "already ported"
(fleet-alignment PORT-TO-API slice A).

`tests/hosted-path-port.test.ts` runs the real `knowledge` CLI and the real
`knowledge-mcp` stdio server as child processes against the real `/v1` handler
(in-process Postgres, real migrations, loopback `Bun.serve`), records every
request line the server answers, and asserts per surface that the hosted route
was hit:

- CLI `search`, `search --context`, `context pack`, `ask`, `build` →
  `GET /v1/notes/search`
- CLI `inventory` → `GET /v1/notes`, and the reported corpus is the API's
- CLI `versions`, `diff`, `versions purge` → the `/v1/notes/{id}/versions`
  routes, including the `DELETE` purge
- CLI `project-panel` → the hosted `/v1/projects/{id}/resources` listing
- MCP `ok_search`, `knowledge_search`, `knowledge_context_pack`,
  `knowledge_ask`, `knowledge_get`, `knowledge_inventory` → the same routes;
  `ok_parse_source_ref` answers without any store at all

It also pins the two refusals that keep the boundary honest: `search --semantic`
exits non-zero with `semantic_query_unavailable` rather than building an on-box
index, and the whole run leaves no `*.db*` file anywhere under the caller's
HOME.

No behaviour change — this release records the proof that the hosted arms are
real.
