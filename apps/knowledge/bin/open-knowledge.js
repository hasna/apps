#!/usr/bin/env bun
// @bun
var F=import.meta.require;import{readFileSync as $,writeFileSync as B,existsSync as G,renameSync as de,unlinkSync as ee}from"fs";import{randomUUID as ne}from"crypto";import{existsSync as _e,mkdirSync as H,readFileSync as ye,writeFileSync as pe}from"fs";import{homedir as m}from"os";import{dirname as Oe,join as O,resolve as Re}from"path";var Ae=O(".hasna","apps","knowledge");function J(){return O(m(),".open-knowledge","db.json")}function V(){return O(m(),".hasna","apps","knowledge")}function Xe(n=process.cwd()){return Re(n,Ae)}function h(n){return{home:n,configPath:O(n,"config.json"),jsonStorePath:O(n,"db.json"),knowledgeDbPath:O(n,"knowledge.db"),artifactsDir:O(n,"artifacts"),cacheDir:O(n,"cache"),exportsDir:O(n,"exports"),indexesDir:O(n,"indexes"),logsDir:O(n,"logs"),runsDir:O(n,"runs"),schemasDir:O(n,"schemas"),wikiDir:O(n,"wiki")}}function Ue(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]}}}function j(n){let i=h(n);H(i.home,{recursive:!0});for(let e of[i.artifactsDir,i.cacheDir,i.exportsDir,i.indexesDir,i.logsDir,i.runsDir,i.schemasDir,i.wikiDir])H(e,{recursive:!0});if(!_e(i.configPath))pe(i.configPath,`${JSON.stringify(Ue(),null,2)}
`);return i}function l(n,i=process.cwd()){if(n==="project"||n==="local")return h(Xe(i));return h(V())}function M(n){H(Oe(n),{recursive:!0})}function W(n){let i=ye(n,"utf8");return JSON.parse(i)}function q(){return h(V()).jsonStorePath}function Z(n){if(!G(n))if(M(n),n===q()&&G(J()))B(n,$(J(),"utf8"));else B(n,JSON.stringify({items:[]},null,2))}function ke(n){return`${n}.lock`}function De(n,i){let N=Date.now();while(Date.now()-N<5000){try{if(!G(n)){B(n,JSON.stringify({owner:i,ts:Date.now()}));return}let S=JSON.parse($(n,"utf8"));if(Date.now()-S.ts>1e4)ee(n)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${n} after 5000ms`)}function we(n,i){try{if(G(n)){if(JSON.parse($(n,"utf8")).owner===i)ee(n)}}catch{}}function R(n){Z(n);let i=$(n,"utf8"),e=JSON.parse(i);if(!e||!Array.isArray(e.items))return{items:[]};return e}function U(n,i){let e=`${n}.tmp.${ne()}`;B(e,JSON.stringify(i,null,2)),de(e,n)}function A(n,i){let e=ne(),r=ke(n);De(r,e);try{return i()}finally{we(r,e)}}function v(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function ie(n){return n.replace(/^k_/,"").slice(0,12)}import{Database as Ie}from"bun:sqlite";var Se=`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  acl_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  hash TEXT,
  extracted_text_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, revision)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  wiki_page_id TEXT,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_uri TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_backlinks (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_page_id, to_page_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_uri TEXT NOT NULL,
  quote TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_indexes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  artifact_uri TEXT,
  shard_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, name, shard_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redaction_findings (
  id TEXT PRIMARY KEY,
  source_uri TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,
  artifact_uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content_type TEXT,
  hash TEXT,
  size_bytes INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  title,
  source_uri,
  content='',
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (1, datetime('now'));
`;function re(n){M(n);let i=new Ie(n);return i.exec("PRAGMA foreign_keys = ON;"),i}function P(n){let i=re(n);try{return i.exec(Se),{path:n,schema_version:te(i)}}finally{i.close()}}function te(n){return n.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function w(n,i){return n.query(`SELECT COUNT(*) AS n FROM ${i}`).get()?.n??0}function Te(n){let i=re(n);try{return{schema_version:te(i),sources:w(i,"sources"),source_revisions:w(i,"source_revisions"),chunks:w(i,"chunks"),wiki_pages:w(i,"wiki_pages"),citations:w(i,"citations"),indexes:w(i,"knowledge_indexes"),runs:w(i,"runs"),run_events:w(i,"run_events")}}finally{i.close()}}import{existsSync as Ke,mkdirSync as Ee,readFileSync as Ce,writeFileSync as Fe}from"fs";import{dirname as he,join as a,relative as je,sep as Ye}from"path";function Y(n){let i=n.replace(/\\/g,"/").trim();if(!i||i.startsWith("/"))throw Error(`Invalid artifact key: ${n}`);let e=i.split("/").filter(Boolean);if(e.length===0||e.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${n}`);return e.join("/")}function f(n,i){let e=je(n,i);if(e.startsWith("..")||e===".."||e.startsWith(`..${Ye}`))throw Error(`Artifact path escapes root: ${i}`)}class se{root;type="local";canRead=!0;canWrite=!0;constructor(n){this.root=n;Ee(n,{recursive:!0})}async put(n){let i=Y(n.key),e=a(this.root,i);return f(this.root,e),Ee(he(e),{recursive:!0}),Fe(e,n.body),{key:i,uri:`file://${e}`}}async getText(n){let i=Y(n),e=a(this.root,i);return f(this.root,e),Ce(e,"utf8")}async exists(n){let i=Y(n),e=a(this.root,i);return f(this.root,e),Ke(e)}}class oe{options;type="s3";canRead=!0;canWrite=!0;client;constructor(n){this.options=n;this.client=n.client}async getClient(){if(this.client)return this.client;let[{S3Client:n},{fromIni:i}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new n({region:this.options.region,credentials:this.options.profile?i({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(n){let i=Y(n),e=this.options.prefix?Y(this.options.prefix):"";return e?`${e}/${i}`:i}async put(n){let[{PutObjectCommand:i},e]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(n.key);return await e.send(new i({Bucket:this.options.bucket,Key:r,Body:n.body,ContentType:n.content_type,Metadata:n.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(n){let[{GetObjectCommand:i},e]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(n),N=await e.send(new i({Bucket:this.options.bucket,Key:r}));if(!N.Body)return"";return await N.Body.transformToString()}async exists(n){let[{HeadObjectCommand:i},e]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(n);try{return await e.send(new i({Bucket:this.options.bucket,Key:r})),!0}catch(N){let s=N instanceof Error?N.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw N}}}function Ne(n,i){if(n.storage.type==="s3"){if(!n.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new oe({bucket:n.storage.s3.bucket,prefix:n.storage.s3.prefix,region:n.storage.s3.region,profile:n.storage.s3.profile,max_attempts:n.storage.s3.max_attempts,server_side_encryption:n.storage.s3.server_side_encryption,kms_key_id:n.storage.s3.kms_key_id})}return new se(i.artifactsDir)}function be(n){let i=String(n.getUTCFullYear()),e=String(n.getUTCMonth()+1).padStart(2,"0"),r=String(n.getUTCDate()).padStart(2,"0");return{year:i,month:e,day:r}}function xe(){return`# Knowledge Agent Schema v1

## Source Rules

- Treat open-files source references as the preferred source of truth.
- Do not copy raw source files into open-knowledge.
- Cite every durable fact with a source URI, revision/hash when available, and optional span.
- Mark uncertainty explicitly when sources disagree or are incomplete.

## Wiki Rules

- Write generated knowledge as Markdown pages under wiki/.
- Keep root indexes small; use topic, team, project, and machine-readable shards for scale.
- Preserve backlinks between related pages and decisions.
- Prefer updating existing pages over creating near-duplicates.

## Query Rules

- Search wiki pages first, then source chunks, then deeper read-only source refs.
- Use web search only when requested or when current external context is required.
- File useful answers back into the wiki only after approval or approved auto-write mode.

## Lint Rules

- Flag stale pages, missing citations, contradictions, orphan pages, duplicate pages, and unresolved source refs.
`}function Me(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function Be(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function ue(n,i=new Date){let{year:e,month:r,day:N}=be(i),s="schemas/v1.md",S="indexes/root.md",g="wiki/README.md",t=`logs/${e}/${r}/${N}.jsonl`,E={ts:i.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},T=[n.put({key:"schemas/v1.md",body:xe(),content_type:"text/markdown"}),n.put({key:"indexes/root.md",body:Me(),content_type:"text/markdown"}),n.put({key:"wiki/README.md",body:Be(),content_type:"text/markdown"}),n.put({key:t,body:`${JSON.stringify(E)}
`,content_type:"application/x-ndjson"})];return await Promise.all(T),{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:t,written:["schemas/v1.md","indexes/root.md","wiki/README.md",t]}}var b={name:"@hasna/knowledge",version:"0.2.3",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"./bin/open-knowledge.js","open-knowledge-mcp":"./bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"https://github.com/hasna/knowledge"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@modelcontextprotocol/sdk":"^1.29.0",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var ce={debug:0,info:1,warn:2,error:3},$e=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function I(n,i,e){if(ce[n]<ce[$e()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[n],N=e?`${r} ${i} ${JSON.stringify(e)}`:`${r} ${i}`;if(n==="error")console.error(N);else console.error(N)}var ze=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","db","wiki","help"],Le={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function Qe(n){let i=[],e={};for(let r=0;r<n.length;r+=1){let N=n[r];if(!N.startsWith("-")){i.push(N);continue}switch(N){case"--json":e.json=!0;break;case"--yes":case"-y":e.yes=!0;break;case"--help":case"-h":e.help=!0;break;case"--version":case"-v":e.version=!0;break;case"--desc":e.desc=!0;break;case"--page":case"-p":e.page=Number(n[r+1]),r+=1;break;case"--limit":case"-l":e.limit=Number(n[r+1]),r+=1;break;case"--search":case"-s":e.search=n[r+1],r+=1;break;case"--sort":e.sort=n[r+1],r+=1;break;case"--id":e.id=n[r+1],r+=1;break;case"--store":e.store=n[r+1],r+=1;break;case"--title":e.title=n[r+1],r+=1;break;case"--content":e.content=n[r+1],r+=1;break;case"--url":e.url=n[r+1],r+=1;break;case"--tag":case"-t":e.tag=n[r+1],r+=1;break;case"--format":e.format=n[r+1],r+=1;break;case"--completions":e.completions=n[r+1],r+=1;break;case"--no-color":e.noColor=!0;break;case"--scope":e.scope=n[r+1],r+=1;break;case"--older-than":e.olderThan=Number(n[r+1]),r+=1;break;case"--empty":e.empty=!0;break;case"--archived":e.archived=!0;break;case"--include-archived":e.includeArchived=!0;break;default:throw Error(`Unknown flag: ${N}. Run 'open-knowledge --help' for valid options.`)}}return{positional:i,flags:e}}function He(n){if(!n)return"";return Le[n]??n}function Je(n,i){let e=Array.from({length:n.length+1},()=>Array(i.length+1).fill(0));for(let r=0;r<=n.length;r+=1)e[r][0]=r;for(let r=0;r<=i.length;r+=1)e[0][r]=r;for(let r=1;r<=n.length;r+=1)for(let N=1;N<=i.length;N+=1){let s=n[r-1]===i[N-1]?0:1;e[r][N]=Math.min(e[r-1][N]+1,e[r][N-1]+1,e[r-1][N-1]+s)}return e[n.length][i.length]}function Ve(n){if(!n)return"";let i=[...ze,...Object.keys(Le)],e="",r=Number.POSITIVE_INFINITY;for(let N of i){let s=Je(n,N);if(s<r)r=s,e=N}return r<=3?e:""}function We(){console.log(`open-knowledge - local agent knowledge store

Usage:
  open-knowledge <command> [options]

Commands:
  add <title> <content>       Add an item
  list (alias: ls)             List items (supports pagination/search/sort/tag)
  get --id <id>               Get one item
  update --id <id>            Update an item (--title, --content, --url, --tag)
  archive --id <id>           Archive an item
  restore --id <id>           Restore an archived item
  upsert [title] [content]    Create or update an item by --id
  untag --id <id> -t <tag>    Remove a tag from an item
  delete (alias: rm) --id <id> Delete item (requires --yes)
  export                       Export all items (--format jsonl)
  prune                        Remove old/empty items (requires --yes)
  dedupe                       Remove duplicate items by title+content (requires --yes)
  stats                        Show knowledge base statistics
  paths                        Show resolved workspace/store paths
  db init|stats                Initialize or inspect local knowledge.db
  wiki init                    Initialize scalable wiki/schema/index/log artifacts
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  --scope local|global|project  Store scope (default: global ~/.hasna/apps/knowledge/)
  --no-color                  Disable color output
  --completions <shell>       Output completions for bash|zsh|fish
  -v, --version               Show version
  -h, --help                  Show help

List Options:
  --format table|json         Output format (default: table if TTY, json otherwise)
  -p, --page <n>              Page number (default: 1)
  -l, --limit <n>             Items per page (default: 20)
  -s, --search <text>         Filter by title/content
  -t, --tag <tag>             Filter by tag
  --sort <created|title>       Sort field (default: created)
  --desc                       Sort descending
  --archived                  Show only archived items
  --include-archived          Include archived items

Add/Update Options:
  --url <url>                 Attach source URL

Update Options:
  --id <id>                   Item id
  --title <title>             New title
  --content <content>         New content
  --url <url>                 New source URL
  -t, --tag <tag>             Add a tag

Delete Options:
  --id <id>                   Item id
  -y, --yes                   Confirm destructive action

Export Options:
  --format jsonl              Export as newline-delimited JSON (default: JSON array)

Prune Options:
  --older-than <days>          Remove items older than N days
  --empty                     Remove items with empty content`)}function qe(n){if(n==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(n==="list"||n==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(n==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(n==="update"||n==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(n==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(n==="restore"||n==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(n==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(n==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(n==="delete"||n==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(n==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(n==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(n==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(n==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(n==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(n==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(n==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}We()}function Ze(n){if(n.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function y(n,i,e){if(i){console.log(JSON.stringify(n,null,2));return}if(typeof n==="string"){console.log(n);return}console.log(n.message??JSON.stringify(n,null,2))}function x(n){if(!n.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function ve(n,i){let e=i.sort??"created";if(e!=="created"&&e!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...n].sort((N,s)=>{if(e==="title")return N.title.localeCompare(s.title);return N.created_at.localeCompare(s.created_at)});if(i.desc)r.reverse();return{sorted:r,sort:e,direction:i.desc?"desc":"asc"}}async function Pe(n){let{positional:i,flags:e}=Qe(n);if(I("debug","CLI invoked",{command:i[0],flags:{json:e.json,store:e.store}}),e.version){console.log(e.json?JSON.stringify({name:b.name,version:b.version},null,2):`${b.name} ${b.version}`);return}if(e.completions){let t=e.completions;if(t==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(t==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(t==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=He(i[0]);if(!r||e.help||r==="help"){qe(i[1]);return}let N=l(e.scope),s=e.store;if(!s)if(e.scope==="project"||e.scope==="local")s=j(N.home).jsonStorePath;else s=q();if(r==="paths"){let t=j(N.home);y({ok:!0,scope:e.scope??"global",home:t.home,config_path:t.configPath,json_store_path:t.jsonStorePath,knowledge_db_path:t.knowledgeDbPath,artifacts_dir:t.artifactsDir,indexes_dir:t.indexesDir,logs_dir:t.logsDir,runs_dir:t.runsDir,schemas_dir:t.schemasDir,wiki_dir:t.wikiDir,config:W(t.configPath),message:t.home},e.json);return}if(r==="db"){let t=i[1]??"init",E=j(N.home);if(t!=="init"&&t!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(t==="init"){let o=P(E.knowledgeDbPath);y({ok:!0,...o,message:`Initialized ${o.path}`},e.json);return}P(E.knowledgeDbPath);let T=Te(E.knowledgeDbPath);y({ok:!0,path:E.knowledgeDbPath,...T,message:`knowledge.db schema v${T.schema_version}`},e.json);return}if(r==="wiki"){if((i[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let E=j(N.home),T=W(E.configPath),o=Ne(T,E),c=await ue(o);y({ok:!0,...c,message:`Initialized wiki layout in ${E.home}`},e.json);return}if(Z(s),r==="add"){let t=i[1],E=i[2];if(!t||!E)throw Error("Usage: open-knowledge add <title> <content>");A(s,()=>{let T=R(s),o={id:v(),title:t,content:E,url:e.url??null,tags:e.tag?[e.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};T.items.push(o),U(s,T),I("info","Item added",{id:o.id,title:o.title}),y({ok:!0,item:o,message:`Added ${o.id}`},e.json)});return}if(r==="list"){if(e.format!==void 0&&e.format!=="table"&&e.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");A(s,()=>{let t=R(s),E=Number.isFinite(e.page)&&e.page>0?e.page:1,T=Number.isFinite(e.limit)&&e.limit>0?e.limit:20,o=e.search?String(e.search).toLowerCase():"",c=e.tag?String(e.tag).toLowerCase():"",_=e.format==="table"||!e.json&&!e.format&&Ze(e),X=e.json||e.format==="json",p=t.items;if(e.archived)p=p.filter((u)=>u.archived===!0);else if(!e.includeArchived)p=p.filter((u)=>!u.archived);if(o)p=p.filter((u)=>u.title.toLowerCase().includes(o)||u.content.toLowerCase().includes(o));if(c)p=p.filter((u)=>u.tags&&u.tags.map((Q)=>Q.toLowerCase()).includes(c));let{sorted:d,sort:C,direction:L}=ve(p,e),k=(E-1)*T,K=d.slice(k,k+T),z=Math.max(1,Math.ceil(d.length/T));if(X){y({ok:!0,page:E,limit:T,total:d.length,total_pages:z,sort:C,direction:L,items:K},!0);return}if(K.length===0){y(`No items found (search=${o||"none"}, tag=${c||"none"})`,!1);return}if(_){let u=(D)=>D,Q=`${u("ID")}	${u("TITLE")}	${u("CREATED")}	${u("URL")}	${u("TAGS")}`;console.log(Q);for(let D of K)console.log(`${D.id}	${u(D.title)}	${D.created_at}	${D.url?u(D.url):""}	${D.tags?.length?u(`[${D.tags.join(", ")}]`):""}`);console.log(`Page ${E}/${z} | showing ${K.length} of ${d.length} | sort=${C} ${L} | search=${o||"none"} | tag=${c||"none"}`)}else{for(let u of K)console.log(`${u.id}	${u.title}	${u.created_at}${u.url?`	${u.url}`:""}${u.tags?.length?`	[${u.tags.join(", ")}]`:""}`);console.log(`Page ${E}/${z} | showing ${K.length} of ${d.length} | sort=${C} ${L} | search=${o||"none"} | tag=${c||"none"}`)}});return}if(r==="get"){x(e),A(s,()=>{let E=R(s).items.find((T)=>T.id===e.id||T.short_id===e.id);if(!E)throw Error(`Item not found: ${e.id}`);y({ok:!0,item:E,message:`${E.id}: ${E.title}`},e.json)});return}if(r==="update"){x(e),A(s,()=>{let t=R(s),E=t.items.findIndex((o)=>o.id===e.id||o.short_id===e.id);if(E===-1)throw Error(`Item not found: ${e.id}`);let T=t.items[E];if(e.title!==void 0)T.title=e.title;if(e.content!==void 0)T.content=e.content;if(e.url!==void 0)T.url=e.url;if(e.tag!==void 0){if(T.tags=T.tags||[],!T.tags.map((o)=>o.toLowerCase()).includes(e.tag.toLowerCase()))T.tags.push(e.tag)}T.updated_at=new Date().toISOString(),t.items[E]=T,U(s,t),y({ok:!0,item:T,message:`Updated ${T.id}`},e.json)});return}if(r==="archive"||r==="restore"){x(e),A(s,()=>{let t=R(s),E=t.items.findIndex((o)=>o.id===e.id||o.short_id===e.id);if(E===-1)throw Error(`Item not found: ${e.id}`);let T=t.items[E];T.archived=r==="archive",T.updated_at=new Date().toISOString(),t.items[E]=T,U(s,t),y({ok:!0,item:T,message:`${r==="archive"?"Archived":"Restored"} ${T.id}`},e.json)});return}if(r==="untag"){if(x(e),!e.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");A(s,()=>{let t=R(s),E=t.items.findIndex((c)=>c.id===e.id||c.short_id===e.id);if(E===-1)throw Error(`Item not found: ${e.id}`);let T=t.items[E],o=T.tags?.length??0;T.tags=(T.tags??[]).filter((c)=>c.toLowerCase()!==e.tag.toLowerCase()),T.updated_at=new Date().toISOString(),t.items[E]=T,U(s,t),y({ok:!0,item:T,removed:o-T.tags.length,message:`Removed tag from ${T.id}`},e.json)});return}if(r==="upsert"){let t=e.title??i[1],E=e.content??i[2];A(s,()=>{let T=R(s),o=e.id?T.items.findIndex((X)=>X.id===e.id||X.short_id===e.id):-1,c=new Date().toISOString();if(o===-1){if(!t||!E)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let X=e.id??v(),p={id:X,short_id:ie(X),title:t,content:E,url:e.url??null,tags:e.tag?[e.tag]:[],metadata:{},archived:!1,created_at:c,updated_at:c};T.items.push(p),U(s,T),y({ok:!0,created:!0,item:p,message:`Upserted ${p.id}`},e.json);return}let _=T.items[o];if(t!==void 0)_.title=t;if(E!==void 0)_.content=E;if(e.url!==void 0)_.url=e.url;if(e.tag!==void 0){if(_.tags=_.tags||[],!_.tags.map((X)=>X.toLowerCase()).includes(e.tag.toLowerCase()))_.tags.push(e.tag)}_.updated_at=c,T.items[o]=_,U(s,T),y({ok:!0,created:!1,item:_,message:`Upserted ${_.id}`},e.json)});return}if(r==="delete"){if(x(e),!e.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");A(s,()=>{let t=R(s),E=t.items.length;t.items=t.items.filter((o)=>o.id!==e.id&&o.short_id!==e.id);let T=E!==t.items.length;if(U(s,t),!T)throw Error(`Item not found: ${e.id}`);I("info","Item deleted",{id:e.id}),y({ok:!0,deleted_id:e.id,message:`Deleted ${e.id}`},e.json)});return}if(r==="export"){let t=e.format??"json";if(t!=="json"&&t!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");A(s,()=>{let E=R(s);if(t==="jsonl")for(let T of E.items)console.log(JSON.stringify(T));else y({ok:!0,items:E.items},e.json)});return}if(r==="prune"){if(!e.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");A(s,()=>{let t=R(s),E=t.items.length;if(e.olderThan!==void 0){let o=new Date;o.setDate(o.getDate()-e.olderThan),t.items=t.items.filter((c)=>new Date(c.created_at)>=o)}if(e.empty)t.items=t.items.filter((o)=>o.content.trim().length>0);let T=E-t.items.length;U(s,t),I("info","Prune completed",{pruned:T,remaining:t.items.length}),y({ok:!0,pruned:T,remaining:t.items.length,message:`Pruned ${T} item(s)`},e.json)});return}if(r==="dedupe"){if(!e.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");A(s,()=>{let t=R(s),E=new Set,T=t.items.length;t.items=t.items.filter((c)=>{let _=`${c.title}\x00${c.content}`;if(E.has(_))return!1;return E.add(_),!0});let o=T-t.items.length;U(s,t),I("info","Dedupe completed",{removed:o,remaining:t.items.length}),y({ok:!0,removed:o,remaining:t.items.length,message:`Dedupe removed ${o} duplicate(s)`},e.json)});return}if(r==="stats"){A(s,()=>{let t=R(s),E=t.items.filter((L)=>!L.archived),T=E.length,o=t.items.length-T,c=E.filter((L)=>L.url).length,_=E.filter((L)=>L.tags&&L.tags.length>0).length,X=T>0?E.map((L)=>L.created_at).sort()[0]:null,p=T>0?E.map((L)=>L.created_at).sort()[T-1]:null,d={};for(let L of E)for(let k of L.tags||[])d[k]=(d[k]||0)+1;let C=Object.entries(d).sort((L,k)=>k[1]-L[1]).slice(0,5).map(([L,k])=>({tag:L,count:k}));y({ok:!0,total:T,archived:o,with_url:c,with_tags:_,oldest:X,newest:p,top_tags:C,message:`${T} items | ${c} with URL | ${_} with tags`},e.json)});return}let S=Ve(i[0]),g=S?` Did you mean '${S}'?`:"";throw I("warn","Unknown command",{input:i[0],suggestion:S}),Error(`Unknown command: ${i[0]}.${g} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)Pe(process.argv.slice(2)).catch((n)=>{let i=n instanceof Error?n.message:String(n);I("error","CLI error",{message:i,stack:n instanceof Error?n.stack:void 0}),console.error(`Error: ${i}`),process.exitCode=1});export{Ve as suggestCommand,ve as sortItems,Pe as run,Qe as parseArgs};
