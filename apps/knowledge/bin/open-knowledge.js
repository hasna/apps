#!/usr/bin/env bun
// @bun
var U=import.meta.require;import{readFileSync as J,writeFileSync as z,existsSync as G,renameSync as Pe,unlinkSync as pe}from"fs";import{randomUUID as ye}from"crypto";import{existsSync as Xe,mkdirSync as ie,readFileSync as je,writeFileSync as Fe}from"fs";import{homedir as fe}from"os";import{dirname as Me,join as R,resolve as Ke}from"path";var $e=R(".hasna","apps","knowledge");function se(){return R(fe(),".open-knowledge","db.json")}function oe(){return R(fe(),".hasna","apps","knowledge")}function Be(e=process.cwd()){return Ke(e,$e)}function B(e){return{home:e,configPath:R(e,"config.json"),jsonStorePath:R(e,"db.json"),knowledgeDbPath:R(e,"knowledge.db"),artifactsDir:R(e,"artifacts"),cacheDir:R(e,"cache"),exportsDir:R(e,"exports"),indexesDir:R(e,"indexes"),logsDir:R(e,"logs"),runsDir:R(e,"runs"),schemasDir:R(e,"schemas"),wikiDir:R(e,"wiki")}}function We(){return{version:1,mode:"local",storage:{type:"local",artifacts_root:"artifacts"},sources:{preferred_ref:"open-files",allowed_schemes:["open-files","s3","file","https","http"]},safety:{network:{web_search_enabled:!1,s3_reads_enabled:!1,allowed_s3_buckets:[]},redaction:{enabled:!0},approvals:{generated_writes_require_approval:!0}}}}function D(e){let n=B(e);ie(n.home,{recursive:!0});for(let t of[n.artifactsDir,n.cacheDir,n.exportsDir,n.indexesDir,n.logsDir,n.runsDir,n.schemasDir,n.wikiDir])ie(t,{recursive:!0});if(!Xe(n.configPath))Fe(n.configPath,`${JSON.stringify(We(),null,2)}
`);return n}function le(e,n=process.cwd()){if(e==="project"||e==="local")return B(Be(n));return B(oe())}function Y(e){ie(Me(e),{recursive:!0})}function F(e){let n=je(e,"utf8");return JSON.parse(n)}function ae(){return B(oe()).jsonStorePath}function ue(e){if(!G(e))if(Y(e),e===ae()&&G(se()))z(e,J(se(),"utf8"));else z(e,JSON.stringify({items:[]},null,2))}function He(e){return`${e}.lock`}function Ye(e,n){let i=Date.now();while(Date.now()-i<5000){try{if(!G(e)){z(e,JSON.stringify({owner:n,ts:Date.now()}));return}let _=JSON.parse(J(e,"utf8"));if(Date.now()-_.ts>1e4)pe(e)}catch{}let s=Date.now();while(Date.now()-s<50);}throw Error(`Could not acquire lock on ${e} after 5000ms`)}function ze(e,n){try{if(G(e)){if(JSON.parse(J(e,"utf8")).owner===n)pe(e)}}catch{}}function b(e){ue(e);let n=J(e,"utf8"),t=JSON.parse(n);if(!t||!Array.isArray(t.items))return{items:[]};return t}function A(e,n){let t=`${e}.tmp.${ye()}`;z(t,JSON.stringify(n,null,2)),Pe(t,e)}function L(e,n){let t=ye(),r=He(e);Ye(r,t);try{return n()}finally{ze(r,t)}}function ce(){return`k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}function Ne(e){return e.replace(/^k_/,"").slice(0,12)}import{Database as Ge}from"bun:sqlite";var Je=`
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
`,qe=`
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
`,Ve=`
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
`;function v(e){Y(e);let n=new Ge(e);return n.exec("PRAGMA foreign_keys = ON;"),n}function C(e){let n=v(e);try{if(n.exec(Je),q(n)<2)n.exec(qe);if(q(n)<3)n.exec(Ve);return{path:e,schema_version:q(n)}}finally{n.close()}}function q(e){return e.query("SELECT MAX(version) AS version FROM schema_versions").get()?.version??0}function k(e,n){return e.query(`SELECT COUNT(*) AS n FROM ${n}`).get()?.n??0}function ge(e){let n=v(e);try{return{schema_version:q(n),sources:k(n,"sources"),source_revisions:k(n,"source_revisions"),chunks:k(n,"chunks"),wiki_pages:k(n,"wiki_pages"),citations:k(n,"citations"),indexes:k(n,"knowledge_indexes"),runs:k(n,"runs"),run_events:k(n,"run_events"),redaction_findings:k(n,"redaction_findings"),audit_events:k(n,"audit_events"),approval_gates:k(n,"approval_gates")}}finally{n.close()}}import{existsSync as Qe,mkdirSync as he,readFileSync as Ze,writeFileSync as et}from"fs";import{dirname as tt,join as de,relative as nt,sep as rt}from"path";function W(e){let n=e.replace(/\\/g,"/").trim();if(!n||n.startsWith("/"))throw Error(`Invalid artifact key: ${e}`);let t=n.split("/").filter(Boolean);if(t.length===0||t.some((r)=>r==="."||r===".."))throw Error(`Invalid artifact key: ${e}`);return t.join("/")}function _e(e,n){let t=nt(e,n);if(t.startsWith("..")||t===".."||t.startsWith(`..${rt}`))throw Error(`Artifact path escapes root: ${n}`)}class Oe{root;type="local";canRead=!0;canWrite=!0;constructor(e){this.root=e;he(e,{recursive:!0})}async put(e){let n=W(e.key),t=de(this.root,n);return _e(this.root,t),he(tt(t),{recursive:!0}),et(t,e.body),{key:n,uri:`file://${t}`}}async getText(e){let n=W(e),t=de(this.root,n);return _e(this.root,t),Ze(t,"utf8")}async exists(e){let n=W(e),t=de(this.root,n);return _e(this.root,t),Qe(t)}}class Re{options;type="s3";canRead=!0;canWrite=!0;client;constructor(e){this.options=e;this.client=e.client}async getClient(){if(this.client)return this.client;let[{S3Client:e},{fromIni:n}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]);return this.client=new e({region:this.options.region,credentials:this.options.profile?n({profile:this.options.profile}):void 0,maxAttempts:this.options.max_attempts}),this.client}objectKey(e){let n=W(e),t=this.options.prefix?W(this.options.prefix):"";return t?`${t}/${n}`:n}async put(e){let[{PutObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e.key);return await t.send(new n({Bucket:this.options.bucket,Key:r,Body:e.body,ContentType:e.content_type,Metadata:e.metadata,ServerSideEncryption:this.options.server_side_encryption,SSEKMSKeyId:this.options.kms_key_id})),{key:r,uri:`s3://${this.options.bucket}/${r}`}}async getText(e){let[{GetObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e),i=await t.send(new n({Bucket:this.options.bucket,Key:r}));if(!i.Body)return"";return await i.Body.transformToString()}async exists(e){let[{HeadObjectCommand:n},t]=await Promise.all([import("@aws-sdk/client-s3"),this.getClient()]),r=this.objectKey(e);try{return await t.send(new n({Bucket:this.options.bucket,Key:r})),!0}catch(i){let s=i instanceof Error?i.name:"";if(s==="NotFound"||s==="NoSuchKey"||s==="NotFoundError")return!1;throw i}}}function Se(e,n){if(e.storage.type==="s3"){if(!e.storage.s3?.bucket)throw Error("S3 artifact storage requires storage.s3.bucket");return new Re({bucket:e.storage.s3.bucket,prefix:e.storage.s3.prefix,region:e.storage.s3.region,profile:e.storage.s3.profile,max_attempts:e.storage.s3.max_attempts,server_side_encryption:e.storage.s3.server_side_encryption,kms_key_id:e.storage.s3.kms_key_id})}return new Oe(n.artifactsDir)}function it(e){let n=String(e.getUTCFullYear()),t=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return{year:n,month:t,day:r}}function st(){return`# Knowledge Agent Schema v1

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
`}function ot(){return`# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`}function at(){return`# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`}async function be(e,n=new Date){let{year:t,month:r,day:i}=it(n),s="schemas/v1.md",_="indexes/root.md",y="wiki/README.md",o=`logs/${t}/${r}/${i}.jsonl`,a={ts:n.toISOString(),event:"wiki_layout_initialized",schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md"},u=[e.put({key:"schemas/v1.md",body:st(),content_type:"text/markdown"}),e.put({key:"indexes/root.md",body:ot(),content_type:"text/markdown"}),e.put({key:"wiki/README.md",body:at(),content_type:"text/markdown"}),e.put({key:o,body:`${JSON.stringify(a)}
`,content_type:"application/x-ndjson"})];return await Promise.all(u),{schema_key:"schemas/v1.md",root_index_key:"indexes/root.md",wiki_readme_key:"wiki/README.md",log_key:o,written:["schemas/v1.md","indexes/root.md","wiki/README.md",o]}}import{createHash as gt}from"crypto";import{existsSync as ht,readFileSync as Ot}from"fs";import{basename as Rt}from"path";function Le(e,n){if(!e)throw Error(n);return e}function ut(e){let t=e.slice(13).split("/").filter(Boolean),r=t[0];if(r!=="file"&&r!=="source")throw Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");let i=Le(t[1],"Invalid open-files ref. Missing id.");if(r==="file"){if(t.length===2)return{kind:"open-files",uri:e,entity:r,id:i};if(t[2]==="revision"&&t[3]&&t.length===4)return{kind:"open-files",uri:e,entity:r,id:i,revision_id:decodeURIComponent(t[3])};throw Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.")}let s=t.indexOf("path"),_=s>=0?decodeURIComponent(t.slice(s+1).join("/")):void 0;return{kind:"open-files",uri:e,entity:r,id:i,path:_}}function ct(e){let n=new URL(e),t=Le(n.hostname,"Invalid s3 ref. Missing bucket."),r=decodeURIComponent(n.pathname.replace(/^\/+/,""));if(!r)throw Error("Invalid s3 ref. Missing object key.");return{kind:"s3",uri:e,bucket:t,key:r}}function dt(e){let n=new URL(e);return{kind:"file",uri:e,path:decodeURIComponent(n.pathname)}}function _t(e){let n=new URL(e);return{kind:"web",uri:e,url:n.toString()}}function V(e){if(e.startsWith("open-files://"))return ut(e);if(e.startsWith("s3://"))return ct(e);if(e.startsWith("file://"))return dt(e);if(e.startsWith("https://")||e.startsWith("http://"))return _t(e);throw Error(`Unsupported source ref scheme: ${e}`)}import{createHash as Et,randomUUID as Ee}from"crypto";import{relative as Tt,resolve as me,sep as ft}from"path";function we(e){let n=process.env[e];return n==="1"||n==="true"||n==="yes"}function Q(e,n){let t=e,r=new Set(t.safety?.network?.allowed_s3_buckets??[]);if(e.storage.type==="s3"&&e.storage.s3?.bucket)r.add(e.storage.s3.bucket);if(process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS)for(let i of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(",").map((s)=>s.trim()).filter(Boolean))r.add(i);return{mode:e.mode,allowWriteRoots:[n.home,n.artifactsDir,n.cacheDir,n.exportsDir,n.indexesDir,n.logsDir,n.runsDir,n.schemasDir,n.wikiDir].map((i)=>me(i)),readOnlySourceAccess:!0,network:{webSearchEnabled:t.safety?.network?.web_search_enabled??we("HASNA_KNOWLEDGE_WEB_SEARCH"),s3ReadsEnabled:t.safety?.network?.s3_reads_enabled??we("HASNA_KNOWLEDGE_ALLOW_S3_READS"),allowedS3Buckets:[...r].sort()},redaction:{enabled:t.safety?.redaction?.enabled??!0},approvals:{generatedWritesRequireApproval:t.safety?.approvals?.generated_writes_require_approval??!0}}}function lt(e,n){let t=Tt(e,n);return t===""||!t.startsWith("..")&&t!==".."&&!t.startsWith(`..${ft}`)}function Z(e,n){let t=me(e);if(!n.allowWriteRoots.some((r)=>lt(r,t)))throw Error(`Safety policy denied write outside .hasna/apps/knowledge: ${e}`)}function M(e,n){let r=new URL(e).hostname;if(!n.network.s3ReadsEnabled)throw Error("Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.");if(!n.network.allowedS3Buckets.includes(r))throw Error(`Safety policy denied S3 bucket "${r}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`)}function ke(e){if(!e.network.webSearchEnabled)throw Error("Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.")}var pt=[{type:"private_key_block",severity:"high",regex:/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,replacement:"[REDACTED:private_key_block]"},{type:"secret_assignment",severity:"high",regex:/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,replacement:"[REDACTED:secret_assignment]"},{type:"openai_api_key",severity:"high",regex:/\bsk-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:openai_api_key]"},{type:"anthropic_api_key",severity:"high",regex:/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,replacement:"[REDACTED:anthropic_api_key]"},{type:"aws_access_key_id",severity:"high",regex:/\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g,replacement:"[REDACTED:aws_access_key_id]"}];function ee(e,n){if(n&&!n.redaction.enabled)return{text:e,findings:[]};let t=e,r=[];for(let i of pt)t=t.replace(i.regex,(s,..._)=>{let y=typeof _.at(-2)==="number"?_.at(-2):t.indexOf(s);return r.push({type:i.type,severity:i.severity,start:Math.max(0,y),end:Math.max(0,y+s.length)}),i.replacement});return{text:t,findings:r}}function yt(e){return`audit_${Et("sha256").update(`${e.event_type}\x00${e.action}\x00${e.target_uri??""}\x00${e.created_at??""}\x00${JSON.stringify(e.metadata??{})}\x00${Ee()}`).digest("hex").slice(0,24)}`}function m(e,n){let t=n.created_at??new Date().toISOString(),r=yt({...n,created_at:t});return e.run(`INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,[r,n.event_type,n.action,n.target_uri??null,n.decision,JSON.stringify(n.metadata??{}),t]),r}function te(e,n){let t=n.created_at??new Date().toISOString();for(let r of n.findings)e.run(`INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[`redact_${Ee()}`,n.source_uri??null,n.run_id??null,r.severity,r.type,JSON.stringify({...n.metadata??{},start:r.start,end:r.end}),t]);return n.findings.length}function Ae(e,n){let t=n.created_at??new Date().toISOString(),r=`approval_${Ee()}`;return e.run(`INSERT INTO approval_gates (id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[r,n.action,n.target_uri??null,"approved",n.reason??null,n.approved_by??"local-cli",JSON.stringify(n.metadata??{}),t,t]),{id:r,status:"approved"}}function Nt(e,n,t){let r=e.query(`SELECT id FROM approval_gates
     WHERE action = ? AND status = 'approved' AND (target_uri IS NULL OR target_uri = ? OR ? IS NULL)
     ORDER BY updated_at DESC LIMIT 1`).get(n,t??null,t??null);return Boolean(r)}function xe(e,n,t,r){let i=t==="generated_write"&&n.approvals.generatedWritesRequireApproval,s=!i||Nt(e,t,r);return{action:t,target_uri:r??null,approval_required:i,approved:s,decision:s?"allow":"requires_approval"}}function Te(e,n){return`${e}_${gt("sha256").update(n).digest("hex").slice(0,20)}`}function K(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function p(e){return typeof e==="string"&&e.length>0?e:void 0}function St(e){return typeof e==="number"&&Number.isFinite(e)?e:void 0}function bt(e){let n=p(e.source_ref)??p(e.source_uri)??p(e.uri);if(n)return n;let t=p(e.file_id);if(t){let s=p(e.revision_id)??p(e.revision),_=`open-files://file/${encodeURIComponent(t)}`;return s?`${_}/revision/${encodeURIComponent(s)}`:_}let r=p(e.source_id),i=p(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Manifest item is missing source_ref, file_id, or source_id/path.")}function Lt(e,n){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function wt(e){let n=p(e.extracted_text)??p(e.text)??p(e.content_text)??p(e.markdown);if(n!==void 0)return n;let t=e.content;return typeof t==="string"?t:null}function mt(e){let n=p(e.extracted_text_ref)??p(e.extracted_text_uri)??p(e.text_ref);if(n)return n;let t=K(e.content);return p(t?.extracted_text_ref)??p(t?.extracted_text_uri)??null}function kt(e){let n=p(e.path);return p(e.title)??p(e.name)??(n?Rt(n):null)}function At(e){return p(e.hash)??p(e.checksum)??p(e.sha256)??null}function xt(e,n,t){return p(e.revision_id)??p(e.revision)??p(e.version_id)??(n.kind==="open-files"?n.revision_id:void 0)??t??p(e.updated_at)??"current"}function It(e,n){let t={};for(let[r,i]of Object.entries(e)){if(["text","content","content_text","extracted_text","markdown"].includes(r))continue;t[r]=i}return t.source_ref=n.sourceRef,t.source_uri=n.sourceUri,t.status=n.status,t}function Ut(e,n){let t=bt(e),r=V(t),i=Lt(t,r),s=At(e),_=p(e.status)??"active";return{raw:e,sourceRef:t,sourceUri:i,kind:r.kind,title:kt(e),revision:xt(e,r,s),hash:s,extractedTextUri:mt(e),text:wt(e),metadata:It(e,{sourceRef:t,sourceUri:i,status:_}),acl:e.permissions??e.acl??{},status:_,updatedAt:p(e.updated_at)??n}}function Dt(e){let n=e.trim();if(!n)return[];if(n.startsWith("[")){let t=JSON.parse(n);if(!Array.isArray(t))throw Error("Manifest array parse failed.");return t.map((r)=>{let i=K(r);if(!i)throw Error("Manifest array entries must be objects.");return i})}if(n.startsWith("{"))try{let t=JSON.parse(n),r=K(t);if(!r)throw Error("Manifest object parse failed.");if(Array.isArray(r.items))return r.items.map((i)=>{let s=K(i);if(!s)throw Error("Manifest items entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(t){let r=n.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw t;return r.map((i)=>{let s=K(JSON.parse(i));if(!s)throw Error("Manifest JSONL entries must be objects.");return s})}return n.split(/\r?\n/).filter((t)=>t.trim().length>0).map((t)=>{let r=K(JSON.parse(t));if(!r)throw Error("Manifest JSONL entries must be objects.");return r})}async function vt(e,n,t){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 manifest URI: ${e}`);if(t)M(e,t);let[{S3Client:_,GetObjectCommand:y},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),a=n?.storage.type==="s3"&&n.storage.s3?.bucket===i?n.storage.s3:void 0,c=await new _({region:a?.region,credentials:a?.profile?o({profile:a.profile}):void 0,maxAttempts:a?.max_attempts}).send(new y({Bucket:i,Key:s}));if(!c.Body)return"";return await c.Body.transformToString()}async function Ct(e,n,t){if(e.startsWith("s3://"))return vt(e,n,t);if(!ht(e))throw Error(`Manifest not found: ${e}`);return Ot(e,"utf8")}function Xt(e,n,t){let r=e.replace(/\r\n/g,`
`);if(!r.trim())return[];let i=[],s=0;while(s<r.length){let _=Math.min(r.length,s+n),y=_;if(_<r.length){let a=r.lastIndexOf(`

`,_),u=r.lastIndexOf(". ",_),c=Math.max(a,u);if(c>s+Math.floor(n*0.5))y=c+(c===a?2:1)}let o=r.slice(s,y).trim();if(o)i.push({ordinal:i.length,text:o,startOffset:s,endOffset:y});if(y>=r.length)break;s=Math.max(0,y-t)}return i}function jt(e){let n=e.trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(n*1.25))}function Ft(e,n){let t=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(n);for(let r of t)e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[r.id]);return e.run("DELETE FROM chunks WHERE source_revision_id = ?",[n]),t.length}function Mt(e,n,t){let r=Te("src",n.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       metadata_json = excluded.metadata_json,
       acl_json = excluded.acl_json,
       updated_at = excluded.updated_at`,[r,n.sourceUri,n.kind,n.title,JSON.stringify(n.metadata),JSON.stringify(n.acl??{}),t,n.updatedAt]);let i=e.query("SELECT id FROM sources WHERE uri = ?").get(n.sourceUri);if(!i)throw Error(`Failed to upsert source: ${n.sourceUri}`);return i.id}function Kt(e,n,t,r){let i=Te("rev",`${n}\x00${t.revision}`);e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = excluded.hash,
       extracted_text_uri = excluded.extracted_text_uri,
       metadata_json = excluded.metadata_json`,[i,n,t.revision,t.hash,t.extractedTextUri,JSON.stringify(t.metadata),r]);let s=e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(n,t.revision);if(!s)throw Error(`Failed to upsert source revision: ${t.sourceRef}`);return s.id}function $t(e,n,t,r,i,s,_){if(!t.text||t.status.toLowerCase()==="deleted")return{chunksInserted:0,redactions:0};let y=ee(t.text,_);if(y.findings.length>0)te(e,{source_uri:t.sourceUri,findings:y.findings,metadata:{source_ref:t.sourceRef,revision:t.revision},created_at:r}),m(e,{event_type:"redaction",action:"source_text_redact",target_uri:t.sourceUri,decision:"redacted",metadata:{findings:y.findings.length,source_ref:t.sourceRef,revision:t.revision},created_at:r});let o=Xt(y.text,i,s);for(let a of o){let u=Te("chk",`${n}\x00${a.ordinal}\x00${a.text}`),c={source_ref:t.sourceRef,source_uri:t.sourceUri,hash:t.hash,status:t.status,path:p(t.raw.path)??null,mime:p(t.raw.mime)??p(t.raw.content_type)??null,size:St(t.raw.size)??null};e.run(`INSERT INTO chunks (id, source_revision_id, kind, ordinal, text, token_count, start_offset, end_offset, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[u,n,"source",a.ordinal,a.text,jt(a.text),a.startOffset,a.endOffset,JSON.stringify(c),r]),e.run("INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)",[u,a.text,t.title??"",t.sourceUri])}return{chunksInserted:o.length,redactions:y.findings.length}}async function Ie(e){let n=(e.now??new Date).toISOString(),t=e.maxChunkChars??4000,r=e.chunkOverlapChars??200;if(t<500)throw Error("maxChunkChars must be at least 500.");if(r<0||r>=t)throw Error("chunkOverlapChars must be less than maxChunkChars.");if(e.safetyPolicy)Z(e.dbPath,e.safetyPolicy);C(e.dbPath);let i=await Ct(e.input,e.config,e.safetyPolicy),s=Dt(i),_=v(e.dbPath);try{return _.transaction(()=>{let o=new Set,a=new Set,u=0,c=0,E=0,d=0;m(_,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_manifest_read":"local_manifest_read",target_uri:e.input,decision:"allow",metadata:{items:s.length,read_only:!0},created_at:n});for(let T of s){let l=Ut(T,n),f=Mt(_,l,n),S=Kt(_,f,l,n);if(o.add(f),a.add(S),l.text||l.status.toLowerCase()==="deleted")c+=Ft(_,S);let N=$t(_,S,l,n,t,r,e.safetyPolicy);u+=N.chunksInserted,E+=N.redactions}return m(_,{event_type:"write",action:"knowledge_manifest_ingest",target_uri:e.dbPath,decision:"allow",metadata:{items:s.length,sources:o.size,revisions:a.size,chunks_inserted:u,redactions:E},created_at:n}),{path:e.input,db_path:e.dbPath,items_seen:s.length,sources_upserted:o.size,revisions_upserted:a.size,chunks_inserted:u,chunks_deleted:c,redactions:E,skipped:d}})()}finally{_.close()}}import{createHash as Bt,randomUUID as Wt}from"crypto";import{existsSync as Pt,readFileSync as Ht}from"fs";import{basename as Yt}from"path";function ne(e,n){return`${e}_${Bt("sha256").update(n).digest("hex").slice(0,20)}`}function $(e){return e&&typeof e==="object"&&!Array.isArray(e)?e:void 0}function h(e){return typeof e==="string"&&e.length>0?e:void 0}function zt(e){let n=h(e.source_ref)??h(e.source_uri)??h(e.uri);if(n)return n;let t=h(e.file_id);if(t){let s=h(e.revision_id)??h(e.revision),_=`open-files://file/${encodeURIComponent(t)}`;return s?`${_}/revision/${encodeURIComponent(s)}`:_}let r=h(e.source_id),i=h(e.path);if(r&&i)return`open-files://source/${encodeURIComponent(r)}/path/${encodeURIComponent(i)}`;throw Error("Outbox event is missing source_ref, file_id, or source_id/path.")}function Gt(e,n){if(n.kind==="open-files"&&n.entity==="file"&&n.revision_id)return e.replace(/\/revision\/[^/]+$/,"");return e}function Jt(e){return h(e.hash)??h(e.checksum)??h(e.sha256)??null}function qt(e,n,t){return h(e.revision_id)??h(e.revision)??h(e.version_id)??(n.kind==="open-files"?n.revision_id:void 0)??t??null}function Vt(e){return(h(e.event)??h(e.type)??h(e.action)??h(e.change_type)??"changed").toLowerCase()}function Qt(e){let n=h(e.path);return h(e.title)??h(e.name)??(n?Yt(n):null)}function Zt(e,n){let t=zt(e),r=V(t),i=Jt(e);return{raw:e,eventType:Vt(e),sourceRef:t,sourceUri:Gt(t,r),kind:r.kind,title:Qt(e),revision:qt(e,r,i),hash:i,status:h(e.status)?.toLowerCase()??null,updatedAt:h(e.updated_at)??n,acl:e.permissions??e.acl??void 0}}function en(e){let n=e.trim();if(!n)return[];if(n.startsWith("[")){let t=JSON.parse(n);if(!Array.isArray(t))throw Error("Outbox array parse failed.");return t.map((r)=>{let i=$(r);if(!i)throw Error("Outbox array entries must be objects.");return i})}if(n.startsWith("{"))try{let t=JSON.parse(n),r=$(t);if(!r)throw Error("Outbox object parse failed.");if(Array.isArray(r.events))return r.events.map((i)=>{let s=$(i);if(!s)throw Error("Outbox events entries must be objects.");return s});if("source_ref"in r||"source_uri"in r||"file_id"in r)return[r]}catch(t){let r=n.split(/\r?\n/).filter((i)=>i.trim().length>0);if(r.length<=1)throw t;return r.map((i)=>{let s=$(JSON.parse(i));if(!s)throw Error("Outbox JSONL entries must be objects.");return s})}return n.split(/\r?\n/).filter((t)=>t.trim().length>0).map((t)=>{let r=$(JSON.parse(t));if(!r)throw Error("Outbox JSONL entries must be objects.");return r})}async function tn(e,n,t){let r=new URL(e),i=r.hostname,s=decodeURIComponent(r.pathname.replace(/^\/+/,""));if(!i||!s)throw Error(`Invalid S3 outbox URI: ${e}`);if(t)M(e,t);let[{S3Client:_,GetObjectCommand:y},{fromIni:o}]=await Promise.all([import("@aws-sdk/client-s3"),import("@aws-sdk/credential-providers")]),a=n?.storage.type==="s3"&&n.storage.s3?.bucket===i?n.storage.s3:void 0,c=await new _({region:a?.region,credentials:a?.profile?o({profile:a.profile}):void 0,maxAttempts:a?.max_attempts}).send(new y({Bucket:i,Key:s}));if(!c.Body)return"";return await c.Body.transformToString()}async function nn(e,n,t){if(e.startsWith("s3://"))return tn(e,n,t);if(!Pt(e))throw Error(`Outbox not found: ${e}`);return Ht(e,"utf8")}function Ue(e,n){let t={};if(e)try{t=$(JSON.parse(e))??{}}catch{t={}}return JSON.stringify({...t,...n})}function rn(e,n,t){let r=ne("src",n.sourceUri);e.run(`INSERT INTO sources (id, uri, kind, title, metadata_json, acl_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       kind = excluded.kind,
       title = COALESCE(excluded.title, sources.title),
       updated_at = excluded.updated_at`,[r,n.sourceUri,n.kind,n.title,JSON.stringify({source_ref:n.sourceRef,source_uri:n.sourceUri,status:n.status,last_outbox_event:n.eventType}),JSON.stringify(n.acl??{}),t,n.updatedAt]);let i=e.query("SELECT id, metadata_json, acl_json FROM sources WHERE uri = ?").get(n.sourceUri);if(!i)throw Error(`Failed to upsert source for outbox event: ${n.sourceUri}`);let s={source_ref:n.sourceRef,source_uri:n.sourceUri,last_outbox_event:n.eventType,last_outbox_at:n.updatedAt};if(n.status)s.status=n.status;if(h(n.raw.path))s.path=n.raw.path;return e.run("UPDATE sources SET metadata_json = ?, acl_json = CASE WHEN ? IS NULL THEN acl_json ELSE ? END, updated_at = ? WHERE id = ?",[Ue(i.metadata_json,s),n.acl===void 0?null:JSON.stringify(n.acl),n.acl===void 0?null:JSON.stringify(n.acl),n.updatedAt,i.id]),i.id}function sn(e,n,t,r){if(!t.revision)return null;let i=ne("rev",`${n}\x00${t.revision}`),s={source_ref:t.sourceRef,source_uri:t.sourceUri,status:t.status,last_outbox_event:t.eventType,reindex_required:!0};return e.run(`INSERT INTO source_revisions (id, source_id, revision, hash, extracted_text_uri, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, revision) DO UPDATE SET
       hash = COALESCE(excluded.hash, source_revisions.hash),
       metadata_json = excluded.metadata_json`,[i,n,t.revision,t.hash,h(t.raw.extracted_text_ref)??null,JSON.stringify(s),r]),e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").get(n,t.revision)?.id??null}function on(e,n,t){if(t.revision)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND revision = ?").all(n,t.revision).map((r)=>r.id);if(t.hash)return e.query("SELECT id FROM source_revisions WHERE source_id = ? AND hash = ?").all(n,t.hash).map((r)=>r.id);return e.query("SELECT id FROM source_revisions WHERE source_id = ?").all(n).map((r)=>r.id)}function an(e,n){let t=e.query("SELECT id FROM chunks WHERE source_revision_id = ?").all(n),r=0;for(let s of t){let _=e.query("SELECT COUNT(*) AS n FROM chunk_embeddings WHERE chunk_id = ?").get(s.id);r+=_?.n??0,e.run("DELETE FROM chunk_embeddings WHERE chunk_id = ?",[s.id]),e.run("DELETE FROM chunks_fts WHERE chunk_id = ?",[s.id])}e.run("DELETE FROM chunks WHERE source_revision_id = ?",[n]);let i=e.query("SELECT metadata_json FROM source_revisions WHERE id = ?").get(n);return e.run("UPDATE source_revisions SET metadata_json = ? WHERE id = ?",[Ue(i?.metadata_json,{reindex_required:!0,invalidated_at:new Date().toISOString()}),n]),{chunksDeleted:t.length,embeddingsDeleted:r}}function un(e,n){return n==="deleted"||["delete","deleted","remove","removed"].includes(e)}function cn(e){return["move","moved","rename","renamed","path_changed"].includes(e)}function dn(e){return["permission","permissions","permission_changed","acl_changed"].includes(e)}async function De(e){let n=(e.now??new Date).toISOString();if(e.safetyPolicy)Z(e.dbPath,e.safetyPolicy);C(e.dbPath);let t=await nn(e.input,e.config,e.safetyPolicy),r=en(t),i=v(e.dbPath),s=`run_${Wt()}`;try{return i.transaction(()=>{i.run(`INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,[s,"open-files-outbox",e.input,"completed","local","open-files-outbox",JSON.stringify({path:e.input,events:r.length}),n,n]);let _=new Set,y=new Set,o=0,a=0,u=0,c=0,E=0,d=0;return m(i,{event_type:"source_read",action:e.input.startsWith("s3://")?"s3_outbox_read":"local_outbox_read",target_uri:e.input,decision:"allow",metadata:{events:r.length,read_only:!0},created_at:n}),r.forEach((T,l)=>{let f=Zt(T,n),S=rn(i,f,n);_.add(S);let N=sn(i,S,f,n);if(N)y.add(N);let w=on(i,S,f);for(let x of w){y.add(x);let j=an(i,x);o+=j.chunksDeleted,a+=j.embeddingsDeleted,u+=1}if(un(f.eventType,f.status))c+=1;if(cn(f.eventType))E+=1;if(dn(f.eventType)||f.acl!==void 0)d+=1;i.run(`INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,[ne("evt",`${s}\x00${l}\x00${f.sourceRef}\x00${f.eventType}`),s,"info",f.eventType,JSON.stringify({source_ref:f.sourceRef,source_uri:f.sourceUri,revision:f.revision,hash:f.hash,status:f.status,affected_revisions:w.length}),f.updatedAt])}),i.run(`INSERT INTO provider_usage (id, run_id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,[ne("usage",s),s,"local","open-files-outbox",JSON.stringify({note:"No model provider used for outbox invalidation."}),n]),m(i,{event_type:"write",action:"knowledge_outbox_invalidation",target_uri:e.dbPath,decision:"allow",metadata:{run_id:s,events:r.length,sources:_.size,revisions:y.size,chunks_deleted:o,embeddings_deleted:a},created_at:n}),{path:e.input,db_path:e.dbPath,run_id:s,events_seen:r.length,sources_touched:_.size,revisions_touched:y.size,chunks_deleted:o,embeddings_deleted:a,stale_revisions:u,deleted_sources:c,moved_sources:E,permission_updates:d}})()}finally{i.close()}}var P={name:"@hasna/knowledge",version:"0.2.7",description:"Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions",type:"module",bin:{"open-knowledge":"bin/open-knowledge.js","open-knowledge-mcp":"bin/open-knowledge-mcp.js"},files:["bin","src","docs","LICENSE","README.md"],scripts:{test:"bun test","test:cli":"bun test tests/cli.test.ts",build:"bun build --target=bun --outfile=bin/open-knowledge.js --minify --external @aws-sdk/client-s3 --external @aws-sdk/credential-providers src/cli.ts && bun build --target=bun --outfile=bin/open-knowledge-mcp.js --external @modelcontextprotocol/sdk src/mcp.js",prepublishOnly:"bun run build",postinstall:"bun run build"},keywords:["knowledge","cli","agents","json","notes","local","store"],license:"Apache-2.0",publishConfig:{registry:"https://registry.npmjs.org",access:"public"},repository:{type:"git",url:"git+https://github.com/hasna/knowledge.git"},bugs:{url:"https://github.com/hasna/knowledge/issues"},author:"Hasna Inc. <hasna@example.com>",engines:{bun:">=1.0",node:">=18"},dependencies:{"@aws-sdk/client-s3":"^3.1063.0","@aws-sdk/credential-providers":"^3.1063.0","@modelcontextprotocol/sdk":"^1.29.0",zod:"^4.3.6"},devDependencies:{"@types/bun":"^1.3.14"}};var ve={debug:0,info:1,warn:2,error:3},En=()=>{if(process.env.DEBUG)return"debug";if(process.env.LOG_LEVEL==="debug")return"debug";if(process.env.LOG_LEVEL==="warn")return"warn";if(process.env.LOG_LEVEL==="error")return"error";return"info"};function X(e,n,t){if(ve[e]<ve[En()])return;let r={debug:"[DEBUG]",info:"[INFO]",warn:"[WARN]",error:"[ERROR]"}[e],i=t?`${r} ${n} ${JSON.stringify(t)}`:`${r} ${n}`;if(e==="error")console.error(i);else console.error(i)}var Tn=["add","list","get","delete","update","archive","restore","upsert","untag","export","prune","dedupe","stats","paths","db","wiki","ingest","reindex","safety","help"],Ce={ls:"list",rm:"delete",edit:"update",unarchive:"restore"};function fn(e){let n=[],t={};for(let r=0;r<e.length;r+=1){let i=e[r];if(!i.startsWith("-")){n.push(i);continue}switch(i){case"--json":t.json=!0;break;case"--yes":case"-y":t.yes=!0;break;case"--help":case"-h":t.help=!0;break;case"--version":case"-v":t.version=!0;break;case"--desc":t.desc=!0;break;case"--page":case"-p":t.page=Number(e[r+1]),r+=1;break;case"--limit":case"-l":t.limit=Number(e[r+1]),r+=1;break;case"--search":case"-s":t.search=e[r+1],r+=1;break;case"--sort":t.sort=e[r+1],r+=1;break;case"--id":t.id=e[r+1],r+=1;break;case"--store":t.store=e[r+1],r+=1;break;case"--title":t.title=e[r+1],r+=1;break;case"--content":t.content=e[r+1],r+=1;break;case"--url":t.url=e[r+1],r+=1;break;case"--tag":case"-t":t.tag=e[r+1],r+=1;break;case"--format":t.format=e[r+1],r+=1;break;case"--completions":t.completions=e[r+1],r+=1;break;case"--no-color":t.noColor=!0;break;case"--scope":t.scope=e[r+1],r+=1;break;case"--older-than":t.olderThan=Number(e[r+1]),r+=1;break;case"--empty":t.empty=!0;break;case"--archived":t.archived=!0;break;case"--include-archived":t.includeArchived=!0;break;default:throw Error(`Unknown flag: ${i}. Run 'open-knowledge --help' for valid options.`)}}return{positional:n,flags:t}}function ln(e){if(!e)return"";return Ce[e]??e}function pn(e,n){let t=Array.from({length:e.length+1},()=>Array(n.length+1).fill(0));for(let r=0;r<=e.length;r+=1)t[r][0]=r;for(let r=0;r<=n.length;r+=1)t[0][r]=r;for(let r=1;r<=e.length;r+=1)for(let i=1;i<=n.length;i+=1){let s=e[r-1]===n[i-1]?0:1;t[r][i]=Math.min(t[r-1][i]+1,t[r][i-1]+1,t[r-1][i-1]+s)}return t[e.length][n.length]}function yn(e){if(!e)return"";let n=[...Tn,...Object.keys(Ce)],t="",r=Number.POSITIVE_INFINITY;for(let i of n){let s=pn(e,i);if(s<r)r=s,t=i}return r<=3?t:""}function Nn(){console.log(`open-knowledge - local agent knowledge store

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
  ingest manifest <file|s3://> Ingest an open-files manifest into knowledge.db
  reindex outbox <file|s3://>  Consume open-files change events and invalidate chunks
  safety status|check|approve|audit|redact
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
  --empty                     Remove items with empty content`)}function gn(e){if(e==="add"){console.log("Usage: open-knowledge add <title> <content> [--url <url>] [-t <tag>] [--json]");return}if(e==="list"||e==="ls"){console.log("Usage: open-knowledge list|ls [--format table|json] [-p <page>] [-l <limit>] [-s <search>] [-t <tag>] [--sort created|title] [--desc] [--json]");return}if(e==="get"){console.log("Usage: open-knowledge get --id <id> [--json]");return}if(e==="update"||e==="edit"){console.log("Usage: open-knowledge update|edit --id <id> [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="archive"){console.log("Usage: open-knowledge archive --id <id> [--json]");return}if(e==="restore"||e==="unarchive"){console.log("Usage: open-knowledge restore|unarchive --id <id> [--json]");return}if(e==="upsert"){console.log("Usage: open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [--url <url>] [-t <tag>] [--json]");return}if(e==="untag"){console.log("Usage: open-knowledge untag --id <id> -t <tag> [--json]");return}if(e==="delete"||e==="rm"){console.log("Usage: open-knowledge delete|rm --id <id> -y [--json]");return}if(e==="export"){console.log("Usage: open-knowledge export [--format jsonl] [--json]");return}if(e==="prune"){console.log("Usage: open-knowledge prune --yes [--older-than <days>] [--empty] [--json]");return}if(e==="dedupe"){console.log("Usage: open-knowledge dedupe --yes [--json]");return}if(e==="stats"){console.log("Usage: open-knowledge stats [--json]");return}if(e==="paths"){console.log("Usage: open-knowledge paths [--scope local|global|project] [--json]");return}if(e==="db"){console.log("Usage: open-knowledge db init|stats [--scope local|global|project] [--json]");return}if(e==="wiki"){console.log("Usage: open-knowledge wiki init [--scope local|global|project] [--json]");return}if(e==="ingest"){console.log("Usage: open-knowledge ingest manifest <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="reindex"){console.log("Usage: open-knowledge reindex outbox <file|s3://bucket/key> [--scope local|global|project] [--json]");return}if(e==="safety"){console.log("Usage: open-knowledge safety status|check|approve|audit|redact [args] [--scope local|global|project] [--json]");return}Nn()}function hn(e){if(e.noColor||process.env.NO_COLOR)return!1;if(process.env.FORCE_COLOR)return!0;return process.stdout.isTTY===!0}function O(e,n,t){if(n){console.log(JSON.stringify(e,null,2));return}if(typeof e==="string"){console.log(e);return}console.log(e.message??JSON.stringify(e,null,2))}function H(e){if(!e.id)throw Error("Missing required --id. Example: open-knowledge get --id <id>")}function On(e,n){let t=n.sort??"created";if(t!=="created"&&t!=="title")throw Error("Invalid --sort value. Use 'created' or 'title'.");let r=[...e].sort((i,s)=>{if(t==="title")return i.title.localeCompare(s.title);return i.created_at.localeCompare(s.created_at)});if(n.desc)r.reverse();return{sorted:r,sort:t,direction:n.desc?"desc":"asc"}}async function Rn(e){let{positional:n,flags:t}=fn(e);if(X("debug","CLI invoked",{command:n[0],flags:{json:t.json,store:t.store}}),t.version){console.log(t.json?JSON.stringify({name:P.name,version:P.version},null,2):`${P.name} ${P.version}`);return}if(t.completions){let o=t.completions;if(o==="bash")console.log('_open_knowledge() { local cur; cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest reindex safety help ls rm edit unarchive --json --yes --help --version --desc --page --limit --search --sort --id --store --title --content --url --tag --format --completions --no-color --scope --archived --include-archived" -- "$cur")); }; complete -F _open_knowledge open-knowledge');else if(o==="zsh")console.log(`#compdef open-knowledge
_open_knowledge() { _arguments -C "1: :(add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest reindex safety help ls rm edit unarchive)" "(--json)--json" "(--yes)-y" "(--help)--help" "(--version)--version" "(--desc)--desc" "(--archived)--archived" "(--include-archived)--include-archived" "(-p --page)"{-p,--page}"[page number]:number:" "(-l --limit)"{-l,--limit}"[items per page]:number:" "(-s --search)"{-s,--search}"[search text]:text:" "(--sort)--sort"{created,title}:" "(--id)--id[item id]:id:" "(--store)--store[store path]:path:" "(--title)--title[new title]:" "(--content)--content[new content]:" "(--url)--url[source url]:" "(-t --tag)"{-t,--tag}"[tag]:tag:" "(--format)--format[json|jsonl]:" "(--completions)--completions[output completions]:shell:(bash zsh fish):" "(--no-color)--no-color[disable color]" "(--scope)--scope"{local,global,project}:" }; _open_knowledge`);else if(o==="fish")console.log('complete -c open-knowledge -f; complete -c open-knowledge -a "add list get update archive restore upsert untag delete export prune dedupe stats paths db wiki ingest reindex safety help ls rm edit unarchive"; complete -c open-knowledge -l json; complete -c open-knowledge -l yes -s y; complete -c open-knowledge -l help -s h; complete -c open-knowledge -l version -s v; complete -c open-knowledge -l desc; complete -c open-knowledge -l archived; complete -c open-knowledge -l include-archived; complete -c open-knowledge -s p -l page; complete -c open-knowledge -s l -l limit; complete -c open-knowledge -s s -l search; complete -c open-knowledge -l sort; complete -c open-knowledge -l id; complete -c open-knowledge -l store; complete -c open-knowledge -l title; complete -c open-knowledge -l content; complete -c open-knowledge -l url; complete -c open-knowledge -s t -l tag; complete -c open-knowledge -l format; complete -c open-knowledge -l completions; complete -c open-knowledge -l no-color; complete -c open-knowledge -l scope -a "local global project"');else throw Error("Invalid --completions value. Use 'bash', 'zsh', or 'fish'.");return}let r=ln(n[0]);if(!r||t.help||r==="help"){gn(n[1]);return}let i=le(t.scope),s=t.store;if(!s)if(t.scope==="project"||t.scope==="local")s=D(i.home).jsonStorePath;else s=ae();if(r==="paths"){let o=D(i.home);O({ok:!0,scope:t.scope??"global",home:o.home,config_path:o.configPath,json_store_path:o.jsonStorePath,knowledge_db_path:o.knowledgeDbPath,artifacts_dir:o.artifactsDir,indexes_dir:o.indexesDir,logs_dir:o.logsDir,runs_dir:o.runsDir,schemas_dir:o.schemasDir,wiki_dir:o.wikiDir,config:F(o.configPath),message:o.home},t.json);return}if(r==="db"){let o=n[1]??"init",a=D(i.home);if(o!=="init"&&o!=="stats")throw Error("Invalid db action. Use 'init' or 'stats'.");if(o==="init"){let c=C(a.knowledgeDbPath);O({ok:!0,...c,message:`Initialized ${c.path}`},t.json);return}C(a.knowledgeDbPath);let u=ge(a.knowledgeDbPath);O({ok:!0,path:a.knowledgeDbPath,...u,message:`knowledge.db schema v${u.schema_version}`},t.json);return}if(r==="wiki"){if((n[1]??"init")!=="init")throw Error("Invalid wiki action. Use 'init'.");let a=D(i.home),u=F(a.configPath),c=Se(u,a),E=await be(c);O({ok:!0,...E,message:`Initialized wiki layout in ${a.home}`},t.json);return}if(r==="safety"){let o=n[1]??"status",a=D(i.home),u=F(a.configPath),c=Q(u,a);C(a.knowledgeDbPath);let E=v(a.knowledgeDbPath);try{if(o==="status"){O({ok:!0,mode:c.mode,workspace:a.home,allow_write_roots:c.allowWriteRoots,read_only_source_access:c.readOnlySourceAccess,network:c.network,redaction:c.redaction,approvals:c.approvals,message:`Safety policy: ${c.mode}`},t.json);return}if(o==="check"){let d=n[2]??"generated_write",T=n[3]??null,l;try{if(d==="web_search")ke(c),l={action:d,target_uri:T,approval_required:!1,approved:!0,decision:"allow"};else if(d==="s3_read"){if(!T)throw Error("safety check s3_read requires an s3:// target.");M(T,c),l={action:d,target_uri:T,approval_required:!1,approved:!0,decision:"allow"}}else l=xe(E,c,d,T);m(E,{event_type:"safety_check",action:d,target_uri:T,decision:l.decision==="allow"?"allow":"requires_approval",metadata:l}),O({ok:!0,...l,message:`Safety check ${l.decision}`},t.json);return}catch(f){throw m(E,{event_type:"safety_check",action:d,target_uri:T,decision:"deny",metadata:{error:f instanceof Error?f.message:String(f)}}),f}}if(o==="approve"){let d=n[2]??"generated_write",T=n[3]??null,l=Ae(E,{action:d,target_uri:T,reason:"local-cli approval",metadata:{scope:t.scope??"global"}});m(E,{event_type:"approval",action:d,target_uri:T,decision:"allow",metadata:{approval_id:l.id}}),O({ok:!0,...l,action:d,target_uri:T,message:`Approved ${d}`},t.json);return}if(o==="audit"){let d=E.query("SELECT id, event_type, action, target_uri, decision, metadata_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50").all().map((T)=>({id:T.id,event_type:T.event_type,action:T.action,target_uri:T.target_uri,decision:T.decision,metadata:JSON.parse(T.metadata_json),created_at:T.created_at}));O({ok:!0,events:d,message:`${d.length} audit event(s)`},t.json);return}if(o==="redact"){let d=n.slice(2).join(" ");if(!d)throw Error("Usage: open-knowledge safety redact <text>");let T=ee(d,c);if(T.findings.length>0)te(E,{source_uri:"safety://redact",findings:T.findings,metadata:{command:"safety redact"}});m(E,{event_type:"redaction",action:"safety_redact",target_uri:"safety://redact",decision:T.findings.length>0?"redacted":"allow",metadata:{findings:T.findings.length}}),O({ok:!0,text:T.text,findings:T.findings,message:`Redacted ${T.findings.length} finding(s)`},t.json);return}throw Error("Invalid safety action. Use 'status', 'check', 'approve', 'audit', or 'redact'.")}finally{E.close()}}if(r==="ingest"){if((n[1]??"")!=="manifest")throw Error("Invalid ingest action. Use 'manifest'.");let a=n[2];if(!a)throw Error("Usage: open-knowledge ingest manifest <file|s3://bucket/key>");let u=D(i.home),c=F(u.configPath),E=Q(c,u),d=await Ie({dbPath:u.knowledgeDbPath,input:a,config:c,safetyPolicy:E});O({ok:!0,...d,message:`Ingested ${d.items_seen} manifest item(s)`},t.json);return}if(r==="reindex"){if((n[1]??"")!=="outbox")throw Error("Invalid reindex action. Use 'outbox'.");let a=n[2];if(!a)throw Error("Usage: open-knowledge reindex outbox <file|s3://bucket/key>");let u=D(i.home),c=F(u.configPath),E=Q(c,u),d=await De({dbPath:u.knowledgeDbPath,input:a,config:c,safetyPolicy:E});O({ok:!0,...d,message:`Consumed ${d.events_seen} outbox event(s)`},t.json);return}if(ue(s),r==="add"){let o=n[1],a=n[2];if(!o||!a)throw Error("Usage: open-knowledge add <title> <content>");L(s,()=>{let u=b(s),c={id:ce(),title:o,content:a,url:t.url??null,tags:t.tag?[t.tag]:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};u.items.push(c),A(s,u),X("info","Item added",{id:c.id,title:c.title}),O({ok:!0,item:c,message:`Added ${c.id}`},t.json)});return}if(r==="list"){if(t.format!==void 0&&t.format!=="table"&&t.format!=="json")throw Error("Invalid --format value for list. Use 'table' or 'json'.");L(s,()=>{let o=b(s),a=Number.isFinite(t.page)&&t.page>0?t.page:1,u=Number.isFinite(t.limit)&&t.limit>0?t.limit:20,c=t.search?String(t.search).toLowerCase():"",E=t.tag?String(t.tag).toLowerCase():"",d=t.format==="table"||!t.json&&!t.format&&hn(t),T=t.json||t.format==="json",l=o.items;if(t.archived)l=l.filter((g)=>g.archived===!0);else if(!t.includeArchived)l=l.filter((g)=>!g.archived);if(c)l=l.filter((g)=>g.title.toLowerCase().includes(c)||g.content.toLowerCase().includes(c));if(E)l=l.filter((g)=>g.tags&&g.tags.map((re)=>re.toLowerCase()).includes(E));let{sorted:f,sort:S,direction:N}=On(l,t),w=(a-1)*u,x=f.slice(w,w+u),j=Math.max(1,Math.ceil(f.length/u));if(T){O({ok:!0,page:a,limit:u,total:f.length,total_pages:j,sort:S,direction:N,items:x},!0);return}if(x.length===0){O(`No items found (search=${c||"none"}, tag=${E||"none"})`,!1);return}if(d){let g=(I)=>I,re=`${g("ID")}	${g("TITLE")}	${g("CREATED")}	${g("URL")}	${g("TAGS")}`;console.log(re);for(let I of x)console.log(`${I.id}	${g(I.title)}	${I.created_at}	${I.url?g(I.url):""}	${I.tags?.length?g(`[${I.tags.join(", ")}]`):""}`);console.log(`Page ${a}/${j} | showing ${x.length} of ${f.length} | sort=${S} ${N} | search=${c||"none"} | tag=${E||"none"}`)}else{for(let g of x)console.log(`${g.id}	${g.title}	${g.created_at}${g.url?`	${g.url}`:""}${g.tags?.length?`	[${g.tags.join(", ")}]`:""}`);console.log(`Page ${a}/${j} | showing ${x.length} of ${f.length} | sort=${S} ${N} | search=${c||"none"} | tag=${E||"none"}`)}});return}if(r==="get"){H(t),L(s,()=>{let a=b(s).items.find((u)=>u.id===t.id||u.short_id===t.id);if(!a)throw Error(`Item not found: ${t.id}`);O({ok:!0,item:a,message:`${a.id}: ${a.title}`},t.json)});return}if(r==="update"){H(t),L(s,()=>{let o=b(s),a=o.items.findIndex((c)=>c.id===t.id||c.short_id===t.id);if(a===-1)throw Error(`Item not found: ${t.id}`);let u=o.items[a];if(t.title!==void 0)u.title=t.title;if(t.content!==void 0)u.content=t.content;if(t.url!==void 0)u.url=t.url;if(t.tag!==void 0){if(u.tags=u.tags||[],!u.tags.map((c)=>c.toLowerCase()).includes(t.tag.toLowerCase()))u.tags.push(t.tag)}u.updated_at=new Date().toISOString(),o.items[a]=u,A(s,o),O({ok:!0,item:u,message:`Updated ${u.id}`},t.json)});return}if(r==="archive"||r==="restore"){H(t),L(s,()=>{let o=b(s),a=o.items.findIndex((c)=>c.id===t.id||c.short_id===t.id);if(a===-1)throw Error(`Item not found: ${t.id}`);let u=o.items[a];u.archived=r==="archive",u.updated_at=new Date().toISOString(),o.items[a]=u,A(s,o),O({ok:!0,item:u,message:`${r==="archive"?"Archived":"Restored"} ${u.id}`},t.json)});return}if(r==="untag"){if(H(t),!t.tag)throw Error("Missing required --tag. Example: open-knowledge untag --id <id> -t <tag>");L(s,()=>{let o=b(s),a=o.items.findIndex((E)=>E.id===t.id||E.short_id===t.id);if(a===-1)throw Error(`Item not found: ${t.id}`);let u=o.items[a],c=u.tags?.length??0;u.tags=(u.tags??[]).filter((E)=>E.toLowerCase()!==t.tag.toLowerCase()),u.updated_at=new Date().toISOString(),o.items[a]=u,A(s,o),O({ok:!0,item:u,removed:c-u.tags.length,message:`Removed tag from ${u.id}`},t.json)});return}if(r==="upsert"){let o=t.title??n[1],a=t.content??n[2];L(s,()=>{let u=b(s),c=t.id?u.items.findIndex((T)=>T.id===t.id||T.short_id===t.id):-1,E=new Date().toISOString();if(c===-1){if(!o||!a)throw Error("New item requires title and content. Example: open-knowledge upsert <title> <content> [--id <id>]");let T=t.id??ce(),l={id:T,short_id:Ne(T),title:o,content:a,url:t.url??null,tags:t.tag?[t.tag]:[],metadata:{},archived:!1,created_at:E,updated_at:E};u.items.push(l),A(s,u),O({ok:!0,created:!0,item:l,message:`Upserted ${l.id}`},t.json);return}let d=u.items[c];if(o!==void 0)d.title=o;if(a!==void 0)d.content=a;if(t.url!==void 0)d.url=t.url;if(t.tag!==void 0){if(d.tags=d.tags||[],!d.tags.map((T)=>T.toLowerCase()).includes(t.tag.toLowerCase()))d.tags.push(t.tag)}d.updated_at=E,u.items[c]=d,A(s,u),O({ok:!0,created:!1,item:d,message:`Upserted ${d.id}`},t.json)});return}if(r==="delete"){if(H(t),!t.yes)throw Error("Refusing delete without --yes. Re-run with: open-knowledge delete --id <id> --yes");L(s,()=>{let o=b(s),a=o.items.length;o.items=o.items.filter((c)=>c.id!==t.id&&c.short_id!==t.id);let u=a!==o.items.length;if(A(s,o),!u)throw Error(`Item not found: ${t.id}`);X("info","Item deleted",{id:t.id}),O({ok:!0,deleted_id:t.id,message:`Deleted ${t.id}`},t.json)});return}if(r==="export"){let o=t.format??"json";if(o!=="json"&&o!=="jsonl")throw Error("Invalid --format. Use 'json' or 'jsonl'.");L(s,()=>{let a=b(s);if(o==="jsonl")for(let u of a.items)console.log(JSON.stringify(u));else O({ok:!0,items:a.items},t.json)});return}if(r==="prune"){if(!t.yes)throw Error("Refusing prune without --yes. Re-run with: open-knowledge prune --yes [--older-than <days>] [--empty]");L(s,()=>{let o=b(s),a=o.items.length;if(t.olderThan!==void 0){let c=new Date;c.setDate(c.getDate()-t.olderThan),o.items=o.items.filter((E)=>new Date(E.created_at)>=c)}if(t.empty)o.items=o.items.filter((c)=>c.content.trim().length>0);let u=a-o.items.length;A(s,o),X("info","Prune completed",{pruned:u,remaining:o.items.length}),O({ok:!0,pruned:u,remaining:o.items.length,message:`Pruned ${u} item(s)`},t.json)});return}if(r==="dedupe"){if(!t.yes)throw Error("Refusing dedupe without --yes. Re-run with: open-knowledge dedupe --yes [--json]");L(s,()=>{let o=b(s),a=new Set,u=o.items.length;o.items=o.items.filter((E)=>{let d=`${E.title}\x00${E.content}`;if(a.has(d))return!1;return a.add(d),!0});let c=u-o.items.length;A(s,o),X("info","Dedupe completed",{removed:c,remaining:o.items.length}),O({ok:!0,removed:c,remaining:o.items.length,message:`Dedupe removed ${c} duplicate(s)`},t.json)});return}if(r==="stats"){L(s,()=>{let o=b(s),a=o.items.filter((N)=>!N.archived),u=a.length,c=o.items.length-u,E=a.filter((N)=>N.url).length,d=a.filter((N)=>N.tags&&N.tags.length>0).length,T=u>0?a.map((N)=>N.created_at).sort()[0]:null,l=u>0?a.map((N)=>N.created_at).sort()[u-1]:null,f={};for(let N of a)for(let w of N.tags||[])f[w]=(f[w]||0)+1;let S=Object.entries(f).sort((N,w)=>w[1]-N[1]).slice(0,5).map(([N,w])=>({tag:N,count:w}));O({ok:!0,total:u,archived:c,with_url:E,with_tags:d,oldest:T,newest:l,top_tags:S,message:`${u} items | ${E} with URL | ${d} with tags`},t.json)});return}let _=yn(n[0]),y=_?` Did you mean '${_}'?`:"";throw X("warn","Unknown command",{input:n[0],suggestion:_}),Error(`Unknown command: ${n[0]}.${y} Run 'open-knowledge --help' for available commands.`)}if(import.meta.main)Rn(process.argv.slice(2)).catch((e)=>{let n=e instanceof Error?e.message:String(e);X("error","CLI error",{message:n,stack:e instanceof Error?e.stack:void 0}),console.error(`Error: ${n}`),process.exitCode=1});export{yn as suggestCommand,On as sortItems,Rn as run,fn as parseArgs};
