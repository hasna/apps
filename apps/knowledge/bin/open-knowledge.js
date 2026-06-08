#!/usr/bin/env bun
// @bun
var C=import.meta.require;import{readFileSync as Z,writeFileSync as V,existsSync as Q,renameSync as Ge,unlinkSync as ye}from"fs";import{randomUUID as he}from"crypto";import{existsSync as Be,mkdirSync as oe,readFileSync as We,writeFileSync as Pe}from"fs";import{homedir as pe}from"os";import{dirname as He,join as w,resolve as qe}from"path";var ze=w(".hasna","apps","knowledge");function ae(){return w(pe(),".open-knowledge","db.json")}function ue(){return w(pe(),".hasna","apps","knowledge")}function Ye(e=process.cwd()){return qe(e,ze)}function H(e){return{home:e,configPath:w(e,"config.json"),jsonStorePath:w(e,"db.json"),knowledgeDbPath:w(e,"knowledge.db"),artifactsDir:w(e,"artifacts"),cacheDir:w(e,"cache"),exportsDir:w(e,"exports"),indexesDir:w(e,"indexes"),logsDir:w(e,"logs"),runsDir:w(e,"runs"),schemasDir:w(e,"schemas"),wikiDir:w(e,"wiki")}}function Je(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]},safety:{network:{web_search_enabled:!1,s3_reads_enabled:!1,allowed_s3_buckets:[]},redaction:{enabled:!0},approvals:{generated_writes_require_approval:!0}}}}function X(e){let n=H(e);oe(n.home,{recursive:!0});for(let t of[n.artifactsDir,n.cacheDir,n.exportsDir,n.indexesDir,n.logsDir,n.runsDir,n.schemasDir,n.wikiDir])oe(t,{recursive:!0});if(!Be(n.configPath))Pe(n.configPath,`${JSON.stringify(Je(),null,2)}
`);return n}function ge(e,n=process.cwd()){if(e==="project"||e==="local")return H(Ye(n));return H(ue())}function G(e){oe(He(e),{recursive:!0})}function F(e){let n=We(e,"utf8");return JSON.parse(n)}function ce(){return H(ue()).jsonStorePath}function de(e){if(!Q(e))if(G(e),e===ce()&&Q(ae()))V(e,Z(ae(),"utf8"));else V(e,JSON.stringify({items:[]},null,2))}function Ve(e){return`${e}.lock`}function Qe(e,n){let i=Date.now();while(Date.now()-i<5000){try{if(!Q(e)){V(e,JSON.stringify({owner:n,ts:Date.now()}));return}let l=JSON.parse(Z(e,"utf8"));if(Date.now()-l.ts>1e4)ye(e)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function Ze(e,n){try{if(Q(e)){if(JSON.parse(Z(e,"utf8")).owner===n)ye(e)}}catch{}}function L(e){de(e);let n=Z(e,"utf8"),t=JSON.parse(n);if(!t||!Array.isArray(t.items))return{items:[]};return t}function A(e,n){let t=`${e}.tmp.${he()}`;V(t,JSON.stringify(n,null,2)),Ge(t,e)}function k(e,n){let t=he(),r=Ve(e);Qe(r,t);try{return n()}finally{Ze(r,t)}}function _e(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function Re(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as et}from"bun:sqlite";var tt=`
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
`,nt=`
DROP TABLE IF EXISTS chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (2, datetime('now'));
`,rt=`
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uri TEXT,
  decision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_uri TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (3, datetime('now'));
`;function I(e){G(e);let n=new et(e);return n.exec("PRAGMA foreign_keys = ON;"),n}function D(e){let n=I(e);try{if(n.exec(tt),ee(n)<2)n.exec(nt);if(ee(n)<3)n.exec(rt);return{path:e,schema_version:ee(n)}}finally{n.close()}}function ee(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function v(e,n){return e.query(`SELECT COUNT(*) AS n FROM ${n}`).get()?.n??0}function Ne(e){let n=I(e);try{return{schema_version:ee(n),sources:v(n,"sources"),source_revisions:v(n,"source_revisions"),chunks:v(n,"chunks"),wiki_pages:v(n,"wiki_pages"),citations:v(n,"citations"),indexes:v(n,"knowledge_indexes"),runs:v(n,"runs"),run_events:v(n,"run_events"),redaction_findings:v(n,"redaction_findings"),audit_events:v(n,"audit_events"),approval_gates:v(n,"approval_gates")}}finally{n.close()}}import{existsSync as it,mkdirSync as be,readFileSync as st,writeFileSync as ot}from"fs";import{dirname as at,join as le,relative as ut,sep as ct}from"path";function q(e){let n=e.replace(/\\/g,"/").trim();if(!n||n.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let t=n.split("/").filter(Boolean);if(t.length===0||t.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${e}`);return t.join("/")}function fe(e,n){let t=ut(e,n);if(t.startsWith("..")||t===".."||t.startsWith(`..${ct}`))throw Error(`Artifact path escapes root: ${n}`)}class Se{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;be(e,{recursive:!0})}async put(e){let n=q(e.key),t=le(this.root,n);return fe(this.root,t),be(at(t),{recursive:!0}),ot(t,e.body),{key:n,uri:`file://${t}`}}async getText(e){let n=q(e),t=le(this.root,n);return fe(this.root,t),st(t,"utf8")}async exists(e){let n=q(e),t=le(this.root,n);return fe(this.root,t),it(t)}}class Oe{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:n}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?n({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let n=q(e),t=this.options.prefix?q(this.options.prefix):"";return t?`${t}/${n}`:n}async put(e){let[{PutObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e.key);return await t.send(new n({Bucket:this.options.bucket,Key:r,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(e){let[{GetObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e),i=await t.send(new n({Bucket:this.options.bucket,Key:r}));if(!i.Body)return"";return await i.Body.transformToString()}async exists(e){let[{HeadObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e);try{return await t.send(new n({Bucket:this.options.bucket,Key:r})),!0}catch(i){let s=i instanceof Error?i.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw i}}}function me(e,n){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new Oe({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new Se(n.artifactsDir)}function dt(e){let n=String(e.getUTCFullYear()),t=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return{year:n,month:t,day:r}}function _t(){return`# Knowledge Agent Schema v1

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
`}function lt(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function ft(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function we(e,n=new Date){let{year:t,month:r,day:i}=dt(n),s="schemas/v1.md",l="indexes/root.md",T="wiki/README.md",o=`logs/${t}/${r}/${i}.jsonl`,a={ts:n.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},c=[e.put({key:"schemas/v1.md",body:_t(),content_type:"text/markdown"}),e.put({key:"indexes/root.md",body:lt(),content_type:"text/markdown"}),e.put({key:"wiki/README.md",body:ft(),content_type:"text/markdown"}),e.put({key:o,body:`${JSON.stringify(a)}
`,content_type:"application/x-ndjson"})];return await Promise.all(c),{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:o,written:["schemas/v1.md","indexes/root.md","wiki/README.md",o]}}import{createHash as mt}from"crypto";import{existsSync as wt,readFileSync as Lt}from"fs";import{basename as kt}from"path";function Le(e,n){if(!e)throw Error(n);return e}function Et(e){let t=e.slice(13).split("/").filter(Boolean),r=t[0];if(r!=="file"&&r!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let i=Le(t[1],"Invalid open-files ref. Missing id.");if(r==="file"){if(t.length===2)return{kind:"open-files",uri:e,entity:r,id:i};if(t[2]==="revision"&&t[3]&&t.length===4)return{kind:"open-files",uri:e,entity:r,id:i,revision_id:decodeURIComponent(t[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let s=t.indexOf("path"),l=s>=0?decodeURIComponent(t.slice(s+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:r,id:i,path:l}}function Tt(e){let n=new URL(e),t=Le(n.hostname,"Invalid s3 ref. Missing bucket."),r=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!r)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:t,key:r}}function pt(e){let n=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(n.pathname)}}function gt(e){let n=new URL(e);return{kind:"web",uri:e,url:n.toString()}}function j(e){if(e.startsWith("open-files://"))return Et(e);if(e.startsWith("s3://"))return Tt(e);if(e.startsWith("file://"))return pt(e);if(e.startsWith("https://")||e.startsWith("http://"))return gt(e);throw Error(`Unsupported source ref scheme: ${e}`)}function ke(e,n=j(e)){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function xe(e){let n=j(e);return n.kind==="open-files"&&n.entity==="file"?n.revision_id??null:null}import{createHash as yt,randomUUID as Ee}from"crypto";import{relative as ht,resolve as Ae,sep as Rt}from"path";function ve(e){let n=process.env[e];return n==="1"||n==="true"||n==="yes"}function z(e,n){let t=e,r=new Set(t.safety?.network?.allowed_s3_buckets??[]);if(e.storage.type==="s3"&&e.storage.s3?.bucket)r.add(e.storage.s3.bucket);if(process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS)for(let i of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(",").map((s)=>s.trim()).filter(Boolean))r.add(i);return{mode:e.mode,allowWriteRoots:[n.home,n.artifactsDir,n.cacheDir,n.exportsDir,n.indexesDir,n.logsDir,n.runsDir,n.schemasDir,n.wikiDir].map((i)=>Ae(i)),readOnlySourceAccess:!0,network:{webSearchEnabled:t.safety?.network?.web_search_enabled??ve("HASNA_KNOWLEDGE_WEB_SEARCH"),s3ReadsEnabled:t.safety?.network?.s3_reads_enabled??ve("HASNA_KNOWLEDGE_ALLOW_S3_READS"),allowedS3Buckets:[...r].sort()},redaction:{enabled:t.safety?.redaction?.enabled??!0},approvals:{generatedWritesRequireApproval:t.safety?.approvals?.generated_writes_require_approval??!0}}}function Nt(e,n){let t=ht(e,n);return t===""||!t.startsWith("..")&&t!==".."&&!t.startsWith(`..${Rt}`)}function K(e,n){let t=Ae(e);if(!n.allowWriteRoots.some((r)=>Nt(r,t)))throw Error(`Safety policy denied write outside .hasna/apps/knowledge: ${e}`)}function $(e,n){let r=new URL(e).hostname;if(!n.network.s3ReadsEnabled)throw Error("Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.");if(!n.network.allowedS3Buckets.includes(r))throw Error(`Safety policy denied S3 bucket "${r}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`)}function Ie(e){if(!e.network.webSearchEnabled)throw Error("Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.")}var bt=[{type:"private_key_block",severity:"high",regex:/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,replacement:"[REDACTED:private_key_block]"},{type:"secret_assignment",severity:"high",regex:/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,replacement:"[REDACTED:secret_assignment]"},{type:"openai_api_key",severity:"high",regex:/\bsk-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:openai_api_key]"},{type:"anthropic_api_key",severity:"high",regex:/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:anthropic_api_key]"},{type:"aws_access_key_id",severity:"high",regex:/\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g,replacement:"[REDACTED:aws_access_key_id]"}];function te(e,n){if(n&&!n.redaction.enabled)return{text:e,findings:[]};let t=e,r=[];for(let i of bt)t=t.replace(i.regex,(s,...l)=>{let T=typeof l.at(-2)==="number"?l.at(-2):t.indexOf(s);return r.push({type:i.type,severity:i.severity,start:Math.max(0,T),end:Math.max(0,T+s.length)}),i.replacement});return{text:t,findings:r}}function St(e){return`audit_${yt("sha256").update(`${e.event_type}\x00${e.action}\x00${e.target_uri??""}\x00${e.created_at??""}\x00${JSON.stringify(e.metadata??{})}\x00${Ee()}`).digest("hex").slice(0,24)}`}function S(e,n){let t=n.created_at??new Date().toISOString(),r=St({...n,created_at:t});return e.run(`INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,[r,n.event_type,n.action,n.target_uri??null,n.decision,JSON.stringify(n.metadata??{}),t]),r}function ne(e,n){let t=n.created_at??new Date().toISOString();for(let r of n.findings)e.run(`INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[`redact_${Ee()}`,n.source_uri??null,n.run_id??null,r.severity,r.type,JSON.stringify({...n.metadata??{},start:r.start,end:r.end}),t]);return n.findings.length}function De(e,n){let t=n.created_at??new Date().toISOString(),r=`approval_${Ee()}`;return e.run(`INSERT INTO approval_gates (id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[r,n.action,n.target_uri??null,"approved",n.reason??null,n.approved_by??"local-cli",JSON.stringify(n.metadata??{}),t,t]),{id:r,status:"approved"}}function Ot(e,n,t){let r=e.query(`SELECT id FROM approval_gates
     WHERE action = ? AND status = 'approved' AND (target_uri IS NULL OR target_uri = ? OR ? IS NULL)
     ORDER BY updated_at DESC LIMIT 1`).get(n,t??null,t??null);return Boolean(r)}function Ue(e,n,t,r){let i=t==="generated_write"&&n.approvals.generatedWritesRequireApproval,s=!i||Ot(e,t,r);return{action:t,target_uri:r??null,approval_required:i,approved:s,decision:s?"allow":"requires_approval"}}function Te(e,n){return`${e}_${mt("sha256").update(n).digest("hex").slice(0,20)}`}function B(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function y(e){return typeof e==="string"&&e.length>0?e:void 0}function xt(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function vt(e){let n=y(e.source_ref)??y(e.source_uri)??y(e.uri);if(n)return n;let t=y(e.file_id);if(t){let s=y(e.revision_id)??y(e.revision),l=`open-files://file/${encodeURIComponent(t)}`;return s?`${l}/revision/${encodeURIComponent(s)}`:l}let r=y(e.source_id),i=y(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function At(e,n){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function It(e){let n=y(e.extracted_text)??y(e.text)??y(e.content_text)??y(e.markdown);if(n!==void 0)return n;let t=e.content;return typeof t==="string"?t:null}function Dt(e){let n=y(e.extracted_text_ref)??y(e.extracted_text_uri)??y(e.text_ref);if(n)return n;let t=B(e.content);return y(t?.extracted_text_ref)??y(t?.extracted_text_uri)??null}function Ut(e){let n=y(e.path);return y(e.title)??y(e.name)??(n?kt(n):null)}function Ct(e){return y(e.hash)??y(e.checksum)??y(e.sha256)??null}function Xt(e,n,t){return y(e.revision_id)??y(e.revision)??y(e.version_id)??(n.kind==="open-files"?n.revision_id:void 0)??t??y(e.updated_at)??"current"}function jt(e,n){let t={};for(let[r,i]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(r))continue;t[r]=i}return t.source_ref=n.sourceRef,t.source_uri=n.sourceUri,t.status=n.status,t}function Ft(e,n){let t=vt(e),r=j(t),i=At(t,r),s=Ct(e),l=y(e.status)??"active";return{raw:e,sourceRef:t,sourceUri:i,kind:r.kind,title:Ut(e),revision:Xt(e,r,s),hash:s,extractedTextUri:Dt(e),text:It(e),metadata:jt(e,{sourceRef:t,sourceUri:i,status:l}),acl:e.permissions??e.acl??{},status:l,updatedAt:y(e.updated_at)??n}}function Mt(e){let n=e.trim();if(!n)return[];if(n.startsWith("[")){let t=JSON.parse(n);if(!Array.isArray(t))throw Error("Manifest array parse failed.");return t.map((r)=>{let i=B(r);if(!i)throw Error("Manifest array entries must be objects.");return i})}if(n.startsWith("{"))try{let t=JSON.parse(n),r=B(t);if(!r)throw Error("Manifest object parse failed.");if(Array.isArray(r.items))return r.items.map((i)=>{let s=B(i);if(!s)throw Error("Manifest items entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(t){let r=n.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw t;return r.map((i)=>{let s=B(JSON.parse(i));if(!s)throw Error("Manifest JSONL entries must be objects.");return s})}return n.split(/\r?\n/).filter((t)=>t.trim().length>0).map((t)=>{let r=B(JSON.parse(t));if(!r)throw Error("Manifest JSONL entries must be objects.");return r})}async function Kt(e,n,t){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 manifest URI: ${e}`);if(t)$(e,t);let[{S3Client:l,GetObjectCommand:T},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),a=n?.storage.type==="s3"&&n.storage.s3?.bucket===i?n.storage.s3:void 0,u=await new l({region:a?.region,credentials:a?.profile?o({profile:a.profile}):void 0,maxAttempts:a?.max_attempts}).send(new T({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function $t(e,n,t){if(e.startsWith("s3://"))return Kt(e,n,t);if(!wt(e))throw Error(`Manifest not found: ${e}`);return Lt(e,"utf8")}function Bt(e,n,t){let r=e.replace(/\r\n/g,`
`);if(!r.trim())return[];let i=[],s=0;while(s<r.length){let l=Math.min(r.length,s+n),T=l;if(l<r.length){let a=r.lastIndexOf(`

`,l),c=r.lastIndexOf(". ",l),u=Math.max(a,c);if(u>s+Math.floor(n*0.5))T=u+(u===a?2:1)}let o=r.slice(s,T).trim();if(o)i.push({ordinal:i.length,text:o,startOffset:s,endOffset:T});if(T>=r.length)break;s=Math.max(0,T-t)}return i}function Wt(e){let n=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(n*1.25))}function Pt(e,n){let t=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(n);for(let r of t)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[r.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[n]),t.length}function Ht(e,n,t){let r=Te("src",n.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[r,n.sourceUri,n.kind,n.title,JSON.stringify(n.metadata),JSON.stringify(n.acl??{}),t,n.updatedAt]);let i=e.query("SELECT id FROM sources WHERE uri = ?").get(n.sourceUri);if(!i)throw Error(`Failed to upsert source: ${n.sourceUri}`);return i.id}function qt(e,n,t,r){let i=Te("rev",`${n}\x00${t.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[i,n,t.revision,t.hash,t.extractedTextUri,JSON.stringify(t.metadata),r]);let s=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(n,t.revision);if(!s)throw Error(`Failed to upsert source revision: ${t.sourceRef}`);return s.id}function zt(e,n,t,r,i,s,l){if(!t.text||t.status.toLowerCase()==="deleted")return{chunksInserted:0,redactions:0};let T=te(t.text,l);if(T.findings.length>0)ne(e,{source_uri:t.sourceUri,findings:T.findings,metadata:{source_ref:t.sourceRef,revision:t.revision},created_at:r}),S(e,{event_type:"redaction",action:"source_text_redact",target_uri:t.sourceUri,decision:"redacted",metadata:{findings:T.findings.length,source_ref:t.sourceRef,revision:t.revision},created_at:r});let o=Bt(T.text,i,s);for(let a of o){let c=Te("chk",`${n}\x00${a.ordinal}\x00${a.text}`),u={source_ref:t.sourceRef,source_uri:t.sourceUri,hash:t.hash,status:t.status,path:y(t.raw.path)??null,mime:y(t.raw.mime)??y(t.raw.content_type)??null,size:xt(t.raw.size)??null};e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[c,n,"source",a.ordinal,a.text,Wt(a.text),a.startOffset,a.endOffset,JSON.stringify(u),r]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[c,a.text,t.title??"",t.sourceUri])}return{chunksInserted:o.length,redactions:T.findings.length}}async function Ce(e){let n=(e.now??new Date).toISOString(),t=e.maxChunkChars??4000,r=e.chunkOverlapChars??200;if(t<500)throw Error("maxChunkChars must be at least 500.");if(r<0||r>=t)throw Error("chunkOverlapChars must be less than maxChunkChars.");if(e.safetyPolicy)K(e.dbPath,e.safetyPolicy);D(e.dbPath);let i=await $t(e.input,e.config,e.safetyPolicy),s=Mt(i),l=I(e.dbPath);try{return l.transaction(()=>{let o=new Set,a=new Set,c=0,u=0,_=0,d=0;S(l,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_manifest_read":"local_manifest_read",target_uri:e.input,decision:"allow",metadata:{items:s.length,read_only:!0},created_at:n});for(let f of s){let p=Ft(f,n),E=Ht(l,p,n),O=qt(l,E,p,n);if(o.add(E),a.add(O),p.text||p.status.toLowerCase()==="deleted")u+=Pt(l,O);let h=zt(l,O,p,n,t,r,e.safetyPolicy);c+=h.chunksInserted,_+=h.redactions}return S(l,{event_type:"write",action:"knowledge_manifest_ingest",target_uri:e.dbPath,decision:"allow",metadata:{items:s.length,sources:o.size,revisions:a.size,chunks_inserted:c,redactions:_},created_at:n}),{path:e.input,db_path:e.dbPath,items_seen:s.length,sources_upserted:o.size,revisions_upserted:a.size,chunks_inserted:c,chunks_deleted:u,redactions:_,skipped:d}})()}finally{l.close()}}import{createHash as Yt,randomUUID as Jt}from"crypto";import{existsSync as Gt,readFileSync as Vt}from"fs";import{basename as Qt}from"path";function re(e,n){return`${e}_${Yt("sha256").update(n).digest("hex").slice(0,20)}`}function W(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function b(e){return typeof e==="string"&&e.length>0?e:void 0}function Zt(e){let n=b(e.source_ref)??b(e.source_uri)??b(e.uri);if(n)return n;let t=b(e.file_id);if(t){let s=b(e.revision_id)??b(e.revision),l=`open-files://file/${encodeURIComponent(t)}`;return s?`${l}/revision/${encodeURIComponent(s)}`:l}let r=b(e.source_id),i=b(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Outbox event is missing source_ref, file_id, or source_id/path.")}function en(e,n){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function tn(e){return b(e.hash)??b(e.checksum)??b(e.sha256)??null}function nn(e,n,t){return b(e.revision_id)??b(e.revision)??b(e.version_id)??(n.kind==="open-files"?n.revision_id:void 0)??t??null}function rn(e){return(b(e.event)??b(e.type)??b(e.action)??b(e.change_type)??"changed").toLowerCase()}function sn(e){let n=b(e.path);return b(e.title)??b(e.name)??(n?Qt(n):null)}function on(e,n){let t=Zt(e),r=j(t),i=tn(e);return{raw:e,eventType:rn(e),sourceRef:t,sourceUri:en(t,r),kind:r.kind,title:sn(e),revision:nn(e,r,i),hash:i,status:b(e.status)?.toLowerCase()??null,updatedAt:b(e.updated_at)??n,acl:e.permissions??e.acl??void 0}}function an(e){let n=e.trim();if(!n)return[];if(n.startsWith("[")){let t=JSON.parse(n);if(!Array.isArray(t))throw Error("Outbox array parse failed.");return t.map((r)=>{let i=W(r);if(!i)throw Error("Outbox array entries must be objects.");return i})}if(n.startsWith("{"))try{let t=JSON.parse(n),r=W(t);if(!r)throw Error("Outbox object parse failed.");if(Array.isArray(r.events))return r.events.map((i)=>{let s=W(i);if(!s)throw Error("Outbox events entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(t){let r=n.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw t;return r.map((i)=>{let s=W(JSON.parse(i));if(!s)throw Error("Outbox JSONL entries must be objects.");return s})}return n.split(/\r?\n/).filter((t)=>t.trim().length>0).map((t)=>{let r=W(JSON.parse(t));if(!r)throw Error("Outbox JSONL entries must be objects.");return r})}async function un(e,n,t){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 outbox URI: ${e}`);if(t)$(e,t);let[{S3Client:l,GetObjectCommand:T},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),a=n?.storage.type==="s3"&&n.storage.s3?.bucket===i?n.storage.s3:void 0,u=await new l({region:a?.region,credentials:a?.profile?o({profile:a.profile}):void 0,maxAttempts:a?.max_attempts}).send(new T({Bucket:i,Key:s}));if(!u.Body)return"";return await u.Body.transformToString()}async function cn(e,n,t){if(e.startsWith("s3://"))return un(e,n,t);if(!Gt(e))throw Error(`Outbox not found: ${e}`);return Vt(e,"utf8")}function Xe(e,n){let t={};if(e)try{t=W(JSON.parse(e))??{}}catch{t={}}return JSON.stringify({...t,...n})}function dn(e,n,t){let r=re("src",n.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,[r,n.sourceUri,n.kind,n.title,JSON.stringify({source_ref:n.sourceRef,source_uri:n.sourceUri,status:n.status,last_outbox_event:n.eventType}),JSON.stringify(n.acl??{}),t,n.updatedAt]);let i=e.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(n.sourceUri);if(!i)throw Error(`Failed to upsert source for outbox event: ${n.sourceUri}`);let s={source_ref:n.sourceRef,source_uri:n.sourceUri,last_outbox_event:n.eventType,last_outbox_at:n.updatedAt};if(n.status)s.status=n.status;if(b(n.raw.path))s.path=n.raw.path;return e.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?",[Xe(i.metadata_json,s),n.acl===void 0?null:JSON.stringify(n.acl),n.acl===void 0?null:JSON.stringify(n.acl),n.updatedAt,i.id]),i.id}function _n(e,n,t,r){if(!t.revision)return null;let i=re("rev",`${n}\x00${t.revision}`),s={source_ref:t.sourceRef,source_uri:t.sourceUri,status:t.status,last_outbox_event:t.eventType,reindex_required:!0};return e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,[i,n,t.revision,t.hash,b(t.raw.extracted_text_ref)??null,JSON.stringify(s),r]),e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(n,t.revision)?.id??null}function ln(e,n,t){if(t.revision)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(n,t.revision).map((r)=>r.id);if(t.hash)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(n,t.hash).map((r)=>r.id);return e.query("SELECT id FROM source_revisions WHERE source_id = ?").all(n).map((r)=>r.id)}function fn(e,n){let t=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(n),r=0;for(let s of t){let l=e.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(s.id);r+=l?.n??0,e.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?",[s.id]),e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[s.id])}e.run("DELETE FROM chunks WHERE source_revision_id = ?",[n]);let i=e.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(n);return e.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?",[Xe(i?.metadata_json,{reindex_required:!0,invalidated_at:new Date().toISOString()}),n]),{chunksDeleted:t.length,embeddingsDeleted:r}}function En(e,n){return n==="deleted"||["delete","deleted","remove","removed"].includes(e)}function Tn(e){return["move","moved","rename","renamed","path_changed"].includes(e)}function pn(e){return["permission","permissions","permission_changed","acl_changed"].includes(e)}async function je(e){let n=(e.now??new Date).toISOString();if(e.safetyPolicy)K(e.dbPath,e.safetyPolicy);D(e.dbPath);let t=await cn(e.input,e.config,e.safetyPolicy),r=an(t),i=I(e.dbPath),s=`run_${Jt()}`;try{return i.transaction(()=>{i.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[s,"open-files-outbox",e.input,"completed","local","open-files-outbox",JSON.stringify({path:e.input,events:r.length}),n,n]);let l=new Set,T=new Set,o=0,a=0,c=0,u=0,_=0,d=0;return S(i,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_outbox_read":"local_outbox_read",target_uri:e.input,decision:"allow",metadata:{events:r.length,read_only:!0},created_at:n}),r.forEach((f,p)=>{let E=on(f,n),O=dn(i,E,n);l.add(O);let h=_n(i,O,E,n);if(h)T.add(h);let m=ln(i,O,E);for(let g of m){T.add(g);let x=fn(i,g);o+=x.chunksDeleted,a+=x.embeddingsDeleted,c+=1}if(En(E.eventType,E.status))u+=1;if(Tn(E.eventType))_+=1;if(pn(E.eventType)||E.acl!==void 0)d+=1;i.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,[re("evt",`${s}\x00${p}\x00${E.sourceRef}\x00${E.eventType}`),s,"info",E.eventType,JSON.stringify({source_ref:E.sourceRef,source_uri:E.sourceUri,revision:E.revision,hash:E.hash,status:E.status,affected_revisions:m.length}),E.updatedAt])}),i.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,[re("usage",s),s,"local","open-files-outbox",JSON.stringify({note:"No model provider used for outbox invalidation."}),n]),S(i,{event_type:"write",action:"knowledge_outbox_invalidation",target_uri:e.dbPath,decision:"allow",metadata:{run_id:s,events:r.length,sources:l.size,revisions:T.size,chunks_deleted:o,embeddings_deleted:a},created_at:n}),{path:e.input,db_path:e.dbPath,run_id:s,events_seen:r.length,sources_touched:l.size,revisions_touched:T.size,chunks_deleted:o,embeddings_deleted:a,stale_revisions:c,deleted_sources:u,moved_sources:_,permission_updates:d}})()}finally{i.close()}}function ie(e){if(!e)return{};try{let n=JSON.parse(e);return n&&typeof n==="object"&&!Array.isArray(n)?n:{}}catch{return{}}}function P(e,n){for(let t of n){let r=e[t];if(typeof r==="string"&&r.length>0)return r}return null}function Fe(e,n){for(let t of n){let r=e[t];if(typeof r==="number"&&Number.isFinite(r))return r}return null}function gn(e,n){let t=e.mode;if(typeof t==="string"&&t!=="read_only")throw Error(`Source resolver denied ${n}. Permission mode is ${t}, expected read_only.`);let r=e.denied_purposes;if(Array.isArray(r)&&r.includes(n))throw Error(`Source resolver denied ${n}. Purpose is explicitly denied.`);let i=e.allowed_purposes;if(Array.isArray(i)&&i.length>0&&!i.includes(n))throw Error(`Source resolver denied ${n}. Allowed purposes: ${i.join(", ")}`)}function yn(e,n,t){if(!n)return t;try{let r=j(e);if(r.kind==="open-files"&&r.entity==="file")return`${e}/revision/${encodeURIComponent(n.revision)}`}catch{return t}return t}function hn(e,n,t){return e.query(`SELECT id, uri, kind, title, metadata_json, acl_json, updated_at
     FROM sources
     WHERE uri = ? OR uri = ?
     ORDER BY CASE WHEN uri = ? THEN 0 ELSE 1 END
     LIMIT 1`).get(n,t,n)??null}function Rn(e,n,t){if(t)return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
       FROM source_revisions
       WHERE source_id = ? AND revision = ?
       LIMIT 1`).get(n,t)??null;return e.query(`SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
     FROM source_revisions
     WHERE source_id = ?
     ORDER BY created_at DESC, revision DESC
     LIMIT 1`).get(n)??null}function Nn(e,n){if(!n)return 0;return e.query("SELECT COUNT(*) AS n FROM chunks WHERE source_revision_id = ?").get(n)?.n??0}function bn(e,n,t){if(!n||t<=0)return[];return e.query(`SELECT id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json
     FROM chunks
     WHERE source_revision_id = ?
     ORDER BY ordinal ASC
     LIMIT ?`).all(n,t)}async function Me(e){let n=e.purpose??"knowledge_answer",t=Math.max(0,Math.min(e.limit??10,100)),r=(e.now??new Date).toISOString(),i=j(e.sourceRef),s=ke(e.sourceRef,i),l=xe(e.sourceRef);if(e.safetyPolicy){if(!e.safetyPolicy.readOnlySourceAccess)throw Error("Safety policy denied source resolution.");K(e.dbPath,e.safetyPolicy)}D(e.dbPath);let T=I(e.dbPath);try{return T.transaction(()=>{let o=hn(T,s,e.sourceRef);if(!o)return S(T,{event_type:"source_read",action:"open_files_resolve_missing",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:n,read_only:!0,source_uri:s},created_at:r}),{source_ref:e.sourceRef,source_uri:s,purpose:n,read_only:!0,resolved:!1,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:null,revision:null,content:{mime:null,size:null,hash:null,text_available:!1,chunks_total:0,chunks_returned:0,char_count_returned:0,extracted_text_ref:null,bytes_available:!1,bytes_exposed:!1},chunks:[],citations:[]};let a=ie(o.metadata_json),c=ie(o.acl_json);try{gn(c,n)}catch(g){throw S(T,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"deny",metadata:{purpose:n,read_only:!0,source_uri:o.uri,error:g instanceof Error?g.message:String(g)},created_at:r}),g}let u=Rn(T,o.id,l),_=ie(u?.metadata_json),d=Nn(T,u?.id??null),f=bn(T,u?.id??null,t),p=yn(o.uri,u,e.sourceRef),E=f.map((g)=>{let x=ie(g.metadata_json),R={resolver:"open-files-read-only",mode:"local_catalog",purpose:n,read_only:!0,source_ref:P(x,["source_ref"])??p,source_uri:o.uri,source_revision_id:u?.id??null,revision:u?.revision??null,hash:u?.hash??P(x,["hash"]),chunk_id:g.id,start_offset:g.start_offset,end_offset:g.end_offset,resolved_at:r};return{id:g.id,kind:g.kind,ordinal:g.ordinal,text:g.text,token_count:g.token_count,start_offset:g.start_offset,end_offset:g.end_offset,metadata:x,evidence:R}}),O=E.map((g)=>({source_ref:g.evidence.source_ref,source_uri:o.uri,chunk_id:g.id,quote:g.text.slice(0,500),start_offset:g.start_offset,end_offset:g.end_offset,evidence:g.evidence}));S(T,{event_type:"source_read",action:"open_files_resolve",target_uri:e.sourceRef,decision:"allow",metadata:{purpose:n,read_only:!0,source_uri:o.uri,revision:u?.revision??null,chunks_returned:E.length,chunks_total:d},created_at:r});let h=P(a,["mime","content_type"])??P(_,["mime","content_type"]),m=Fe(a,["size","size_bytes"])??Fe(_,["size","size_bytes"]);return{source_ref:p,source_uri:o.uri,purpose:n,read_only:!0,resolved:!0,resolver:{name:"open-files-read-only",mode:"local_catalog",contract:"open-files-knowledge-source-v1"},source:{id:o.id,uri:o.uri,kind:o.kind,title:o.title,metadata:a,permissions:c,updated_at:o.updated_at},revision:u?{id:u.id,revision:u.revision,hash:u.hash,extracted_text_uri:u.extracted_text_uri,metadata:_,created_at:u.created_at,reindex_required:_.reindex_required===!0}:null,content:{mime:h,size:m,hash:u?.hash??P(a,["hash","checksum","sha256"]),text_available:d>0,chunks_total:d,chunks_returned:E.length,char_count_returned:E.reduce((g,x)=>g+x.text.length,0),extracted_text_ref:u?.extracted_text_uri??P(_,["extracted_text_ref","extracted_text_uri"]),bytes_available:!1,bytes_exposed:!1},chunks:E,citations:O}})()}finally{T.close()}}var Y={name:"@hasna/knowledge",version:"0.2.8",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@modelcontextprotocol/sdk":"^1.29.0",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var Ke={debug:0,info:1,warn:2,error:3},On=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function M(e,n,t){if(Ke[e]<Ke[On()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],i=t?`${r} ${n} ${JSON.stringify(t)}`:`${r} ${n}`;if(e==="error")console.error(i);else console.error(i)}var mn=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","db","wiki","source","ingest","reindex","safety","help"],$e={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function wn(e){let n=[],t={};for(let r=0;r<e.length;r+=1){let i=e[r];if(!i.startsWith("-")){n.push(i);continue}switch(i){case"--json":t.json=!0;break;case"--yes":case"-y":t.yes=!0;break;case"--help":case"-h":t.help=!0;break;case"--version":case"-v":t.version=!0;break;case"--desc":t.desc=!0;break;case"--page":case"-p":t.page=Number(e[r+1]),r+=1;break;case"--limit":case"-l":t.limit=Number(e[r+1]),r+=1;break;case"--search":case"-s":t.search=e[r+1],r+=1;break;case"--sort":t.sort=e[r+1],r+=1;break;case"--id":t.id=e[r+1],r+=1;break;case"--store":t.store=e[r+1],r+=1;break;case"--title":t.title=e[r+1],r+=1;break;case"--content":t.content=e[r+1],r+=1;break;case"--url":t.url=e[r+1],r+=1;break;case"--tag":case"-t":t.tag=e[r+1],r+=1;break;case"--format":t.format=e[r+1],r+=1;break;case"--completions":t.completions=e[r+1],r+=1;break;case"--purpose":t.purpose=e[r+1],r+=1;break;case"--no-color":t.noColor=!0;break;case"--scope":t.scope=e[r+1],r+=1;break;case"--older-than":t.olderThan=Number(e[r+1]),r+=1;break;case"--empty":t.empty=!0;break;case"--archived":t.archived=!0;break;case"--include-archived":t.includeArchived=!0;break;default:throw Error(`Unknown flag: ${i}. Run 'open-knowledge --help' for valid options.`)}}return{positional:n,flags:t}}function Ln(e){if(!e)return"";return $e[e]??e}function kn(e,n){let t=Array.from({length:e.length+1},()=>Array(n.length+1).fill(0));for(let r=0;r<=e.length;r+=1)t[r][0]=r;for(let r=0;r<=n.length;r+=1)t[0][r]=r;for(let r=1;r<=e.length;r+=1)for(let i=1;i<=n.length;i+=1){let s=e[r-1]===n[i-1]?0:1;t[r][i]=Math.min(t[r-1][i]+1,t[r][i-1]+1,t[r-1][i-1]+s)}return t[e.length][n.length]}function xn(e){if(!e)return"";let n=[...mn,...Object.keys($e)],t="",r=Number.POSITIVE_INFINITY;for(let i of n){let s=kn(e,i);if(s<r)r=s,t=i}return r<=3?t:""}function vn(){console.log(`open-knowledge - local agent knowledge store

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
  source resolve <source-ref>  Resolve read-only source content and citation evidence
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  reindex outbox <file|s3://>  Consume open-files change events and invalidate chunks
  safety status|check|approve|audit|redact
  help [command]               Show help

Global Options:
  --json                      Output JSON
  --store <path>              Override store path
  --purpose <name>            Read-only source purpose (default: knowledge_answer)
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
  --empty                     Remove items with empty content`)}function An(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="source"){console.log("Usage: open-knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="reindex"){console.log("Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="safety"){console.log("Usage: open-knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]");return}vn()}function In(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function N(e,n,t){if(n){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function J(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function Dn(e,n){let t=n.sort??"created";if(t!=="created"&&t!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...e].sort((i,s)=>{if(t==="title")return i.title.localeCompare(s.title);return i.created_at.localeCompare(s.created_at)});if(n.desc)r.reverse();return{sorted:r,sort:t,direction:n.desc?"desc":"asc"}}async function Un(e){let{positional:n,flags:t}=wn(e);if(M("debug","CLI invoked",{command:n[0],flags:{json:t.json,store:t.store}}),t.version){console.log(t.json?JSON.stringify({name:Y.name,version:Y.version},null,2):`${Y.name} ${Y.version}`);return}if(t.completions){let o=t.completions;if(o==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --purpose --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(o==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--purpose)--purpose[purpose]:" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(o==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki source ingest reindex safety help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l purpose; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=Ln(n[0]);if(!r||t.help||r==="help"){An(n[1]);return}let i=ge(t.scope),s=t.store;if(!s)if(t.scope==="project"||t.scope==="local")s=X(i.home).jsonStorePath;else s=ce();if(r==="paths"){let o=X(i.home);N({ok:!0,scope:t.scope??"global",home:o.home,config_path:o.configPath,json_store_path:o.jsonStorePath,knowledge_db_path:o.knowledgeDbPath,artifacts_dir:o.artifactsDir,indexes_dir:o.indexesDir,logs_dir:o.logsDir,runs_dir:o.runsDir,schemas_dir:o.schemasDir,wiki_dir:o.wikiDir,config:F(o.configPath),message:o.home},t.json);return}if(r==="db"){let o=n[1]??"init",a=X(i.home);if(o!=="init"&&o!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(o==="init"){let u=D(a.knowledgeDbPath);N({ok:!0,...u,message:`Initialized ${u.path}`},t.json);return}D(a.knowledgeDbPath);let c=Ne(a.knowledgeDbPath);N({ok:!0,path:a.knowledgeDbPath,...c,message:`knowledge.db schema v${c.schema_version}`},t.json);return}if(r==="wiki"){if((n[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let a=X(i.home),c=F(a.configPath),u=me(c,a),_=await we(u);N({ok:!0,..._,message:`Initialized wiki layout in ${a.home}`},t.json);return}if(r==="safety"){let o=n[1]??"status",a=X(i.home),c=F(a.configPath),u=z(c,a);D(a.knowledgeDbPath);let _=I(a.knowledgeDbPath);try{if(o==="status"){N({ok:!0,mode:u.mode,workspace:a.home,allow_write_roots:u.allowWriteRoots,read_only_source_access:u.readOnlySourceAccess,network:u.network,redaction:u.redaction,approvals:u.approvals,message:`Safety policy: ${u.mode}`},t.json);return}if(o==="check"){let d=n[2]??"generated_write",f=n[3]??null,p;try{if(d==="web_search")Ie(u),p={action:d,target_uri:f,approval_required:!1,approved:!0,decision:"allow"};else if(d==="s3_read"){if(!f)throw Error("safety check s3_read requires an s3:// target.");$(f,u),p={action:d,target_uri:f,approval_required:!1,approved:!0,decision:"allow"}}else p=Ue(_,u,d,f);S(_,{event_type:"safety_check",action:d,target_uri:f,decision:p.decision==="allow"?"allow":"requires_approval",metadata:p}),N({ok:!0,...p,message:`Safety check ${p.decision}`},t.json);return}catch(E){throw S(_,{event_type:"safety_check",action:d,target_uri:f,decision:"deny",metadata:{error:E instanceof Error?E.message:String(E)}}),E}}if(o==="approve"){let d=n[2]??"generated_write",f=n[3]??null,p=De(_,{action:d,target_uri:f,reason:"local-cli approval",metadata:{scope:t.scope??"global"}});S(_,{event_type:"approval",action:d,target_uri:f,decision:"allow",metadata:{approval_id:p.id}}),N({ok:!0,...p,action:d,target_uri:f,message:`Approved ${d}`},t.json);return}if(o==="audit"){let d=_.query("SELECT id, event_type, action, target_uri, decision, metadata_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50").all().map((f)=>({id:f.id,event_type:f.event_type,action:f.action,target_uri:f.target_uri,decision:f.decision,metadata:JSON.parse(f.metadata_json),created_at:f.created_at}));N({ok:!0,events:d,message:`${d.length} audit event(s)`},t.json);return}if(o==="redact"){let d=n.slice(2).join(" ");if(!d)throw Error("Usage: open-knowledge safety redact <text>");let f=te(d,u);if(f.findings.length>0)ne(_,{source_uri:"safety://redact",findings:f.findings,metadata:{command:"safety redact"}});S(_,{event_type:"redaction",action:"safety_redact",target_uri:"safety://redact",decision:f.findings.length>0?"redacted":"allow",metadata:{findings:f.findings.length}}),N({ok:!0,text:f.text,findings:f.findings,message:`Redacted ${f.findings.length} finding(s)`},t.json);return}throw Error("Invalid safety action. Use 'status', 'check', 'approve', 'audit', or 'redact'.")}finally{_.close()}}if(r==="source"){if((n[1]??"")!=="resolve")throw Error("Invalid source action. Use 'resolve'.");let a=n[2];if(!a)throw Error("Usage: open-knowledge source resolve <source-ref>");let c=X(i.home),u=F(c.configPath),_=z(u,c),d=await Me({dbPath:c.knowledgeDbPath,sourceRef:a,purpose:t.purpose,limit:t.limit,safetyPolicy:_});N({ok:!0,...d,message:d.resolved?`Resolved ${d.source_ref} (${d.content.chunks_returned}/${d.content.chunks_total} chunks)`:`Source not indexed: ${a}`},t.json);return}if(r==="ingest"){if((n[1]??"")!=="manifest")throw Error("Invalid ingest action. Use 'manifest'.");let a=n[2];if(!a)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let c=X(i.home),u=F(c.configPath),_=z(u,c),d=await Ce({dbPath:c.knowledgeDbPath,input:a,config:u,safetyPolicy:_});N({ok:!0,...d,message:`Ingested ${d.items_seen} manifest item(s)`},t.json);return}if(r==="reindex"){if((n[1]??"")!=="outbox")throw Error("Invalid reindex action. Use 'outbox'.");let a=n[2];if(!a)throw Error("Usage: open-knowledge reindex outbox <file|s3://bucket/key>");let c=X(i.home),u=F(c.configPath),_=z(u,c),d=await je({dbPath:c.knowledgeDbPath,input:a,config:u,safetyPolicy:_});N({ok:!0,...d,message:`Consumed ${d.events_seen} outbox event(s)`},t.json);return}if(de(s),r==="add"){let o=n[1],a=n[2];if(!o||!a)throw Error("Usage: open-knowledge add <title> <content>");k(s,()=>{let c=L(s),u={id:_e(),title:o,content:a,url:t.url??null,tags:t.tag?[t.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};c.items.push(u),A(s,c),M("info","Item added",{id:u.id,title:u.title}),N({ok:!0,item:u,message:`Added ${u.id}`},t.json)});return}if(r==="list"){if(t.format!==void 0&&t.format!=="table"&&t.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");k(s,()=>{let o=L(s),a=Number.isFinite(t.page)&&t.page>0?t.page:1,c=Number.isFinite(t.limit)&&t.limit>0?t.limit:20,u=t.search?String(t.search).toLowerCase():"",_=t.tag?String(t.tag).toLowerCase():"",d=t.format==="table"||!t.json&&!t.format&&In(t),f=t.json||t.format==="json",p=o.items;if(t.archived)p=p.filter((R)=>R.archived===!0);else if(!t.includeArchived)p=p.filter((R)=>!R.archived);if(u)p=p.filter((R)=>R.title.toLowerCase().includes(u)||R.content.toLowerCase().includes(u));if(_)p=p.filter((R)=>R.tags&&R.tags.map((se)=>se.toLowerCase()).includes(_));let{sorted:E,sort:O,direction:h}=Dn(p,t),m=(a-1)*c,g=E.slice(m,m+c),x=Math.max(1,Math.ceil(E.length/c));if(f){N({ok:!0,page:a,limit:c,total:E.length,total_pages:x,sort:O,direction:h,items:g},!0);return}if(g.length===0){N(`No items found (search=${u||"none"}, tag=${_||"none"})`,!1);return}if(d){let R=(U)=>U,se=`${R("ID")}	${R("TITLE")}	${R("CREATED")}	${R("URL")}	${R("TAGS")}`;console.log(se);for(let U of g)console.log(`${U.id}	${R(U.title)}	${U.created_at}	${U.url?R(U.url):""}	${U.tags?.length?R(`[${U.tags.join(", ")}]`):""}`);console.log(`Page ${a}/${x} | showing ${g.length} of ${E.length} | sort=${O} ${h} | search=${u||"none"} | tag=${_||"none"}`)}else{for(let R of g)console.log(`${R.id}	${R.title}	${R.created_at}${R.url?`	${R.url}`:""}${R.tags?.length?`	[${R.tags.join(", ")}]`:""}`);console.log(`Page ${a}/${x} | showing ${g.length} of ${E.length} | sort=${O} ${h} | search=${u||"none"} | tag=${_||"none"}`)}});return}if(r==="get"){J(t),k(s,()=>{let a=L(s).items.find((c)=>c.id===t.id||c.short_id===t.id);if(!a)throw Error(`Item not found: ${t.id}`);N({ok:!0,item:a,message:`${a.id}: ${a.title}`},t.json)});return}if(r==="update"){J(t),k(s,()=>{let o=L(s),a=o.items.findIndex((u)=>u.id===t.id||u.short_id===t.id);if(a===-1)throw Error(`Item not found: ${t.id}`);let c=o.items[a];if(t.title!==void 0)c.title=t.title;if(t.content!==void 0)c.content=t.content;if(t.url!==void 0)c.url=t.url;if(t.tag!==void 0){if(c.tags=c.tags||[],!c.tags.map((u)=>u.toLowerCase()).includes(t.tag.toLowerCase()))c.tags.push(t.tag)}c.updated_at=new Date().toISOString(),o.items[a]=c,A(s,o),N({ok:!0,item:c,message:`Updated ${c.id}`},t.json)});return}if(r==="archive"||r==="restore"){J(t),k(s,()=>{let o=L(s),a=o.items.findIndex((u)=>u.id===t.id||u.short_id===t.id);if(a===-1)throw Error(`Item not found: ${t.id}`);let c=o.items[a];c.archived=r==="archive",c.updated_at=new Date().toISOString(),o.items[a]=c,A(s,o),N({ok:!0,item:c,message:`${r==="archive"?"Archived":"Restored"} ${c.id}`},t.json)});return}if(r==="untag"){if(J(t),!t.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");k(s,()=>{let o=L(s),a=o.items.findIndex((_)=>_.id===t.id||_.short_id===t.id);if(a===-1)throw Error(`Item not found: ${t.id}`);let c=o.items[a],u=c.tags?.length??0;c.tags=(c.tags??[]).filter((_)=>_.toLowerCase()!==t.tag.toLowerCase()),c.updated_at=new Date().toISOString(),o.items[a]=c,A(s,o),N({ok:!0,item:c,removed:u-c.tags.length,message:`Removed tag from ${c.id}`},t.json)});return}if(r==="upsert"){let o=t.title??n[1],a=t.content??n[2];k(s,()=>{let c=L(s),u=t.id?c.items.findIndex((f)=>f.id===t.id||f.short_id===t.id):-1,_=new Date().toISOString();if(u===-1){if(!o||!a)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let f=t.id??_e(),p={id:f,short_id:Re(f),title:o,content:a,url:t.url??null,tags:t.tag?[t.tag]:[],metadata:{},archived:!1,created_at:_,updated_at:_};c.items.push(p),A(s,c),N({ok:!0,created:!0,item:p,message:`Upserted ${p.id}`},t.json);return}let d=c.items[u];if(o!==void 0)d.title=o;if(a!==void 0)d.content=a;if(t.url!==void 0)d.url=t.url;if(t.tag!==void 0){if(d.tags=d.tags||[],!d.tags.map((f)=>f.toLowerCase()).includes(t.tag.toLowerCase()))d.tags.push(t.tag)}d.updated_at=_,c.items[u]=d,A(s,c),N({ok:!0,created:!1,item:d,message:`Upserted ${d.id}`},t.json)});return}if(r==="delete"){if(J(t),!t.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");k(s,()=>{let o=L(s),a=o.items.length;o.items=o.items.filter((u)=>u.id!==t.id&&u.short_id!==t.id);let c=a!==o.items.length;if(A(s,o),!c)throw Error(`Item not found: ${t.id}`);M("info","Item deleted",{id:t.id}),N({ok:!0,deleted_id:t.id,message:`Deleted ${t.id}`},t.json)});return}if(r==="export"){let o=t.format??"json";if(o!=="json"&&o!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");k(s,()=>{let a=L(s);if(o==="jsonl")for(let c of a.items)console.log(JSON.stringify(c));else N({ok:!0,items:a.items},t.json)});return}if(r==="prune"){if(!t.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");k(s,()=>{let o=L(s),a=o.items.length;if(t.olderThan!==void 0){let u=new Date;u.setDate(u.getDate()-t.olderThan),o.items=o.items.filter((_)=>new Date(_.created_at)>=u)}if(t.empty)o.items=o.items.filter((u)=>u.content.trim().length>0);let c=a-o.items.length;A(s,o),M("info","Prune completed",{pruned:c,remaining:o.items.length}),N({ok:!0,pruned:c,remaining:o.items.length,message:`Pruned ${c} item(s)`},t.json)});return}if(r==="dedupe"){if(!t.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");k(s,()=>{let o=L(s),a=new Set,c=o.items.length;o.items=o.items.filter((_)=>{let d=`${_.title}\x00${_.content}`;if(a.has(d))return!1;return a.add(d),!0});let u=c-o.items.length;A(s,o),M("info","Dedupe completed",{removed:u,remaining:o.items.length}),N({ok:!0,removed:u,remaining:o.items.length,message:`Dedupe removed ${u} duplicate(s)`},t.json)});return}if(r==="stats"){k(s,()=>{let o=L(s),a=o.items.filter((h)=>!h.archived),c=a.length,u=o.items.length-c,_=a.filter((h)=>h.url).length,d=a.filter((h)=>h.tags&&h.tags.length>0).length,f=c>0?a.map((h)=>h.created_at).sort()[0]:null,p=c>0?a.map((h)=>h.created_at).sort()[c-1]:null,E={};for(let h of a)for(let m of h.tags||[])E[m]=(E[m]||0)+1;let O=Object.entries(E).sort((h,m)=>m[1]-h[1]).slice(0,5).map(([h,m])=>({tag:h,count:m}));N({ok:!0,total:c,archived:u,with_url:_,with_tags:d,oldest:f,newest:p,top_tags:O,message:`${c} items | ${_} with URL | ${d} with tags`},t.json)});return}let l=xn(n[0]),T=l?` Did you mean '${l}'?`:"";throw M("warn","Unknown command",{input:n[0],suggestion:l}),Error(`Unknown command: ${n[0]}.${T} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)Un(process.argv.slice(2)).catch((e)=>{let n=e instanceof Error?e.message:String(e);M("error","CLI error",{message:n,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${n}`),process.exitCode=1});export{xn as suggestCommand,Dn as sortItems,Un as run,wn as parseArgs};
